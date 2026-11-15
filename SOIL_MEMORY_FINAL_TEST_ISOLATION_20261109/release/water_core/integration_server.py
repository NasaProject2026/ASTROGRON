"""Upstream water_core integration_server base handler and service."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler
import json
from typing import Any
from urllib.parse import urlparse

from application import Service as ApplicationService


class Service(ApplicationService):
    """HTTP application service wrapper."""


class Handler(BaseHTTPRequestHandler):
    """Base HTTP handler for research workbench and unified server."""

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def permitted(self) -> bool:
        return True

    def send_raw(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_raw(status, "application/json; charset=utf-8", body)

    def reply(
        self,
        status: int,
        payload: Any,
        content_type: str = "application/json; charset=utf-8",
        *extra: Any,
        **kwargs: Any,
    ) -> None:
        if isinstance(payload, (bytes, bytearray)):
            self.send_raw(status, content_type, bytes(payload))
        elif isinstance(payload, str):
            self.send_raw(status, content_type, payload.encode("utf-8"))
        else:
            self.send_json(status, payload)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/", "/research"):
            html = (
                b"<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>"
                b"<title>ASTRAGRON Research Decision Workbench</title></head>"
                b"<body><h1>ASTRAGRON 5-Year Conditional Research Workbench</h1>"
                b"<p>Navigate to <a href='/unified'>/unified</a> for the Unified Global Adaptive Evidence Workbench.</p>"
                b"</body></html>"
            )
            self.send_raw(200, "text/html; charset=utf-8", html)
            return
        self.send_json(404, {"status": "NOT_FOUND", "path": path})

    def do_POST(self) -> None:  # noqa: N802
        self.send_json(404, {"status": "NOT_FOUND"})
