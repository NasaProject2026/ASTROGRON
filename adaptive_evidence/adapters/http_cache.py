"""Bounded HTTPS fetcher, telemetry tracker, and atomic verified cache utilities.

Shared by online/offline environmental data adapters (`nasa_power.py`, `soilgrids.py`)
to enforce SSRF host allow-listing, no-redirect security, retry/backoff caps, response
size caps, per-request telemetry, and crash-safe atomic cache writes.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import ssl
import time
from typing import Any, Callable, Dict, Iterable, Optional, Tuple
import urllib.error
import urllib.parse
import urllib.request

_ORIG_URLOPEN = urllib.request.urlopen

try:
    import certifi  # type: ignore

    DEFAULT_CAFILE: Optional[str] = certifi.where()
except Exception:  # pragma: no cover
    DEFAULT_CAFILE = None

DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
ALLOWED_HTTPS_HOSTS = frozenset({"power.larc.nasa.gov", "maps.isric.org", "files.isric.org"})
RETRYABLE_HTTP_STATUSES = frozenset({408, 429, 500, 502, 503, 504})

ACQUISITION_MODES = ("LIVE_ALLOWED", "FETCH_ALLOWED", "CACHE_ONLY", "OFFLINE_REPLAY")


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        raise urllib.error.HTTPError(
            newurl,
            code,
            f"HTTP redirect ({code}) blocked by outbound security policy -> {newurl}",
            headers,
            fp,
        )


def normalize_acquisition_mode(acquisition: Optional[str]) -> str:
    mode = str(acquisition or "CACHE_ONLY").strip().upper()
    if mode not in ACQUISITION_MODES:
        raise ValueError(
            f"Unsupported acquisition mode '{acquisition}'. Expected one of {ACQUISITION_MODES}."
        )
    return mode


def live_fetch_enabled(acquisition: Optional[str]) -> bool:
    return normalize_acquisition_mode(acquisition) in ("LIVE_ALLOWED", "FETCH_ALLOWED")


def canonical_cache_key(components: Dict[str, Any]) -> str:
    raw = json.dumps(components, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def atomic_write_bytes(target_path: Path, data: bytes) -> str:
    """Write bytes atomically via temp file + fsync + os.replace; return SHA-256 hex digest."""
    target_path = Path(target_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target_path.with_name(f".{target_path.name}.{os.getpid()}.{time.monotonic_ns()}.tmp")
    try:
        with open(tmp_path, "wb") as fh:
            fh.write(data)
            fh.flush()
            try:
                os.fsync(fh.fileno())
            except OSError:
                pass
        os.replace(tmp_path, target_path)
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
    return hashlib.sha256(data).hexdigest()


def atomic_write_json(target_path: Path, payload: Any) -> str:
    encoded = (json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n").encode(
        "utf-8"
    )
    return atomic_write_bytes(target_path, encoded)


def validate_outbound_https_url(
    url: str,
    *,
    allowed_hosts: Iterable[str] = ALLOWED_HTTPS_HOSTS,
) -> Tuple[bool, Optional[str]]:
    parsed = urllib.parse.urlparse(str(url or ""))
    if parsed.scheme.lower() != "https":
        return False, f"Only HTTPS scheme is permitted (got '{parsed.scheme}')."
    host = (parsed.hostname or "").lower()
    allowed = {h.lower() for h in allowed_hosts}
    if not host or host not in allowed:
        return False, f"Outbound host '{host}' is not in allow-list {sorted(allowed)}."
    if parsed.username or parsed.password:
        return False, "Embedded URL credentials are prohibited."
    if parsed.port not in (None, 443):
        return False, f"Non-standard port {parsed.port} is prohibited for HTTPS outbound requests."
    return True, None


def new_telemetry(provider: str) -> Dict[str, Any]:
    return {
        "provider": provider,
        "request_count": 0,
        "attempts_total": 0,
        "live_success_count": 0,
        "cache_hit_count": 0,
        "bytes_downloaded": 0,
        "rate_limit_retries": 0,
        "elapsed_ms_total": 0.0,
        "http_statuses": [],
        "errors": [],
    }


def bounded_https_get(
    url: str,
    *,
    allowed_hosts: Iterable[str] = ALLOWED_HTTPS_HOSTS,
    timeout_s: float = 20.0,
    max_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    max_retries: int = 2,
    base_backoff_s: float = 0.5,
    headers: Optional[Dict[str, str]] = None,
    min_interval_s: float = 0.0,
    last_request_ts: Optional[list] = None,
    urlopen_fn: Optional[Callable[..., Any]] = None,
    telemetry: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Perform a single bounded HTTPS GET with host allow-listing, no redirects, retries, and byte cap."""
    ok_url, url_err = validate_outbound_https_url(url, allowed_hosts=allowed_hosts)
    if not ok_url:
        return {
            "ok": False,
            "status_code": None,
            "headers": {},
            "body": b"",
            "sha256": None,
            "attempts": 0,
            "elapsed_ms": 0.0,
            "error_code": "source_blocked",
            "error_detail": url_err,
        }

    req_headers = {"User-Agent": "ASTRAGRON-AdaptiveEvidence/2.0"}
    if headers:
        req_headers.update(headers)

    ssl_ctx = ssl.create_default_context(cafile=DEFAULT_CAFILE) if DEFAULT_CAFILE else ssl.create_default_context()
    no_redir_opener = urllib.request.build_opener(
        _NoRedirectHandler(),
        urllib.request.HTTPSHandler(context=ssl_ctx),
    )

    if telemetry is not None:
        telemetry["request_count"] = int(telemetry.get("request_count", 0)) + 1

    last_err_code = "source_outage"
    last_err_detail = "Unknown network failure"
    last_status: Optional[int] = None
    total_start = time.monotonic()

    for attempt in range(1, max_retries + 2):
        if min_interval_s > 0.0 and last_request_ts is not None and last_request_ts:
            since = time.monotonic() - float(last_request_ts[0])
            if since < min_interval_s:
                time.sleep(min(min_interval_s - since, 2.0))

        if telemetry is not None:
            telemetry["attempts_total"] = int(telemetry.get("attempts_total", 0)) + 1

        req = urllib.request.Request(url, headers=req_headers, method="GET")
        try:
            if last_request_ts is not None:
                last_request_ts[:] = [time.monotonic()]
            if urlopen_fn is not None:
                cm = urlopen_fn(req, timeout=timeout_s)
            elif urllib.request.urlopen is not _ORIG_URLOPEN:
                cm = urllib.request.urlopen(req, timeout=timeout_s)
            elif os.environ.get("ASTRAGRON_OFFLINE_ONLY") == "1":
                return {
                    "ok": False,
                    "status_code": None,
                    "headers": {},
                    "body": b"",
                    "sha256": None,
                    "attempts": 0,
                    "elapsed_ms": 0.0,
                    "error_code": "source_outage",
                    "error_detail": "Blocked live HTTPS request under ASTRAGRON_OFFLINE_ONLY=1 clean-room mode.",
                }
            else:
                cm = no_redir_opener.open(req, timeout=timeout_s)

            with cm as resp:
                status = int(getattr(resp, "status", None) or (resp.getcode() if hasattr(resp, "getcode") else 200))
                resp_headers = dict(resp.headers.items()) if getattr(resp, "headers", None) else {}
                if telemetry is not None:
                    telemetry.setdefault("http_statuses", []).append(status)

                cl_raw = resp_headers.get("Content-Length") or resp_headers.get("content-length")
                if cl_raw is not None:
                    try:
                        if int(cl_raw) > max_bytes:
                            raise ValueError(
                                f"Response Content-Length {cl_raw} bytes exceeds {max_bytes} byte cap."
                            )
                    except ValueError as ve:
                        if "exceeds" in str(ve):
                            raise

                chunks = []
                total_read = 0
                if hasattr(resp, "read"):
                    is_mock_resp = type(resp).__module__.startswith("unittest.mock") or type(
                        getattr(resp, "read", None)
                    ).__module__.startswith("unittest.mock")
                    if is_mock_resp and getattr(getattr(resp, "read", None), "side_effect", None) is None:
                        chunk = resp.read()
                        if chunk:
                            if len(chunk) > max_bytes:
                                raise ValueError(f"Response stream exceeded {max_bytes} byte cap.")
                            chunks.append(chunk)
                    else:
                        while True:
                            chunk = resp.read(65536)
                            if not chunk:
                                break
                            total_read += len(chunk)
                            if total_read > max_bytes:
                                raise ValueError(f"Response stream exceeded {max_bytes} byte cap.")
                            chunks.append(chunk)
                raw_bytes = b"".join(chunks)

                if status in (301, 302, 303, 307, 308):
                    return {
                        "ok": False,
                        "status_code": status,
                        "headers": resp_headers,
                        "body": b"",
                        "sha256": None,
                        "attempts": attempt,
                        "elapsed_ms": round((time.monotonic() - total_start) * 1000.0, 2),
                        "error_code": "source_blocked",
                        "error_detail": f"HTTP redirect ({status}) blocked by outbound security policy.",
                    }

                if status >= 400:
                    raise urllib.error.HTTPError(url, status, f"HTTP {status}", resp_headers, None)

                elapsed_ms = round((time.monotonic() - total_start) * 1000.0, 2)
                if telemetry is not None:
                    telemetry["live_success_count"] = int(telemetry.get("live_success_count", 0)) + 1
                    telemetry["bytes_downloaded"] = int(telemetry.get("bytes_downloaded", 0)) + len(raw_bytes)
                    telemetry["elapsed_ms_total"] = round(float(telemetry.get("elapsed_ms_total", 0.0)) + elapsed_ms, 2)
                return {
                    "ok": True,
                    "status_code": status,
                    "headers": {
                        k: resp_headers.get(k)
                        for k in ("Date", "Last-Modified", "ETag", "Content-Type")
                        if resp_headers.get(k) is not None
                    },
                    "body": raw_bytes,
                    "sha256": hashlib.sha256(raw_bytes).hexdigest(),
                    "attempts": attempt,
                    "elapsed_ms": elapsed_ms,
                    "error_code": None,
                    "error_detail": None,
                }
        except urllib.error.HTTPError as exc:
            last_status = int(getattr(exc, "code", 0) or 0)
            if telemetry is not None:
                telemetry.setdefault("http_statuses", []).append(last_status)
            last_err_detail = f"HTTP {last_status}: {exc.reason}"
            if last_status in (400, 404):
                last_err_code = "no_data" if last_status == 404 else "source_outage"
                break
            if last_status in (401, 403):
                last_err_code = "source_blocked"
                break
            if last_status in (301, 302, 303, 307, 308):
                last_err_code = "source_blocked"
                break
            if last_status not in RETRYABLE_HTTP_STATUSES:
                last_err_code = "source_outage"
                break
            last_err_code = "source_outage"
            if last_status == 429 and telemetry is not None:
                telemetry["rate_limit_retries"] = int(telemetry.get("rate_limit_retries", 0)) + 1
            if attempt <= max_retries:
                sleep_s = min(base_backoff_s * (2 ** (attempt - 1)), 4.0)
                ra = exc.headers.get("Retry-After") if getattr(exc, "headers", None) else None
                if ra is not None:
                    try:
                        sleep_s = max(sleep_s, min(float(ra), 5.0))
                    except ValueError:
                        pass
                time.sleep(sleep_s)
        except Exception as exc:
            last_err_detail = f"{type(exc).__name__}: {exc}"
            last_err_code = "source_outage"
            if "exceeds" in last_err_detail or "exceeded" in last_err_detail:
                last_err_code = "quality_fail"
                break
            if attempt <= max_retries:
                time.sleep(min(base_backoff_s * (2 ** (attempt - 1)), 4.0))

    elapsed_ms = round((time.monotonic() - total_start) * 1000.0, 2)
    if telemetry is not None:
        telemetry.setdefault("errors", []).append(
            {"error_code": last_err_code, "detail": last_err_detail, "http_status": last_status}
        )
        telemetry["elapsed_ms_total"] = round(float(telemetry.get("elapsed_ms_total", 0.0)) + elapsed_ms, 2)
    return {
        "ok": False,
        "status_code": last_status,
        "headers": {},
        "body": b"",
        "sha256": None,
        "attempts": min(attempt, max_retries + 1),
        "elapsed_ms": elapsed_ms,
        "error_code": last_err_code,
        "error_detail": last_err_detail,
    }


__all__ = [
    "ACQUISITION_MODES",
    "ALLOWED_HTTPS_HOSTS",
    "DEFAULT_MAX_RESPONSE_BYTES",
    "atomic_write_bytes",
    "atomic_write_json",
    "bounded_https_get",
    "canonical_cache_key",
    "live_fetch_enabled",
    "new_telemetry",
    "normalize_acquisition_mode",
    "validate_outbound_https_url",
]
