"""Authenticated HTTP adapter. Analysis ingestion remains a trusted host operation."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import os
from pathlib import Path
import re
import socket
import threading
from urllib.parse import urlsplit
from .codec import canonical, strict_loads
from .config import Settings
from .errors import ChatError
from .service import ConversationService, Principal
from .tools import EngineBackend

class ChatHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()
    def __init__(self, address, service, tokens, aliases=None, diagnostics_subjects=()):
        if not tokens or any(not isinstance(k, str) or len(k) < 24 for k in tokens):
            raise ValueError("STRONG_BEARER_TOKENS_REQUIRED")
        self.service, self.tokens, self.aliases = service, tokens, aliases or {}
        self.diagnostics_subjects=set(diagnostics_subjects)
        self.ip_limits={}
        self.ip_lock=threading.Lock()
        self.slots = threading.BoundedSemaphore(16)
        super().__init__(address, Handler)
    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise
    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

class Handler(BaseHTTPRequestHandler):
    server_version = "ASTRAGRON-Conversation/1"
    sys_version = ""
    protocol_version = "HTTP/1.0"
    def setup(self):
        super().setup()
        self.connection.settimeout(10)
    def log_message(self, fmt, *args):
        pass  # Neither URLs, bearer tokens, farmer text nor responses go to logs.
    def _write(self, status, body):
        raw = canonical(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)
    def _principal(self):
        from .providers import RateLimiter
        with self.server.ip_lock:
            ip=self.client_address[0]
            if ip not in self.server.ip_limits:
                if len(self.server.ip_limits)>=1024:raise ChatError("IP_CAPACITY",429)
                self.server.ip_limits[ip]=RateLimiter(120)
            self.server.ip_limits[ip].take()
        headers = self.headers.get_all("Authorization", [])
        if len(headers) != 1 or not headers[0].startswith("Bearer "):
            raise ChatError("AUTHENTICATION_REQUIRED", 401)
        token = headers[0][7:]
        for known, principal in self.server.tokens.items():
            if hmac.compare_digest(token.encode(), known.encode()):
                return principal
        raise ChatError("AUTHENTICATION_REQUIRED", 401)
    def _body(self):
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(lengths) != 1:
            raise ChatError("CONTENT_LENGTH_REQUIRED", 411)
        if self.headers.get_content_type() != "application/json":
            raise ChatError("JSON_CONTENT_TYPE_REQUIRED", 415)
        try:
            count = int(lengths[0])
        except ValueError:
            raise ChatError("INVALID_CONTENT_LENGTH") from None
        if not 0 < count <= 32768:
            raise ChatError("REQUEST_SIZE_LIMIT", 413)
        raw = self.rfile.read(count)
        if len(raw) != count:
            raise ChatError("INCOMPLETE_REQUEST")
        body = strict_loads(raw)
        if not isinstance(body, dict):
            raise ChatError("OBJECT_REQUIRED")
        return body
    @staticmethod
    def _keys(body, required, optional=()):
        if not set(required).issubset(body) or set(body) - set(required) - set(optional):
            raise ChatError("EXACT_API_KEYS_REQUIRED")
    def _route(self):
        parsed = urlsplit(self.path)
        if parsed.query or parsed.fragment:
            raise ChatError("QUERY_NOT_SUPPORTED")
        path, method = parsed.path, self.command
        if method == "GET" and path == "/health":
            return 200, {"status": "ok", "schema": "astragron.conversation-api.v1"}
        principal = self._principal()
        service = self.server.service
        report_match=re.fullmatch(r"/v1/analyses/(a_[a-f0-9]{32})/report",path)
        if method=="GET" and report_match:
            from copy import deepcopy
            with service.lock:
                item=service._analysis(principal,report_match[1])
                return 200,{"analysis_id":report_match[1],"scientific_status":item.context.document["status"],
                            "report_dto":deepcopy(item.context.document["report_dto"]),"limitations":list(item.context.document.get("warnings",[]))}
        if method=="GET" and path=="/v1/status":
            if principal.subject_id not in self.server.diagnostics_subjects:raise ChatError("NOT_FOUND",404)
            return 200,service.health()
        if method == "GET" and path == "/v1/analyses":
            with service.lock:
                service._prune()
                ids = [{"reference": name, "analysis_id": aid} for name, aid in self.server.aliases.items()
                       if aid in service.analyses and service.analyses[aid].tenant_id == principal.tenant_id
                       and service.analyses[aid].context.farm_id in principal.farm_ids]
            return 200, {"analyses": ids}
        if method == "GET" and path == "/v1/openapi.json":
            return 200, strict_loads((Path(__file__).parent / "openapi.json").read_bytes())
        if method == "POST" and path == "/v1/conversations":
            body = self._body(); self._keys(body, ["analysis_id"], ["locale"])
            return 201, service.create_session(principal, body["analysis_id"], body.get("locale", "en"))
        match = re.fullmatch(r"/v1/conversations/(c_[a-f0-9]{32})(?:/(messages|analysis|compare|evidence)(?:/(ev_[a-f0-9]{24}))?)?", path)
        if not match:
            raise ChatError("NOT_FOUND", 404)
        sid, operation, evidence_id = match.groups()
        if method == "DELETE" and operation is None:
            return 200, service.delete_session(principal, sid)
        if method == "GET" and operation is None:
            return 200, service.history(principal, sid)
        if method == "GET" and operation == "evidence" and evidence_id:
            return 200, service.evidence(principal, sid, evidence_id)
        if method != "POST" or evidence_id:
            raise ChatError("METHOD_NOT_ALLOWED", 405)
        body = self._body()
        if operation == "messages":
            self._keys(body, ["message"], ["scope", "change", "quality_mode"])
            return 200, service.send(principal, sid, body["message"], body.get("scope"), body.get("change"), body.get("quality_mode","standard"))
        if operation == "analysis":
            self._keys(body, ["analysis_id"])
            return 200, service.attach(principal, sid, body["analysis_id"])
        if operation == "compare":
            self._keys(body, ["analysis_ids"])
            return 200, service.compare(principal, sid, body["analysis_ids"])
        raise ChatError("NOT_FOUND", 404)
    def _dispatch(self):
        try:
            status, body = self._route()
        except ChatError as error:
            self.server.service.metrics["http_errors"] += 1
            status, body = error.status, {"error": {"code": error.code}}
        except (ValueError, TypeError, KeyError, RecursionError):
            status, body = 400, {"error": {"code": "INVALID_REQUEST"}}
        except (TimeoutError, OSError):
            status, body = 503, {"error": {"code": "TRANSPORT_UNAVAILABLE"}}
        except Exception:
            status, body = 500, {"error": {"code": "INTERNAL_ERROR"}}
        try:
            self._write(status, body)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
    do_GET = _dispatch
    do_POST = _dispatch
    do_DELETE = _dispatch

def load_catalog(service, catalog_path):
    path = Path(catalog_path).resolve()
    catalog = strict_loads(path.read_bytes())
    if not isinstance(catalog, list) or len(catalog) > service.settings.max_analyses:
        raise ValueError("CATALOG_LIMIT")
    aliases = {}
    for row in catalog:
        if set(row) - {"reference", "tenant_id", "farm_id", "response", "request", "data_policy"}:
            raise ValueError("CATALOG_KEYS")
        def read_relative(name):
            target = (path.parent / row[name]).resolve()
            if not target.is_relative_to(path.parent):
                raise ValueError("CATALOG_PATH_SCOPE")
            if target.stat().st_size > 8 * 1024 * 1024:
                raise ValueError("CATALOG_FILE_LIMIT")
            return strict_loads(target.read_bytes())
        if row["reference"] in aliases:
            raise ValueError("DUPLICATE_CATALOG_REFERENCE")
        principal = Principal(row["tenant_id"], frozenset({row["farm_id"]}))
        aliases[row["reference"]] = service.register_analysis(principal, read_relative("response"),
                                                               read_relative("request") if row.get("request") else None,
                                                               public_research=row.get("data_policy")=="PUBLIC_RESEARCH_FIXTURE")
    return aliases

def main():
    parser = argparse.ArgumentParser(description="ASTRAGRON evidence-native conversation HTTP service")
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--enable-simulation", action="store_true")
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        parser.error("Bind locally; use an authenticated TLS reverse proxy for remote access")
    settings = Settings.from_env()
    tokens_config = strict_loads(os.environ.get("ASTRAGRON_CHAT_AUTH_TOKENS", "{}"))
    tokens = {token: Principal(info["tenant_id"], frozenset(info["farm_ids"]), info["subject_id"]) for token, info in tokens_config.items()}
    backend = EngineBackend(Path(__file__).resolve().parents[1], settings.simulation_timeout) if args.enable_simulation else None
    service = ConversationService(settings, backend=backend)
    aliases = load_catalog(service, args.catalog)
    diagnostics={info["subject_id"] for info in tokens_config.values() if info.get("diagnostics") is True}
    server = ChatHTTPServer((args.host, args.port), service, tokens, aliases,diagnostics)
    print("ASTRAGRON conversational API listening on", args.host, server.server_port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
