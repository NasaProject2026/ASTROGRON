"""Local HTTP boundary for the frozen A+B integration. No paid/live provider calls."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import parse_qs, urlsplit
import uuid
import threading

from brain.baseline import ROOT, verify
from brain.runtime_paths import pcse_python
from .adapters import CAPABILITIES, ConversationBridge, global_evidence_capability, rainfall_child
from .codec import canonical, parse
from .c_gateway import ChatGateway,build_service
_AUTO_C=object()
from .store import Problem, Store, authenticate, principal_tokens


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, store, tokens, *, origins=(), c_service=_AUTO_C, native_c_scope_verified=False, public_demo_enabled=False):
        self.store, self.tokens, self.origins = store, tokens, tuple(origins)
        self.connection_slots=threading.BoundedSemaphore(32)
        self.bridge = ConversationBridge(store)
        if c_service is _AUTO_C:
            c_service=build_service();native_c_scope_verified=True
        self.chat = ChatGateway(store,c_service,native_scope_verified=native_c_scope_verified,public_demo_enabled=public_demo_enabled)
        super().__init__(address, Handler)
        # Same-origin local demo POSTs carry Origin; allow only this bound loopback port.
        self.origins=tuple(dict.fromkeys((*self.origins,'http://127.0.0.1:'+str(self.server_port),'http://localhost:'+str(self.server_port),'http://[::1]:'+str(self.server_port))))


    def process_request(self,request,address):
        if not self.connection_slots.acquire(blocking=False):
            body=b'{"error":"HTTP_CONCURRENCY_LIMIT"}'
            try:request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body)
            finally:self.shutdown_request(request)
            return
        try:super().process_request(request,address)
        except BaseException:self.connection_slots.release();raise

    def process_request_thread(self,request,address):
        try:super().process_request_thread(request,address)
        finally:self.connection_slots.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'ASTRAGRON-Integration/1'

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_):
        pass  # No request bodies, farm IDs, query strings, credentials or exceptions in logs.

    def reply(self, status, body, mime='application/json', *, request_id=None):
        raw = body if isinstance(body, bytes) else canonical(body)
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('X-Request-ID', request_id or self.trace)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" if self.path.startswith('/demo') else "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'"))
        self.send_header('Connection', 'close')
        origin = self.headers.get('Origin')
        if origin and origin in self.server.origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.end_headers()
        self.close_connection = True
        if self.command != 'HEAD':
            self.wfile.write(raw)

    def body(self):
        if self.headers.get('Transfer-Encoding'):
            raise Problem(400, 'TRANSFER_ENCODING_NOT_SUPPORTED')
        if self.headers.get_content_type() != 'application/json':
            raise Problem(415, 'JSON_CONTENT_TYPE_REQUIRED')
        lengths = self.headers.get_all('Content-Length') or []
        if len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,7}', lengths[0]):
            raise Problem(411, 'CONTENT_LENGTH_REQUIRED')
        length = int(lengths[0])
        if not 0 < length <= 524288:
            # Drain only a bounded near-limit body so Windows can deliver the 413
            # without resetting the connection while the client is still sending.
            if 0 < length <= 1048576:
                self.connection.settimeout(1)
                try:
                    remaining=length
                    while remaining:
                        chunk=self.rfile.read(min(remaining,65536))
                        if not chunk:break
                        remaining-=len(chunk)
                except OSError:pass
                finally:self.connection.settimeout(10)
            raise Problem(413, 'REQUEST_TOO_LARGE')
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise Problem(400, 'INCOMPLETE_JSON_BODY')
        try:
            return parse(raw.decode('utf-8'))
        except (ValueError, UnicodeDecodeError, RecursionError):
            raise Problem(400, 'INVALID_JSON')

    def handle_call(self):
        self.trace = uuid.uuid4().hex
        try:
            url = urlsplit(self.path)
            if len(self.path) > 2048 or url.scheme or url.netloc or '%' in url.path or '..' in url.path:
                raise Problem(400, 'INVALID_URL')
            origin = self.headers.get('Origin')
            if origin and origin not in self.server.origins:
                raise Problem(403, 'ORIGIN_NOT_ALLOWED')
            if self.command == 'OPTIONS':
                if not origin:
                    raise Problem(403, 'ORIGIN_NOT_ALLOWED')
                return self.reply(204, b'')
            if self.command == 'GET' and url.path == '/health':
                return self.reply(200, {'status': 'alive', 'schema': 'astragron.health.v1'})
            if self.command=='GET' and url.path in {'/demo','/demo/','/demo/app.js'}:
                file='app.js' if url.path.endswith('app.js') else 'index.html'
                return self.reply(200,(ROOT/'integration/release/demo'/file).read_bytes(),'text/javascript; charset=utf-8' if file=='app.js' else 'text/html; charset=utf-8')
            principal = authenticate(self.headers.get('Authorization'), self.server.tokens)
            store = self.server.store
            if self.command == 'GET' and url.path == '/ready':
                baseline = verify()
                native = pcse_python()
                source_ready = runtime_ready = False
                try:
                    from brain.growth_source import verify as verify_source
                    from .codec import sha
                    cache = ROOT / 'runtime/agent-a/system-integration/source_snapshot'
                    receipt = parse((cache / 'growth-weather.receipt.json').read_text(encoding='utf-8'))
                    verify_source((cache / (receipt['raw_sha256'] + '.raw.json')).read_bytes(), receipt)
                    lock = parse((ROOT / 'coordination/GROWTH_INPUT_LOCK.json').read_text(encoding='utf-8'))
                    source_ready = all(receipt.get(k) == v for k, v in lock['NASA'].items()) and all(sha(ROOT / p) == h for p, h in lock['files'].items())
                    if native is not None and native.is_file():
                        probe = subprocess.run([str(native), '-B', '-c', 'from importlib.metadata import version; print(version("pcse"))'],
                                               capture_output=True, timeout=10, env={k: v for k, v in os.environ.items() if not any(x in k.upper() for x in ('API_KEY','TOKEN','SECRET','PASSWORD','AUTH_JSON'))})
                        runtime_ready = probe.returncode == 0 and probe.stdout.strip() == b'6.0.13'
                except (OSError, ValueError, KeyError, subprocess.SubprocessError):
                    pass
                ready = runtime_ready and source_ready
                return self.reply(200 if ready else 503, {'status': 'ready' if ready else 'dependency_missing',
                                  'protected': baseline['files_verified'], 'native_runtime_present': native is not None and native.is_file(),
                                  'pinned_native_runtime_verified': runtime_ready,
                                  'source_snapshot_present': source_ready, 'capabilities': CAPABILITIES,
                                  'global_evidence': global_evidence_capability(os.environ.get('ASTRAGRON_GLOBAL_EVIDENCE_ENABLED') == '1'),
                                  'live_provider_dependencies': 'CURRENT_PROVIDER_AVAILABILITY_UNVERIFIED', 'chat': self.server.chat.status()})
            if self.command == 'GET' and url.path == '/openapi.json':
                return self.reply(200, parse((ROOT / 'integration/contracts/openapi.json').read_text(encoding='utf-8')))
            if self.command=='GET' and url.path=='/v1/demo/catalog':
                return self.reply(200,{'schema':'astragron.demo-catalog.v1','scope':'LIMITED_RESEARCH_DEMONSTRATION','analyses':[s for s in store.list(principal) if s.get('execution_kind') in {'VERIFIED_CACHED_REPLAY','VERIFIED_PUBLIC_FIXTURE'}]})
            if self.command=='GET' and url.path.startswith('/v1/demo/requests/'):
                from .release_demo import fixture_requests
                name=url.path.rsplit('/',1)[-1];payload=fixture_requests().get(name)
                if payload is None or payload['farm_id'] not in principal.farms:raise Problem(404,'FARM_NOT_FOUND')
                return self.reply(200,payload)
            if url.path == '/v1/analyses':
                if self.command == 'POST':
                    return self.reply(202, store.create(principal, self.body()))
                if self.command == 'GET':
                    return self.reply(200, {'analyses': store.list(principal)})
            if self.command == 'POST' and url.path == '/v1/attachments':
                return self.reply(201, self.server.bridge.attach(principal, self.body()))
            parts = url.path.strip('/').split('/')
            chat_reply = self.server.chat.dispatch(self.command,parts,principal,self.body)
            if chat_reply is not None:
                return self.reply(*chat_reply)
            if len(parts) >= 3 and parts[:2] == ['v1', 'attachments']:
                if self.command == 'GET' and len(parts) == 4 and parts[3] == 'grounding':
                    return self.reply(200, self.server.bridge.explanation(principal, parts[2]))
                if self.command == 'GET' and len(parts) == 5 and parts[3] == 'evidence':
                    return self.reply(200, self.server.bridge.evidence(principal, parts[2], parts[4]))
            if len(parts) >= 3 and parts[:2] == ['v1', 'analyses']:
                analysis_id = parts[2]
                if self.command == 'GET' and len(parts) == 3:
                    return self.reply(200, store.public_state(principal, analysis_id))
                if self.command == 'GET' and parts[3:]==['queue']:
                    return self.reply(200,store.queue_status(principal,analysis_id))
                if self.command == 'POST' and parts[3:] in (['cancel'], ['retry']):
                    if self.body() != {}: raise Problem(422, 'EMPTY_CONTROL_BODY_REQUIRED')
                    action = store.cancel if parts[3] == 'cancel' else store.retry
                    return self.reply(202, action(principal, analysis_id))
                if self.command == 'POST' and parts[3:] == ['scenarios']:
                    return self.reply(202, rainfall_child(store, principal, analysis_id, self.body()))
                if self.command == 'GET' and len(parts) == 4:
                    route = parts[3]
                    if route in ('html', 'pdf', 'csv', 'json', 'manifest', 'bindings', 'appendix'):
                        raw, mime = store.artifact(principal, analysis_id, route)
                        return self.reply(200, raw, mime)
                    result = store.result(principal, analysis_id)
                    if route == 'report':
                        return self.reply(200, {key:result[key] for key in ('farm_id','report_dto','qualification','warnings')})
                    if route == 'result':
                        return self.reply(200, result)
                    if route == 'comparison':
                        return self.reply(200, {key: result.get(key) for key in ('schema', 'farm_id', 'run_id', 'status', 'decision', 'alternatives', 'qualification')})
                    if route == 'evidence':
                        return self.reply(200, {key: result.get(key) for key in ('provenance', 'qualification', 'warnings', 'missing_requirements')})
                    if route == 'records':
                        query = parse_qs(url.query, strict_parsing=True)
                        if set(query) - {'field_id', 'source_year', 'scenario_id', 'policy_id'} or any(len(v) != 1 for v in query.values()):
                            raise Problem(422, 'INVALID_RECORD_SCOPE')
                        rows = result['report_dto']['five_year_rows']
                        rows = [row for row in rows if all(str(row[k]) == values[0] for k, values in query.items())]
                        return self.reply(200, {'schema': 'astragron.analysis-records.v1', 'analysis_id': analysis_id,
                                                'run_id': result['run_id'], 'rows': rows})
            raise Problem(404, 'ROUTE_NOT_FOUND')
        except Problem as error:
            detail={'error':error.code,'request_id':self.trace}
            if error.code=='COMPUTE_QUEUE_LIMIT':detail.update(message='The bounded analysis queue is full. Wait for an existing analysis to finish or cancel your queued work, then retry.',queue={'status':'full','running_limit':1,'running_plus_waiting_limit':store.max_pending})
            self.reply(error.status,detail)
        except (ValueError, TypeError, KeyError, RecursionError):
            self.reply(422, {'error': 'INVALID_REQUEST', 'request_id': self.trace})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.reply(500, {'error': 'INTERNAL_ERROR', 'request_id': self.trace})

    do_GET = handle_call
    do_POST = handle_call
    do_OPTIONS = handle_call
    do_DELETE = handle_call


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8790)
    parser.add_argument('--store', type=Path, default=ROOT / 'runtime/integration/private')
    parser.add_argument('--job-timeout', type=int, default=int(os.environ.get('ASTRAGRON_JOB_TIMEOUT_SECONDS','900')))
    parser.add_argument('--max-pending',type=int,default=int(os.environ.get('ASTRAGRON_MAX_PENDING_JOBS','6')))
    parser.add_argument('--memory-mib', type=int, default=int(os.environ.get('ASTRAGRON_WORKER_MEMORY_MIB','3072')))
    args = parser.parse_args()
    if args.host not in ('127.0.0.1', '::1', 'localhost'):
        parser.error('Bind loopback behind an authenticated HTTPS proxy; direct public binding is disabled.')
    tokens = principal_tokens(os.environ.get('ASTRAGRON_INTEGRATION_AUTH_JSON', '{}'))
    origins = tuple(x for x in os.environ.get('ASTRAGRON_ALLOWED_ORIGINS', '').split(',') if x)
    if any(not re.fullmatch(r'https?://[A-Za-z0-9.-]+(?::[0-9]{1,5})?', x) for x in origins):
        parser.error('Explicit origins only; no wildcards, paths or credentials.')
    store = Store(args.store, timeout=args.job_timeout, memory_bytes=args.memory_mib*1024**2,max_pending=args.max_pending)
    server = Server((args.host, args.port), store, tokens, origins=origins,public_demo_enabled=os.environ.get('ASTRAGRON_APPROVED_PUBLIC_DEMO_CHAT_ENABLED')=='1')
    print('ASTRAGRON integration listening on loopback port ' + str(server.server_port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        store.close()


if __name__ == '__main__':
    main()
