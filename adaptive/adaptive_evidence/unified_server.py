"""Runnable Local HTTP Server for the Unified ASTRAGRON System (Gate V).

Serves:
- `GET /` and `GET /research`: Upstream English 5-year research UI (`web/english_layout.html`)
- `GET /unified`: Interactive English Global Adaptive Evidence & 5-Year Research Workbench
- `GET /api/v1/adaptive-evidence/capabilities`: Global C1-C10 capability registry & 6 status outcomes
- `POST /api/v1/adaptive-evidence` & `POST /api/v1/unified-decision`: Unified evaluation (strict geometry + C1-C10 + 5Y research planner)
- `GET /api/v1/adaptive-evidence/results/<sha256>.(html|json|csv)`: Printable English HTML report, JSON export, and CSV export
- All upstream `/api/v1/research-decision` endpoints unchanged.
"""
from __future__ import annotations

import argparse
from http.server import ThreadingHTTPServer
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

from .capabilities import CAPABILITY_REGISTRY
from .inventory import ROOT, WATER_CORE_DIR
from .land_mask import get_natural_earth_index
from .unified_system import (
    GATE3_WORLDWIDE_12_SITES,
    UnifiedAstragronSystem,
)

if str(WATER_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(WATER_CORE_DIR))

import integration_server  # type: ignore

WEB_UNIFIED_DIR = Path(__file__).resolve().parent / "web_unified"
UNIFIED_WORKBENCH_HTML: bytes = (WEB_UNIFIED_DIR / "unified_workbench.html").read_bytes()
UNIFIED_STYLE_CSS: bytes = (WEB_UNIFIED_DIR / "unified_style.css").read_bytes()
UNIFIED_APP_JS: bytes = (WEB_UNIFIED_DIR / "unified_app.js").read_bytes()
_CACHED_WORLD_MAP_BYTES: bytes | None = None


def _get_world_map_bytes() -> bytes:
    """Return compact Public Domain Natural Earth ne_10m_land vector SVG paths JSON."""
    global _CACHED_WORLD_MAP_BYTES
    if _CACHED_WORLD_MAP_BYTES is not None:
        return _CACHED_WORLD_MAP_BYTES
    prebuilt = WEB_UNIFIED_DIR / "world_map_10m.json"
    if prebuilt.is_file():
        _CACHED_WORLD_MAP_BYTES = prebuilt.read_bytes()
        return _CACHED_WORLD_MAP_BYTES
    idx = get_natural_earth_index()
    paths = []
    for geom in idx.land_polygons:
        if geom.area < 0.02:
            continue
        simp = geom.simplify(0.25, preserve_topology=False)
        polys = simp.geoms if simp.geom_type == "MultiPolygon" else [simp]
        for p in polys:
            if p.is_empty or p.area < 0.02:
                continue
            coords = list(p.exterior.coords)
            if len(coords) < 3:
                continue
            paths.append("M" + "L".join(f"{x:.2f} {-y:.2f}" for x, y in coords) + "Z")
    payload = {
        "schema": "astragron.world-map.v1",
        "source": "Natural Earth ne_10m_land v5.1.1",
        "license": "Public Domain (Natural Earth Terms of Use)",
        "notice": "1:10,000,000 macro screening vector overlay only; not a field cadastre.",
        "viewBox": "-180 -90 360 180",
        "paths": paths,
    }
    _CACHED_WORLD_MAP_BYTES = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return _CACHED_WORLD_MAP_BYTES


def _load_presets_payload() -> dict:
    """Load interactive presets combining 5Y Codex A / WaterCore examples and global screening cases."""
    presets = []

    def _read_json(path: Path) -> dict | None:
        if path.is_file():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                return None
        return None

    supported = _read_json(ROOT / "examples" / "engine" / "supported_soil.json")
    if supported is not None:
        presets.append(
            {
                "id": "codex_a_supported_soil",
                "label": "Wagga AU — Codex A 5Y Supported Soil",
                "pin_lon_lat": [147.35, -35.05],
                "payload": supported,
            }
        )

    sweden = _read_json(WATER_CORE_DIR / "examples" / "sweden_planning.json")
    if sweden is not None:
        presets.append(
            {
                "id": "se_uppsala_5y",
                "label": "Uppsala SE — 5Y Planning",
                "pin_lon_lat": [17.65, 59.82],
                "payload": sweden,
            }
        )

    kenya = _read_json(WATER_CORE_DIR / "examples" / "kenya_research.json")
    if kenya is not None:
        presets.append(
            {
                "id": "ke_nyeri_5y",
                "label": "Nyeri KE — Rainfed Research",
                "pin_lon_lat": [36.95, -0.42],
                "payload": kenya,
            }
        )

    presets.extend(
        [
            {
                "id": "br_brasilia_screening",
                "label": "Brasilia BR — Adaptive Screening",
                "pin_lon_lat": [-47.90, -15.80],
                "payload": {
                    "schema": "astragron.adaptive-evidence.request.v1",
                    "request_id": "preset-br-brasilia",
                    "location": {
                        "site_id": "BR_BRASILIA_CERRADO",
                        "name": "Brasilia Cerrado Plateau, Brazil",
                        "point_lon_lat": [-47.90, -15.80],
                        "crs": "EPSG:4326",
                    },
                    "period": {"start": "2016-01-01", "end": "2020-12-31"},
                    "soil_depth_intervals_cm": [[0, 5]],
                    "candidate_crops": ["soybean", "maize", "sorghum"],
                    "water_supply_scenario": {"regime": "rainfed"},
                    "options": {"acquisition": "CACHE_ONLY", "allow_conditional_crop_planning": True},
                },
            },
            {
                "id": "fr_lyon_new_live",
                "label": "Lyon FR — Uncached Site (FETCH_ALLOWED)",
                "pin_lon_lat": [4.8357, 45.7640],
                "payload": {
                    "schema": "astragron.adaptive-evidence.request.v1",
                    "request_id": "preset-fr-lyon-uncached",
                    "location": {
                        "site_id": "FR_LYON_RHONE",
                        "name": "Lyon Rhone Valley, France",
                        "point_lon_lat": [4.8357, 45.7640],
                        "crs": "EPSG:4326",
                    },
                    "period": {"start": "2016-01-01", "end": "2020-12-31"},
                    "soil_depth_intervals_cm": [[0, 5], [5, 15], [15, 30]],
                    "candidate_crops": ["wheat", "maize", "rapeseed"],
                    "water_supply_scenario": {"regime": "rainfed"},
                    "options": {"acquisition": "FETCH_ALLOWED", "allow_conditional_crop_planning": True},
                },
            },
            {
                "id": "neg_heilbronn_uppsala_mismatch",
                "label": "Reject Test — Heilbronn/Uppsala Mismatch",
                "pin_lon_lat": [9.22, 49.14],
                "payload": {
                    "schema": "astragron.adaptive-evidence.request.v1",
                    "request_id": "preset-mismatch-heilbronn-uppsala",
                    "location": {
                        "site_id": "DE_HEILBRONN",
                        "name": "Heilbronn, Germany",
                        "point_lon_lat": [9.22, 49.14],
                        "crs": "EPSG:4326",
                    },
                    "research_decision_request": sweden
                    if sweden is not None
                    else {
                        "location": {
                            "site_id": "SE_UPPSALA",
                            "point_lon_lat": [17.65, 59.82],
                            "crs": "EPSG:4326",
                        }
                    },
                    "options": {"acquisition": "CACHE_ONLY"},
                },
            },
            {
                "id": "neg_ocean_gulf_guinea",
                "label": "Reject Test — Gulf of Guinea (Ocean)",
                "pin_lon_lat": [0.0, 0.0],
                "payload": {
                    "schema": "astragron.adaptive-evidence.request.v1",
                    "request_id": "preset-ocean-0-0",
                    "location": {
                        "site_id": "ATLANTIC_0_0",
                        "name": "Gulf of Guinea Ocean",
                        "point_lon_lat": [0.0, 0.0],
                        "crs": "EPSG:4326",
                    },
                    "period": {"start": "2016-01-01", "end": "2020-12-31"},
                    "options": {"acquisition": "CACHE_ONLY"},
                },
            },
        ]
    )
    return {"schema": "astragron.unified-presets.v1", "presets": presets}


class UnifiedRequestHandler(integration_server.Handler):
    """Unified HTTP handler supporting both `/api/v1/research-decision` and `/api/v1/adaptive-evidence`."""

    def do_GET(self) -> None:
        if not self.permitted():
            return self.reply(403, {"status": "LOCAL_ORIGIN_REQUIRED"})
        path = urlsplit(self.path)
        route = path.path

        if route == "/unified":
            return self.reply(200, UNIFIED_WORKBENCH_HTML, "text/html; charset=utf-8")

        if route == "/unified-style.css":
            return self.reply(200, UNIFIED_STYLE_CSS, "text/css; charset=utf-8")

        if route == "/unified-app.js":
            return self.reply(200, UNIFIED_APP_JS, "application/javascript; charset=utf-8")

        if route == "/api/v1/adaptive-evidence/world-map.json":
            return self.reply(200, _get_world_map_bytes(), "application/json; charset=utf-8")

        if route == "/api/v1/adaptive-evidence/presets":
            return self.reply(200, _load_presets_payload())

        if route == "/api/v1/adaptive-evidence/capabilities":
            return self.reply(
                200,
                {
                    "schema": "astragron.adaptive-evidence.capabilities.v1",
                    "status_outcomes": [
                        "INVALID_LOCATION_OR_GEOMETRY",
                        "WATER_OR_UNVERIFIED_LOCATION",
                        "CLIMATE_READY_SOIL_PARTIAL",
                        "SOIL_READY_CLIMATE_PARTIAL",
                        "REGIONAL_SCREENING_ONLY",
                        "CONDITIONAL_RESEARCH_COMPARISON",
                        "EVIDENCE_BLOCKED",
                    ],
                    "capabilities": {
                        cid: {
                            "capability_id": cid,
                            "name": spec.name,
                            "allowed_statuses": ["READY", "CONDITIONAL", "BLOCKED", "NOT_EVALUATED"],
                        }
                        for cid, spec in CAPABILITY_REGISTRY.items()
                    },
                    "worldwide_12_sites": [
                        {
                            "site_id": s["site_id"],
                            "country": s["country"],
                            "continent": s["continent"],
                            "point_lon_lat": s["point_lon_lat"],
                        }
                        for s in GATE3_WORLDWIDE_12_SITES
                    ],
                },
            )

        match = re.fullmatch(
            r"/api/v1/adaptive-evidence/results/([a-f0-9]{64})\.(html|json|csv)", route
        )
        if match:
            res_id, fmt = match.group(1), match.group(2)
            out_bytes = self.server.unified_system.export_result(res_id, fmt)
            if out_bytes is None:
                return self.reply(404, {"status": "RESULT_NOT_IN_LOCAL_SESSION"})
            mime = (
                "text/html; charset=utf-8"
                if fmt == "html"
                else "application/json; charset=utf-8"
                if fmt == "json"
                else "text/csv; charset=utf-8"
            )
            dl_name = None if fmt == "html" else f"astragron_{res_id[:16]}.{fmt}"
            return self.reply(200, out_bytes, mime, dl_name)

        return super().do_GET()

    def do_POST(self) -> None:
        route = urlsplit(self.path).path
        if route in ("/api/v1/adaptive-evidence", "/api/v1/unified-decision"):
            if not self.permitted():
                return self.reply(403, {"status": "LOCAL_ORIGIN_REQUIRED"})
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return self.reply(415, {"status": "JSON_REQUIRED"})
            try:
                n = int(self.headers.get("Content-Length", "0"))
                if n <= 0 or n > 2_097_152:
                    return self.reply(400, {"status": "INVALID_CONTENT_LENGTH"})
                raw = self.rfile.read(n)
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                return self.reply(
                    400,
                    {
                        "status": "INVALID_JSON_BODY",
                        "status_outcome": "INVALID_LOCATION_OR_GEOMETRY",
                        "field_recommendation": None,
                    },
                )
            env = self.server.unified_system.evaluate_unified(body)
            return self.reply(200, env)

        return super().do_POST()


def create_unified_http_server(
    host: str = "127.0.0.1", port: int = 8080
) -> ThreadingHTTPServer:
    """Create and return a configured `ThreadingHTTPServer` instance."""
    httpd = ThreadingHTTPServer((host, port), UnifiedRequestHandler)
    httpd.application = integration_server.Service()  # type: ignore[attr-defined]
    httpd.unified_system = UnifiedAstragronSystem()  # type: ignore[attr-defined]
    return httpd


def main() -> None:
    parser = argparse.ArgumentParser(description="Start the Unified ASTRAGRON Local Server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    httpd = create_unified_http_server(args.host, args.port)
    actual_port = httpd.server_address[1]
    print(
        json.dumps(
            {
                "status": "ASTRAGRON_UNIFIED_SERVER_LISTENING",
                "research_ui_url": f"http://{args.host}:{actual_port}/research",
                "unified_workbench_url": f"http://{args.host}:{actual_port}/unified",
                "adaptive_api_url": f"http://{args.host}:{actual_port}/api/v1/adaptive-evidence",
                "research_api_url": f"http://{args.host}:{actual_port}/api/v1/research-decision",
            }
        ),
        flush=True,
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
