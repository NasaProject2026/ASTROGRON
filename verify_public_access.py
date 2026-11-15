"""Focused public-boundary checks. Uses an existing private test session."""
import json, pathlib, urllib.request, urllib.error
ROOT = pathlib.Path(__file__).resolve().parent

def main():
    base = (ROOT / 'runtime/tunnel/public-origin.txt').read_text().strip()
    cookie = json.loads((ROOT / 'runtime/http-resume.json').read_text())['cookie']
    checks = []
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    def request(path, authenticated=False, method='GET', body=None, origin=None):
        headers = {'Cookie': cookie} if authenticated else {}
        if origin:
            headers['Origin'] = origin
        if body is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(base + path, method=method, headers=headers,
            data=json.dumps(body).encode() if body is not None else None)
        try:
            with opener.open(req, timeout=20) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as error:
            return error.code, error.read(), error.headers
    def check(name, actual, expected):
        assert actual == expected, (name, actual, expected)
        checks.append({'check': name, 'pass': True})
    for path in ['/api/core/catalog', '/api/farms', '/api/reports', '/api/capabilities', '/v1/analyses', '/ready']:
        check('anonymous_denied_' + path, request(path)[0], 401)
    for path in ['/', '/explore', '/research']:
        check('original_public_frontend_' + path, request(path)[0], 200)
    status, _, headers = request('/farms')
    check('protected_frontend_redirect', status, 307)
    check('redirect_stays_on_public_origin', headers['Location'], base + '/research')
    for path in ['/api/farms', '/api/reports', '/api/analyses/anything']:
        check('legacy_shared_store_disabled_' + path, request(path, True)[0], 503)
    for path in ['/v1/analyses', '/ready', '/metrics', '/runtime/frontend-access.txt', '/.env', '/api/core/admin']:
        check('no_backend_admin_or_secret_route_' + path, request(path, True)[0], 404)
    check('cross_origin_login_denied', request('/api/core/session', method='POST', body={'code': 'invalid'}, origin='https://untrusted.example')[0], 403)
    (ROOT / 'integration_acceptance/PUBLIC_ACCESS_BOUNDARY.json').write_text(json.dumps({'base_url': base,
        'checks': checks, 'passed': len(checks), 'TLS_verification_enabled': True, 'independent_physical_device': False}, indent=2), encoding='utf-8')
    print(json.dumps({'public_boundary_checks': len(checks)}))

if __name__ == '__main__':
    main()
