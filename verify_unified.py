"""Real HTTP acceptance against START_UNIFIED.ps1; never calls a hosted AI."""
import argparse, hashlib, http.cookiejar, io, json, pathlib, time, urllib.request, urllib.error

ROOT = pathlib.Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:3000')
    parser.add_argument('--resume-only', action='store_true')
    args = parser.parse_args()
    base = args.base.rstrip('/')
    checks = []
    def check(name, condition):
        checks.append({'check': name, 'pass': bool(condition)})
        if not condition:
            raise AssertionError(name)
    def client():
        jar = http.cookiejar.CookieJar()
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar
    first, jar = client()
    second, _ = client()
    def call(path, body=None, method=None, opener=first, origin=base, binary=False):
        headers = {'Origin': origin} if origin else {}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(base + '/api/core/' + path,
            data=json.dumps(body).encode() if body is not None else None,
            method=method or ('GET' if body is None else 'POST'), headers=headers)
        try:
            with opener.open(request, timeout=60) as response:
                raw = response.read()
                return response.status, raw if binary else json.loads(raw), response.headers
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read()), error.headers
    def wait(aid):
        until = time.monotonic() + 150
        while time.monotonic() < until:
            status, state, _ = call('analyses/' + aid)
            if status != 200:
                raise AssertionError('OWNED_JOB_POLL_FAILED')
            if state['state'] != 'pending':
                return state
            time.sleep(1)
        raise AssertionError('JOB_TIMEOUT')
    if args.resume_only:
        previous = json.loads((ROOT / 'runtime/http-resume.json').read_text())
        first.addheaders = [('Cookie', previous['cookie'])]
        check('session_survives_stack_restart', call('session')[0] == 200)
        state = call('analyses/' + previous['fresh_id'])[1]
        check('owned_job_survives_restart', state['analysis_id'] == previous['fresh_id'] and state['state'] == 'blocked')
        result = call('analyses/' + previous['cached_id'] + '/summary')[1]
        check('science_identity_after_restart', result['engine_result']['scientific_result_sha256'] == previous['scientific_hash'])
        (ROOT / 'integration_acceptance/UNIFIED_RESTART_ACCEPTANCE.json').write_text(json.dumps({'checks': checks, 'passed': len(checks), 'actual_stack_restart': True}, indent=2), encoding='utf-8')
        print(json.dumps({'restart_checks_passed': len(checks)}))
        return
    code = (ROOT / 'runtime/frontend-access.txt').read_text().strip()
    check('anonymous_denied', call('catalog')[0] == 401)
    check('cross_origin_login_denied', call('session', {'code': code}, origin='https://untrusted.example')[0] == 403)
    check('missing_origin_login_denied', call('session', {'code': code}, origin=None)[0] == 403)
    status, _, headers = call('session', {'code': code})
    check('login', status == 200)
    cookie = headers.get('Set-Cookie', '').lower()
    check('http_only_strict_cookie', 'httponly' in cookie and 'samesite=strict' in cookie)
    if base.startswith('https:'):
        check('HTTPS_secure_cookie', 'secure' in cookie)
    check('second_session_login', call('session', {'code': code}, opener=second)[0] == 200)
    ready = call('status')[1]
    check('authenticated_D_ready', ready['status'] == 'ready' and ready['protected'] == 301)
    check('adaptive_off_on_mismatch', ready['adaptive']['enabled'] is False)
    catalog = call('catalog')[1]['analyses']
    research = next(a for a in catalog if a['demo_case'] == 'research')
    aid = research['analysis_id']
    check('cached_label', research['execution_kind'] == 'VERIFIED_CACHED_REPLAY')
    original = json.loads((ROOT / 'core/integration/production_readiness/samples/Latest_A/Canonical_API_Response.json').read_text('utf-8-sig'))
    summary = call(f'analyses/{aid}/summary')[1]
    check('canonical_decision_exact', summary['decision'] == original['decision'])
    check('qualification_exact', summary['qualification'] == original['qualification'])
    check('two_Pareto_no_winner', len(summary['decision']['pareto_ids']) == 2 and summary['decision']['selected_ids'] == [])
    check('canonical_scientific_hash', summary['engine_result']['scientific_result_sha256'] == original['engine_result']['scientific_result_sha256'])
    for index, alternative in enumerate(summary['alternatives']):
        check('rotation_choices_exact_' + str(index), alternative['choices'] == original['alternatives'][index]['choices'])
    raw_result = call(f'analyses/{aid}/result', binary=True)[1]
    check('canonical_result_exact', json.loads(raw_result) == original)
    manifest = call(f'analyses/{aid}/manifest')[1]
    check('result_bytes_bound_to_manifest', hashlib.sha256(raw_result).hexdigest() == manifest['response_sha256'])
    pdf_status, pdf, _ = call(f'analyses/{aid}/pdf', binary=True)
    from pypdf import PdfReader
    check('scientific_PDF_5_pages', pdf_status == 200 and pdf.startswith(b'%PDF') and len(PdfReader(io.BytesIO(pdf)).pages) == 5)
    check('CSV_available', call(f'analyses/{aid}/csv', binary=True)[0] == 200)
    sid = call('conversations', {'analysis_id': aid})[1]['session_id']
    message = {'message': 'Explain water', 'scope': {'field_id': 'F1', 'source_year': 2017, 'scenario_id': 'REFERENCE', 'policy_id': summary['alternatives'][0]['policy_id']}}
    reply = call(f'conversations/{sid}/messages', message)[1]
    check('C_same_analysis', reply['scientific_analysis_reference'] == aid)
    check('C_offline_citations', reply['mode'] == 'DETERMINISTIC_FALLBACK' and len(reply['claims']) > 0)
    check('conversation_cross_session_denied', call(f'conversations/{sid}/messages', message, opener=second)[0] == 404)
    check('no_admin_passthrough', call('admin')[0] == 404)
    check('oversize_request_denied', call('analyses', {'request': 'x' * 524289})[0] == 413)
    # A real inexpensive evidence-gate request through V7 -> D's durable queue.
    submitted = call('analyses', {'case': 'blocked'})
    check('fresh_submission_accepted', submitted[0] == 202 and submitted[1]['state'] == 'pending')
    fresh_id = submitted[1]['analysis_id']
    check('job_cross_session_denied', call(f'analyses/{fresh_id}', opener=second)[0] == 404)
    queue = call(f'analyses/{fresh_id}/queue')[1]
    check('queue_START_contract', queue['schema'] == 'astragron.queue-status.v1' and queue['estimation_basis']['target'] == 'START' and queue['estimation_basis']['guaranteed'] is False)
    check('cancel_forwarded', call(f'analyses/{fresh_id}/cancel', {})[0] == 202)
    state = wait(fresh_id)
    check('cancelled_on_D', state['error'] == 'JOB_CANCELLED')
    check('retry_forwarded', call(f'analyses/{fresh_id}/retry', {})[0] == 202)
    state = wait(fresh_id)
    check('fresh_missing_evidence_abstention', state['state'] == 'blocked' and state['report_error'] is None)
    blocked = call(f'analyses/{fresh_id}/summary')[1]
    check('blocked_has_no_winner', blocked['status'] == 'EVIDENCE_BLOCKED' and blocked['decision']['selected_ids'] == [])
    check('original_immutable', call(f'analyses/{aid}/result', binary=True)[1] == raw_result)
    legacy_request = urllib.request.Request(base + '/api/farms/custom-unqualified-test/analyses',
        data=json.dumps({'farmId': 'custom-unqualified-test', 'inputRevision': 'test-revision',
            'datasetMode': 'REAL_SCIENTIFIC_BACKEND', 'coordinates': [10, 50], 'fieldCount': 1,
            'inputsModified': True, 'isUserCreatedDraft': True}).encode(),
        headers={'Content-Type': 'application/json', 'Origin': base})
    try:
        with first.open(legacy_request, timeout=30) as response:
            legacy = json.loads(response.read())['job']
        check('legacy_custom_request_fail_closed', legacy['status'] == 'UNAVAILABLE' and legacy['reportId'] is None and legacy['failClosedStatus'] == 'MODEL_UNQUALIFIED')
    except urllib.error.HTTPError as error:
        value = json.loads(error.read())
        check('legacy_custom_request_fail_closed', error.code == 503 and value['error'] == 'LEGACY_SHARED_STORAGE_DISABLED')
    secrets = [code.encode(), (ROOT / 'core/runtime/integration/release-demo/operator-access.txt').read_bytes().strip()]
    settings_path = ROOT / 'runtime/UNIFIED_SETTINGS.json'
    build_dir = json.loads(settings_path.read_text('utf-8-sig'))['frontend_build_dir'] if settings_path.exists() else '.next'
    client_files = list((ROOT / 'frontend' / build_dir / 'static').rglob('*.js'))
    check('actual_client_bundles_present', len(client_files) > 0)
    check('server_credentials_absent_from_client_bundles', all(all(secret not in p.read_bytes() for secret in secrets) for p in client_files))
    cookie_value = next(c.value for c in jar if c.name == 'astrogron_session')
    private_resume = ROOT / 'runtime/http-resume.json'
    private_resume.write_text(json.dumps({'cookie': 'astrogron_session=' + cookie_value, 'fresh_id': fresh_id, 'cached_id': aid,
        'scientific_hash': summary['engine_result']['scientific_result_sha256']}), encoding='utf-8')
    record = {'schema': 'astrogron.unified-http-acceptance.v1', 'passed': len(checks), 'checks': checks,
        'base_url': base, 'transport': 'PUBLIC_HTTPS_TUNNEL' if base.startswith('https:') else 'LOOPBACK', 'independent_physical_device': False,
        'analysis_id': aid, 'fresh_blocked_analysis_id': fresh_id, 'scientific_hash': summary['engine_result']['scientific_result_sha256'],
        'remote_LLM_calls': 0, 'fresh_native_science': False, 'cached_case_explicitly_labeled': True}
    target = ROOT / 'integration_acceptance/UNIFIED_HTTP_ACCEPTANCE.json'
    target.write_text(json.dumps(record, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(checks), 'receipt': str(target), 'fresh_job': fresh_id}))

if __name__ == '__main__':
    main()
