"""Capability-gated C/global interfaces. No C runtime, provider or global module is merged."""
from copy import deepcopy
import re
import threading
import uuid

from .codec import digest
from .store import Problem

C_CONTRACT_COMMIT = '44d03df74ac67598daabb47096095f5b94897e69'
CAPABILITIES = {'scientific_backend': True, 'customer_report': True, 'c_adapter': True,
                'live_conversation': False, 'conversational_core':True, 'native_chat_projection':True, 'gemini_v5': False, 'global_evidence_fallback': False}


class ConversationBridge:
    def __init__(self, store):
        self.store = store
        self.sessions = {}
        self.lock = threading.RLock()

    def attach(self, principal, body):
        if not isinstance(body, dict) or set(body) - {'analysis_id', 'scope', 'locale'} or body.get('locale', 'en') != 'en':
            raise Problem(422, 'INVALID_SESSION_ATTACHMENT')
        analysis_id = body.get('analysis_id')
        result = self.store.result(principal, analysis_id)
        scope = body.get('scope')
        if scope is not None:
            required = {'field_id', 'source_year', 'scenario_id', 'policy_id'}
            if not isinstance(scope, dict) or set(scope) != required:
                raise Problem(422, 'EXACT_ANALYSIS_SCOPE_REQUIRED')
            rows = result['report_dto']['five_year_rows']
            if not any(all(row[k] == scope[k] for k in required) for row in rows):
                raise Problem(404, 'ANALYSIS_SCOPE_NOT_FOUND')
        session_id = uuid.uuid4().hex
        state = self.store.state(principal, analysis_id)
        session = {'schema': 'astragron.c-attachment.v1', 'session_id': session_id, 'analysis_id': analysis_id,
                   'farm_id': result['farm_id'], 'locale': 'en', 'scope': deepcopy(scope),
                   'scenario_identity': state['scenario_ids'].get((scope or {}).get('scenario_id')),
                   'response_sha256': state['response_sha256'], 'run_id': result['run_id'],
                   'provider_state': 'C_INTEGRATION_PENDING', 'live_inference': False,
                   'contract_commit': C_CONTRACT_COMMIT}
        with self.lock:
            if len(self.sessions) >= 100:
                raise Problem(429, 'SESSION_LIMIT')
            self.sessions[session_id] = {'principal': principal, 'attachment': session}
        return deepcopy(session)

    def _session(self, principal, session_id):
        item = self.sessions.get(session_id)
        if not item or item['principal'] != principal:
            raise Problem(404, 'SESSION_NOT_FOUND')
        self.store.state(principal, item['attachment']['analysis_id'])
        return item['attachment']

    def explanation(self, principal, session_id):
        session = self._session(principal, session_id)
        result = self.store.result(principal, session['analysis_id'])
        facts = []
        for index, row in enumerate(result['report_dto']['five_year_rows']):
            if session['scope'] is None or not all(row[k] == v for k, v in session['scope'].items()):
                continue
            values = [('biomass/living_organs/SO', (row.get('biomass') or {}).get('living_organs', {}).get('SO'), 'kg modeled storage-organ DM/ha'),
                      ('biological_uptake/value', (row.get('biological_uptake') or {}).get('value'), 'kg N/ha'),
                      ('predicted_yield', row.get('predicted_yield'), 'unqualified; unavailable')]
            for suffix, value, unit in values:
                pointer = f'/report_dto/five_year_rows/{index}/{suffix}'
                # Older v1 nullable sections have no nested fact pointer; never invent one.
                from customer_reports.render import pointer as resolve
                try:
                    if resolve(result, pointer) != value:
                        raise Problem(409, 'RESULT_INTEGRITY_FAILED')
                except (KeyError, TypeError, IndexError):
                    continue
                facts.append({'evidence_id': digest({'response_sha256': session['response_sha256'], 'pointer': pointer}),
                              'value': value, 'unit': unit, 'scope': deepcopy(session['scope']),
                              'location': f"analysis:sha256:{session['response_sha256']}#{pointer}"})
        return {'schema': 'astragron.c-grounding.v1', 'attachment': deepcopy(session), 'facts': facts,
                'decision': deepcopy(result['decision']), 'qualification': deepcopy(result['qualification']),
                'missing_evidence': deepcopy(result['missing_requirements']), 'warnings': deepcopy(result['warnings']),
                'explanation': 'Conditional research comparison. Preserve every Pareto alternative and unavailable quantity. C live provider integration is pending.',
                'scientific_computation_by_llm': False}

    def evidence(self, principal, session_id, evidence_id):
        for fact in self.explanation(principal, session_id)['facts']:
            if fact['evidence_id'] == evidence_id:
                return fact
        raise Problem(404, 'EVIDENCE_NOT_FOUND')


def rainfall_child(store, principal, parent_id, body):
    if not isinstance(body, dict) or set(body) != {'schema', 'source_scenario_id', 'rain_factor'} or body['schema'] != 'astragron.rainfall-scenario.request.v1':
        raise Problem(422, 'INVALID_RAINFALL_SCENARIO')
    value = body['rain_factor']
    if type(value) not in (int, float) or not .5 <= value <= 1.5:
        raise Problem(422, 'UNSUPPORTED_CHANGE')
    store.result(principal, parent_id)
    from .codec import parse
    payload = parse((store._path(parent_id) / 'request.json').read_text(encoding='utf-8'))
    scenarios = payload['engine_request']['scenarios']
    matches = [s for s in scenarios if s['scenario_id'] == body['source_scenario_id']]
    if len(matches) != 1:
        raise Problem(404, 'SCENARIO_NOT_FOUND')
    matches[0]['rain_factor'] = value
    return store.create(principal, payload, parent_id=parent_id)


def global_evidence_capability(enabled=False):
    # A flag alone can never grant provenance/qualification to a missing module.
    return {'schema': 'astragron.global-evidence-capability.v1', 'requested': enabled,
            'integrated': False, 'status': 'DEPENDENCY_NOT_REVIEWED', 'fallback_allowed': False,
            'requirements': ['frozen package/commit', 'source provenance and license', 'uncertainty and scope',
                             'independent blocking tests', 'explicit scientific qualification review']}
