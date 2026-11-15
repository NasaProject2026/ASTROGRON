from copy import deepcopy
from collections import Counter
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from brain.baseline import ROOT
from customer_reports.render import Report, pointer, decimal_text
from system_integration.adapters import ConversationBridge, global_evidence_capability, rainfall_child
from system_integration.api import Server
from system_integration.codec import canonical, digest, parse, write
from system_integration.store import Principal, Problem, Store, authenticate, principal_tokens


class CodecTests(unittest.TestCase):
    def test_duplicate_keys_rejected(self):
        with self.assertRaises(ValueError): parse('{"a":1,"a":2}')

    def test_nonfinite_rejected(self):
        for value in ('NaN', 'Infinity', '-Infinity'):
            with self.assertRaises(ValueError): parse('{"a":' + value + '}')

    def test_canonical_identity_independent_of_key_order(self):
        self.assertEqual(digest({'a': 1, 'b': 2}), digest({'b': 2, 'a': 1}))

    def test_credentials_require_server_configuration(self):
        for value in ('{}', '{"short":{"tenant":"t","subject":"s","farms":["f"]}}'):
            with self.assertRaises(ValueError): principal_tokens(value)

    def test_authentication_uses_server_principal(self):
        principal = Principal('t', 's', ('f',))
        self.assertEqual(authenticate('Bearer ' + 'x'*24, {'x'*24: principal}), principal)
        with self.assertRaises(Problem): authenticate('Bearer wrong', {'x'*24: principal})

    def test_global_flag_does_not_admit_unreviewed_evidence(self):
        self.assertFalse(global_evidence_capability(True)['integrated'])
        self.assertFalse(global_evidence_capability(True)['fallback_allowed'])


class StoreBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp(prefix='unit-', dir=ROOT / 'runtime/integration'))
        self.store = Store(self.folder, max_pending=1, max_jobs=3, render_pdf=False)
        self.payload = parse((ROOT / 'examples/engine/supported_soil.json').read_text(encoding='utf-8'))
        self.principal = Principal('t', 's', (self.payload['farm_id'], self.payload['farm_id']+'_SECOND'))

    def tearDown(self):
        self.store.close()

    def pending(self):
        with patch.object(self.store.executor, 'submit'):
            return self.store.create(self.principal, self.payload)

    def test_outside_storage_scope_rejected(self):
        with self.assertRaises(ValueError): Store(ROOT / 'outside')

    def test_resource_configuration_bounded(self):
        with self.assertRaises(ValueError): Store(self.folder / 'bad', timeout=99999)

    def test_single_host_lock(self):
        with self.assertRaises(ValueError): Store(self.folder)

    def test_pending_result_is_conflict(self):
        state = self.pending()
        with self.assertRaises(Problem) as error: self.store.result(self.principal, state['analysis_id'])
        self.assertEqual((error.exception.status, error.exception.code), (409, 'ANALYSIS_PENDING'))

    def test_queue_quota_rejects_second_request(self):
        self.pending()
        other = deepcopy(self.payload); other['farm_id'] += '_SECOND'
        with self.assertRaises(Problem) as error: self.store.create(self.principal, other)
        self.assertEqual(error.exception.status, 429)

    def test_other_subject_denied(self):
        state = self.pending()
        for principal in (Principal('t', 'other', self.principal.farms), Principal('other', 's', self.principal.farms), Principal('t', 's', ('otherfarm',))):
            with self.assertRaises(Problem) as error: self.store.state(principal, state['analysis_id'])
            self.assertEqual(error.exception.status, 404)

    def test_path_traversal_rejected(self):
        for value in ('../state', 'a/b', 'a'*33, 'Z'*32):
            with self.assertRaises(Problem): self.store.state(self.principal, value)

    def test_invalid_request_not_queued(self):
        payload = deepcopy(self.payload); payload['engine_request']['location']['point_lon_lat'] = [True, 3]
        with self.assertRaises(Problem) as error: self.store.create(self.principal, payload)
        self.assertEqual(error.exception.status, 422)
        self.assertEqual(self.store.pending, 0)

    def test_network_acquisition_disabled(self):
        payload = deepcopy(self.payload); payload['engine_request']['source']['acquisition'] = 'FETCH_ALLOWED'
        with self.assertRaises(Problem) as error: self.store.create(self.principal, payload)
        self.assertEqual(error.exception.code, 'OFFLINE_CACHE_ONLY_REQUIRED')

    def test_storage_case_quota(self):
        self.store.max_jobs = 1
        self.pending(); self.store.pending = 0
        other = deepcopy(self.payload); other['farm_id'] += '_SECOND'
        with self.assertRaises(Problem) as error: self.store.create(self.principal, other)
        self.assertEqual(error.exception.code, 'STORAGE_CASE_LIMIT')

    def test_storage_byte_quota(self):
        self.store.max_bytes = 0
        with self.assertRaises(Problem) as error: self.store.create(self.principal, self.payload)
        self.assertEqual(error.exception.status, 507)

    def test_pending_job_recovers_after_restart(self):
        state = self.pending()
        self.store.close()
        self.store = Store(self.folder)
        recovered = self.store.state(self.principal, state['analysis_id'])
        self.assertEqual(recovered['state'], 'pending')
        self.assertEqual(recovered['recovery_count'], 1)
        self.assertEqual(recovered['last_error'], 'SERVER_RESTART_INTERRUPTED_JOB')

    def test_client_state_omits_owner(self):
        state = self.pending()
        self.assertNotIn('owner', state)


class FreshReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.response = parse((ROOT / 'integration/samples/Latest_A/Canonical_API_Response.json').read_text(encoding='utf-8'))

    def test_two_pareto_plans_do_not_render_as_blocked(self):
        text = Report(deepcopy(self.response)).render()
        self.assertIn('Two research alternatives; no overall winner.', text)
        self.assertNotIn('insufficient to complete', text)
        self.assertEqual(text.count('<section class="page">'), 5)

    def test_every_report_number_is_source_bound(self):
        report = Report(deepcopy(self.response)); report.render()
        # Exact quantitative coverage of the visually qualified five-page layout:
        # area 1 + six four-metric vectors 24 + rainfall factors 3 +
        # ten reference rows (four water layers and N uptake) 50 + P/K stocks 20 = 98.
        self.assertEqual(len(report.bindings), 98)
        self.assertEqual(Counter(binding['unit'] for binding in report.bindings), Counter({
            'ha': 1, 'kg modeled storage-organ DM/field': 18, 'kg N/field': 6,
            'dimensionless rainfall input multiplier': 3, 'mm total layer water': 40,
            'kg N/ha': 10, 'kg P/ha': 10, 'kg K/ha': 10}))
        for binding in report.bindings:
            value = pointer(self.response, binding['pointer'])
            self.assertEqual(value, binding['canonical_value'])
            self.assertEqual(decimal_text(value), binding['display_value'])

    def test_unknown_native_crop_is_blocked(self):
        response = deepcopy(self.response)
        response['report_dto']['five_year_rows'][0]['crop_use_id'] = 'unknown:crop'
        with self.assertRaises(ValueError): Report(response).render()

    def test_larger_unreviewed_report_scope_is_not_silently_admitted(self):
        response = deepcopy(self.response)
        response['report_dto']['five_year_rows'].append(deepcopy(response['report_dto']['five_year_rows'][0]))
        with self.assertRaises(ValueError): Report(response).render()

    def test_null_yield_and_money_stay_null(self):
        for row in self.response['report_dto']['five_year_rows']:
            self.assertIsNone(row['predicted_yield'])
            self.assertIsNone(row['economics']['conditional_margin'])


class HTTPBoundaryTests(unittest.TestCase):
    def setUp(self):
        folder = Path(tempfile.mkdtemp(prefix='http-unit-', dir=ROOT / 'runtime/integration'))
        self.store = Store(folder)
        self.server = Server(('127.0.0.1', 0), self.store, {'x'*24: Principal('t', 's', ('farm',))}, origins=('http://localhost:5173',))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.store.close()

    def call(self, path, raw=None, content_type='application/json', **headers):
        headers['Authorization'] = 'Bearer ' + 'x'*24
        headers['Content-Type'] = content_type
        request = urllib.request.Request(self.url + path, data=raw, headers=headers)
        try: response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as e: response = e
        return response.status, response.read(), dict(response.headers)

    def test_invalid_json_is_generic_and_does_not_echo_secret(self):
        status, raw, headers = self.call('/v1/analyses', b'{"secret":"DO_NOT_ECHO",')
        self.assertEqual(status, 400)
        self.assertNotIn(b'DO_NOT_ECHO', raw)
        self.assertIn('X-Request-ID', headers)

    def test_wrong_content_type_rejected(self):
        self.assertEqual(self.call('/v1/analyses', b'{}', 'text/plain')[0], 415)

    def test_oversized_body_rejected(self):
        self.assertEqual(self.call('/v1/analyses', b' '*524289)[0], 413)

    def test_origin_allowlist(self):
        self.assertEqual(self.call('/v1/analyses', Origin='https://attacker.invalid')[0], 403)

    def test_bound_same_origin_module_and_post_work(self):
        self.assertEqual(self.call('/demo/app.js',Origin=self.url)[0],200)
        self.assertEqual(self.call('/v1/conversations',b'{}',Origin=self.url)[0],422)
        self.assertEqual(self.call('/demo/app.js',Origin='http://127.0.0.1:1')[0],403)

    def test_encoded_traversal_rejected(self):
        self.assertEqual(self.call('/v1/analyses/%2e%2e/result')[0], 400)

    def test_missing_analysis_is_404(self):
        self.assertEqual(self.call('/v1/analyses/'+'0'*32)[0], 404)

    def test_no_live_provider_is_claimed(self):
        self.assertFalse(self.server.bridge.sessions)
        from system_integration.adapters import CAPABILITIES
        self.assertFalse(CAPABILITIES['live_conversation'])


class CAdapterFixtureTests(unittest.TestCase):
    """Adapter-only unit fixtures; fresh scientific execution is proved by verify_http."""
    @classmethod
    def setUpClass(cls):
        cls.response = parse((ROOT / 'integration/samples/Latest_A/Canonical_API_Response.json').read_text(encoding='utf-8'))

    def bridge(self, response=None):
        value = self.response if response is None else response
        class FixtureStore:
            def result(self, principal, analysis_id):
                if analysis_id != 'fixture': raise Problem(404, 'ANALYSIS_NOT_FOUND')
                return deepcopy(value)
            def state(self, principal, analysis_id):
                return {'response_sha256': digest(value), 'scenario_ids': {s['scenario_id']: 'scenario:fixture' for s in value['engine_result']['normalized_request']['scenarios']}}
        return ConversationBridge(FixtureStore())

    def test_native_facts_resolve_exactly(self):
        bridge = self.bridge(); principal = Principal('t', 's', (self.response['farm_id'],))
        row = self.response['report_dto']['five_year_rows'][0]
        scope = {key: row[key] for key in ('field_id', 'source_year', 'scenario_id', 'policy_id')}
        attached = bridge.attach(principal, {'analysis_id': 'fixture', 'scope': scope})
        for fact in bridge.explanation(principal, attached['session_id'])['facts']:
            self.assertEqual(pointer(self.response, fact['location'].split('#', 1)[1]), fact['value'])

    def test_wrong_field_year_scenario_or_policy_is_not_guessed(self):
        bridge = self.bridge(); principal = Principal('t', 's', (self.response['farm_id'],))
        row = self.response['report_dto']['five_year_rows'][0]
        scope = {key: row[key] for key in ('field_id', 'source_year', 'scenario_id', 'policy_id')}
        for key, value in [('field_id', 'F_OTHER'), ('source_year', 1900), ('scenario_id', 'UNKNOWN'), ('policy_id', 'UNKNOWN')]:
            changed = dict(scope); changed[key] = value
            with self.assertRaises(Problem): bridge.attach(principal, {'analysis_id': 'fixture', 'scope': changed})

    def test_missing_evidence_is_preserved_without_facts(self):
        value = parse((ROOT / 'integration/samples/Blocked/Canonical_API_Response.json').read_text(encoding='utf-8'))
        bridge = self.bridge(value); principal = Principal('t', 's', (value['farm_id'],))
        attached = bridge.attach(principal, {'analysis_id': 'fixture'})
        result = bridge.explanation(principal, attached['session_id'])
        self.assertEqual(result['facts'], [])
        self.assertEqual(result['missing_evidence'], value['missing_requirements'])

    def test_older_v1_nullable_sections_never_emit_nonexistent_pointers(self):
        value = parse((ROOT / 'evidence/fixtures/valid.response.json').read_text(encoding='utf-8'))
        bridge = self.bridge(value); principal = Principal('t', 's', (value['farm_id'],))
        row = value['report_dto']['five_year_rows'][0]
        scope = {key: row[key] for key in ('field_id', 'source_year', 'scenario_id', 'policy_id')}
        attached = bridge.attach(principal, {'analysis_id': 'fixture', 'scope': scope})
        for fact in bridge.explanation(principal, attached['session_id'])['facts']:
            self.assertEqual(pointer(value, fact['location'].split('#', 1)[1]), fact['value'])

    def test_unknown_evidence_id_is_not_substituted(self):
        bridge = self.bridge(); principal = Principal('t', 's', (self.response['farm_id'],))
        attached = bridge.attach(principal, {'analysis_id': 'fixture'})
        with self.assertRaises(Problem): bridge.evidence(principal, attached['session_id'], 'unknown')


if __name__ == '__main__':
    unittest.main()
