"""Comprehensive Unified Acceptance & Regression Tests covering Blockers 1-5."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from adaptive_evidence.adapters.nasa_power import NASAPowerAdapter
from adaptive_evidence.adapters.soilgrids import SoilGridsWCSAdapter
from adaptive_evidence.unified_server import (
    UNIFIED_APP_JS,
    UNIFIED_STYLE_CSS,
    UNIFIED_WORKBENCH_HTML,
    create_unified_http_server,
)
from adaptive_evidence.unified_system import UnifiedAstragronSystem
from brain.service import ClientDecisionService


class UnifiedFinalAcceptanceRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.system = UnifiedAstragronSystem()

    def test_client_decision_route_preserves_canonical_codex_a_no_double_run(self) -> None:
        request = json.loads((ROOT / "examples/engine/supported_soil.json").read_text(encoding="utf-8"))
        expected = ClientDecisionService().run(request)
        self.assertEqual(expected["status"], "CONDITIONAL_RESEARCH_COMPLETE")

        with mock.patch.object(
            self.system.water_core_service,
            "run",
            side_effect=AssertionError("water_core_service.run must not be double-executed for client-decision"),
        ):
            actual = self.system.evaluate_unified(request)

        canonical = actual.get("upstream_client_decision_response")
        self.assertIsInstance(canonical, dict, "Unified response omitted canonical ClientDecisionService response")
        for field in ("status", "decision", "alternatives", "qualification", "nutrient_response", "report_dto"):
            self.assertEqual(canonical.get(field), expected.get(field), f"Client engine field diverged: {field}")
        self.assertIn(actual.get("status_outcome"), ("CONDITIONAL_RESEARCH_COMPARISON", "CONDITIONAL_RESEARCH_COMPLETE"))

        html_bytes = self.system.export_result(actual["result_id"], "html")
        self.assertIsNotNone(html_bytes)
        html_text = html_bytes.decode("utf-8")
        self.assertIn("ClientDecisionService", html_text)
        self.assertIn("report_dto", html_text)
        self.assertIn("Codex B customer PDF renderer was not supplied", html_text)

    def test_client_decision_blocked_examples_preserve_canonical_without_false_upgrade(self) -> None:
        for fname in ("growth_decision.json", "missing_evidence.json"):
            req = json.loads((ROOT / "examples/engine" / fname).read_text(encoding="utf-8"))
            expected = ClientDecisionService().run(req)
            actual = self.system.evaluate_unified(req)
            canonical = actual.get("upstream_client_decision_response")
            self.assertIsInstance(canonical, dict)
            self.assertEqual(canonical.get("status"), expected.get("status"))
            self.assertNotEqual(actual.get("status_outcome"), "CONDITIONAL_RESEARCH_COMPARISON")

    def test_adaptive_only_request_never_invents_5y_plan(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "adaptive-only-no-5y",
            "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
            "period": {"start": "2016-01-01", "end": "2020-12-31"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat", "barley"],
            "water_supply_scenario": {"regime": "rainfed"},
            "options": {"acquisition": "CACHE_ONLY"},
        }
        actual = self.system.evaluate_unified(req)
        self.assertIsNone(actual.get("five_year_research_plan"))
        self.assertIsNone(actual.get("upstream_client_decision_response"))
        self.assertEqual(actual["status_outcome"], "REGIONAL_SCREENING_ONLY")

    def test_nested_research_request_cannot_target_a_different_farm(self) -> None:
        research = json.loads(
            (ROOT / "SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release/water_core/examples/sweden_planning.json").read_text(
                encoding="utf-8"
            )
        )
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "wrong-farm-geography",
            "location": {"site_id": "DE_HEILBRONN", "point_lon_lat": [9.22, 49.14], "crs": "EPSG:4326"},
            "period": {"start": "2016-01-01", "end": "2020-12-31"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat"],
            "water_supply_scenario": {"regime": "rainfed"},
            "options": {"acquisition": "CACHE_ONLY", "allow_offline_reference_fixture": False},
            "research_decision_request": research,
        }
        with (
            mock.patch.object(self.system.nasa, "fetch_or_load", side_effect=AssertionError("NASA must not run on mismatch")),
            mock.patch.object(self.system.soilgrids, "fetch_or_load", side_effect=AssertionError("SoilGrids must not run on mismatch")),
            mock.patch.object(self.system.water_core_service, "run", side_effect=AssertionError("5Y must not run on mismatch")),
        ):
            result = self.system.evaluate_unified(req)

        self.assertIn(result["status_outcome"], ("INVALID_LOCATION_OR_GEOMETRY", "EVIDENCE_BLOCKED"))
        plan = result.get("five_year_research_plan")
        self.assertFalse(plan and plan.get("status") == "RESEARCH_COMPARISON_COMPLETE")
        self.assertEqual(result["adaptive_evidence"]["capabilities"]["C1"].get("missing_reason"), "spatial_mismatch")
        self.assertEqual(result["adaptive_evidence"]["provenance_and_uncertainty_ledger"]["evidence_objects"], [])

    def test_nearby_mismatch_crs_mismatch_and_field_geojson_rejection(self) -> None:
        # Nearby ~500m coordinate mismatch inside client-decision engine_request
        nearby_req = {
            "schema": "astragron.client-decision.request.v1",
            "farm_id": "nearby-mismatch",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "engine_request": {
                "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.66, 59.82], "crs": "EPSG:4326"},
                "fields": [{"field_id": "F1", "crop_candidates": ["barley"]}],
            },
        }
        r_near = self.system.evaluate_unified(nearby_req)
        self.assertEqual(r_near["status_outcome"], "INVALID_LOCATION_OR_GEOMETRY")
        self.assertEqual(r_near["adaptive_evidence"]["capabilities"]["C1"]["missing_reason"], "spatial_mismatch")
        self.assertIsNone(r_near.get("upstream_client_decision_response"))

        # Malformed field-level geometry > 25 km away inside research request
        far_field_req = {
            "schema": "astragron.research-decision.request.v1",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "horizon_years": 5,
            "scenarios": [{"scenario_id": "S1", "start": "2016-01-01", "end": "2020-12-31"}],
            "fields": [
                {
                    "field_id": "F1",
                    "point_lon_lat": [9.22, 49.14],
                    "crop_candidates": ["barley"],
                }
            ],
        }
        r_field = self.system.evaluate_unified(far_field_req)
        self.assertEqual(r_field["status_outcome"], "INVALID_LOCATION_OR_GEOMETRY")
        self.assertEqual(r_field["adaptive_evidence"]["capabilities"]["C1"]["missing_reason"], "spatial_mismatch")

        # CRS mismatch in nested object
        bad_crs_req = {
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "research_decision_request": {
                "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:3857"}
            },
        }
        r_crs = self.system.evaluate_unified(bad_crs_req)
        self.assertEqual(r_crs["status_outcome"], "INVALID_LOCATION_OR_GEOMETRY")
        self.assertEqual(r_crs["adaptive_evidence"]["capabilities"]["C1"]["missing_reason"], "invalid_coordinates_or_crs")

    def test_genuine_multifield_and_antimeridian_coherence_allowed(self) -> None:
        # Two fields within 1.5 km on the same Uppsala farm should pass coherence cleanly
        multi_req = {
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "fields": [
                {"field_id": "F1", "point_lon_lat": [17.652, 59.821]},
                {"field_id": "F2", "point_lon_lat": [17.658, 59.824]},
            ],
        }
        coh = self.system._validate_cross_request_location_coherence(multi_req)
        self.assertTrue(coh["valid"], coh.get("detail"))

        # Antimeridian same-region points (179.999 vs -179.999 is ~220 m across dateline, not 360 deg!)
        anti_req = {
            "location": {"point_lon_lat": [179.999, 66.5], "crs": "EPSG:4326"},
            "fields": [{"field_id": "F_WEST", "point_lon_lat": [-179.999, 66.5]}],
        }
        anti_coh = self.system._validate_cross_request_location_coherence(anti_req)
        self.assertTrue(anti_coh["valid"], anti_coh.get("detail"))

    def test_unified_frontend_must_accept_user_site_and_run_analysis(self) -> None:
        html = UNIFIED_WORKBENCH_HTML.decode("utf-8")
        self.assertIn("<input", html)
        self.assertIn("<button", html)
        self.assertIn("/api/v1/adaptive-evidence", html)
        self.assertTrue("<script" in html or ".js" in html)
        # Ensure strict CSP compliance: zero inline script bodies or inline onclick/style attributes
        self.assertNotIn("onclick=", html.lower())
        self.assertIn("/unified-app.js", html)
        self.assertIn("/unified-style.css", html)
        self.assertIn("buildPayloadFromForm", UNIFIED_APP_JS.decode("utf-8"))
        self.assertIn(".layout-grid", UNIFIED_STYLE_CSS.decode("utf-8"))

        httpd = create_unified_http_server("127.0.0.1", 0)
        port = httpd.server_address[1]
        base_url = f"http://127.0.0.1:{port}"
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            for route, must_contain in (
                ("/unified", "<input"),
                ("/unified-style.css", "--accent"),
                ("/unified-app.js", "/api/v1/adaptive-evidence"),
                ("/api/v1/adaptive-evidence/world-map.json", "Natural Earth ne_10m_land"),
                ("/api/v1/adaptive-evidence/presets", "codex_a_supported_soil"),
                ("/api/v1/adaptive-evidence/capabilities", "SOIL_READY_CLIMATE_PARTIAL"),
            ):
                req = urllib.request.Request(f"{base_url}{route}", headers={"Host": f"127.0.0.1:{port}"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    self.assertEqual(resp.status, 200)
                    body = resp.read().decode("utf-8")
                    self.assertIn(must_contain, body)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_new_valid_site_without_cache_does_not_fabricate_climate(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "new-uncached-site-lyon",
            "location": {"site_id": "FR_LYON", "point_lon_lat": [4.8357, 45.7640], "crs": "EPSG:4326"},
            "period": {"start": "2018-01-01", "end": "2018-12-31"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat"],
            "water_supply_scenario": {"regime": "rainfed"},
            "options": {"acquisition": "CACHE_ONLY", "allow_offline_reference_fixture": False},
        }
        result = self.system.evaluate_unified(req)
        self.assertEqual(result["capability_statuses"]["C1"], "READY")
        self.assertEqual(result["capability_statuses"]["C2"], "BLOCKED")
        self.assertNotEqual(result["status_outcome"], "CONDITIONAL_RESEARCH_COMPARISON")

    def test_soil_ready_climate_partial_classification_and_utc_timestamp(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "soil-only-climate-outage",
            "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat", "barley"],
            "water_supply_scenario": {"regime": "rainfed"},
            "options": {"simulate_nasa_outage": True, "simulate_soilgrids_outage": False},
        }
        res = self.system.evaluate_unified(req)
        self.assertEqual(res["capability_statuses"]["C2"], "BLOCKED")
        self.assertEqual(res["capability_statuses"]["C3"], "CONDITIONAL")
        self.assertEqual(res["capability_statuses"]["C7"], "BLOCKED")
        self.assertEqual(res["status_outcome"], "SOIL_READY_CLIMATE_PARTIAL")

        # Verify SoilGrids live WCS helper stamps real UTC date (never hardcoded 2026-11-08)
        with tempfile.TemporaryDirectory() as td:
            adapter = SoilGridsWCSAdapter(cache_dir=Path(td))
            fake_tiff = b"fake-geotiff-bytes"
            with (
                mock.patch("adaptive_evidence.adapters.soilgrids.urllib.request.urlopen") as m_open,
                mock.patch("adaptive_evidence.adapters.soilgrids.decode_wcs_int16_geotiff", return_value=[200]),
            ):
                ctx = m_open.return_value.__enter__.return_value
                ctx.status = 200
                ctx.read.return_value = fake_tiff
                receipt, _ = adapter.fetch_live_wcs_profile(4.8357, 45.7640, (0, 5))
                self.assertFalse(receipt["retrieved_at"].startswith("2026-11-08"))
                self.assertIn("+00:00", receipt["retrieved_at"])

    def test_live_uncached_coordinate_fetch_allowed_in_isolated_temp_cache(self) -> None:
        # Tests live global FETCH_ALLOWED on rural FR_BEAUCE_FIELD [1.60, 48.35] AND verifies
        # downtown Lyon [4.8357, 45.7640] urban mask fails closed (POINT_PIXEL_MISSING) without
        # borrowing a pixel ~2 km away.
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            iso_sys = UnifiedAstragronSystem(
                nasa_cache_dir=tmp / "nasa",
                soilgrids_cache_dir=tmp / "soil",
            )
            rural_req = {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "beauce-live-isolated-test",
                "location": {"site_id": "FR_BEAUCE_FIELD", "point_lon_lat": [1.60, 48.35], "crs": "EPSG:4326"},
                "period": {"start": "2018-01-01", "end": "2018-12-31"},
                "soil_depth_intervals_cm": [[0, 5]],
                "candidate_crops": ["wheat", "maize", "rapeseed"],
                "water_supply_scenario": {"regime": "rainfed"},
                "options": {"acquisition": "FETCH_ALLOWED", "allow_conditional_crop_planning": True},
            }
            if os.environ.get("ASTRAGRON_OFFLINE_ONLY") == "1":
                import io, struct, urllib.parse
                from datetime import date, timedelta

                def _build_epsg4326_tiff(lon: float, lat: float, pixel_val: int) -> bytes:
                    # 1x1 int16 uncompressed GeoTIFF centered exactly at (lon, lat)
                    scale = 0.002
                    px_bytes = struct.pack("<h", int(pixel_val))
                    header = bytearray(b"II\x2a\x00\x08\x00\x00\x00")
                    # Prepare external data blocks first, offsets patched after IFD length known
                    ps_bytes = struct.pack("<3d", scale, scale, 0.0)
                    tp_bytes = struct.pack("<6d", 0.0, 0.0, 0.0, lon - scale * 0.5, lat + scale * 0.5, 0.0)
                    gkeys = struct.pack("<8H", 1, 1, 0, 1, 1024, 0, 1, 2)
                    gkeys = struct.pack("<12H", 1, 1, 0, 2, 1024, 0, 1, 2, 2048, 0, 1, 4326)
                    nodata_b = b"-32768\x00"
                    # IFD entries: 13 tags
                    entries_spec = [
                        (256, 4, 1, 1, None),
                        (257, 4, 1, 1, None),
                        (258, 3, 1, 16, None),
                        (259, 3, 1, 1, None),
                        (273, 4, 1, 0, b"STRIP"),
                        (277, 3, 1, 1, None),
                        (278, 4, 1, 1, None),
                        (279, 4, 1, len(px_bytes), None),
                        (339, 3, 1, 2, None),
                        (33550, 12, 3, 0, ps_bytes),
                        (33922, 12, 6, 0, tp_bytes),
                        (34735, 3, len(gkeys) // 2, 0, gkeys),
                        (42113, 2, len(nodata_b), 0, nodata_b),
                    ]
                    ifd_start = 8
                    ifd_len = 2 + 12 * len(entries_spec) + 4
                    cursor = ifd_start + ifd_len
                    buf = bytearray(header + b"\x00" * ifd_len)
                    strip_off = cursor
                    buf.extend(px_bytes)
                    cursor += len(px_bytes)
                    struct.pack_into("<H", buf, ifd_start, len(entries_spec))
                    for idx, (tag, ftype, cnt, imm, ext) in enumerate(entries_spec):
                        pos = ifd_start + 2 + idx * 12
                        if ext == b"STRIP":
                            val = strip_off
                        elif ext is not None:
                            val = cursor
                            buf.extend(ext)
                            cursor += len(ext)
                        else:
                            val = imm
                        struct.pack_into("<HHII", buf, pos, tag, ftype, cnt, val)
                    struct.pack_into("<I", buf, ifd_start + 2 + len(entries_spec) * 12, 0)
                    return bytes(buf)

                def _power_payload(lon: float, lat: float) -> bytes:
                    days = {}
                    cur = date(2018, 1, 1)
                    while cur <= date(2018, 12, 31):
                        days[cur.strftime("%Y%m%d")] = None
                        cur += timedelta(days=1)
                    dkeys = sorted(days.keys())
                    payload = {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [lon, lat, 120.0]},
                        "header": {
                            "api": {"version": "v2.10.3", "name": "POWER Daily API"},
                            "sources": ["MERRA2"],
                            "fill_value": -999.0,
                            "start": "20180101",
                            "end": "20181231",
                        },
                        "parameters": {
                            "T2M_MIN": {"units": "C"},
                            "T2M_MAX": {"units": "C"},
                            "T2M": {"units": "C"},
                            "PRECTOTCORR": {"units": "mm/day"},
                        },
                        "properties": {
                            "parameter": {
                                "T2M_MIN": {k: 7.0 for k in dkeys},
                                "T2M_MAX": {k: 17.5 for k in dkeys},
                                "T2M": {k: 12.2 for k in dkeys},
                                "PRECTOTCORR": {k: (2.0 if i % 3 == 0 else 0.0) for i, k in enumerate(dkeys)},
                            }
                        },
                    }
                    return json.dumps(payload).encode("utf-8")

                class _OfflineMockHTTPResponse:
                    def __init__(self, body: bytes) -> None:
                        self.status = 200
                        self._bio = io.BytesIO(body)

                    def read(self, n: int = -1) -> bytes:
                        return self._bio.read(n)

                    def __enter__(self):
                        return self

                    def __exit__(self, *args):
                        return False

                def _mock_urlopen(req_or_url, timeout=20):
                    url = getattr(req_or_url, "full_url", str(req_or_url))
                    parsed = urllib.parse.urlparse(url)
                    if "power.larc.nasa.gov" in parsed.netloc:
                        qs = urllib.parse.parse_qs(parsed.query)
                        lon = float(qs["longitude"][0])
                        lat = float(qs["latitude"][0])
                        return _OfflineMockHTTPResponse(_power_payload(lon, lat))
                    if "maps.isric.org" in parsed.netloc:
                        raw_q = urllib.parse.unquote(parsed.query)
                        # Extract X / Y subsets
                        import re as _re
                        xm = _re.search(r"SUBSET=X\(([-\d.]+),([-\d.]+)\)", raw_q)
                        ym = _re.search(r"SUBSET=Y\(([-\d.]+),([-\d.]+)\)", raw_q)
                        cx = 0.5 * (float(xm.group(1)) + float(xm.group(2))) if xm else 1.60
                        cy = 0.5 * (float(ym.group(1)) + float(ym.group(2))) if ym else 48.35
                        cov = urllib.parse.parse_qs(parsed.query).get("COVERAGEID", [""])[0]
                        is_lyon = abs(cx - 4.8357) < 0.05 and abs(cy - 45.7640) < 0.05
                        if is_lyon:
                            val = 0
                        elif "clay" in cov:
                            val = 230
                        elif "silt" in cov:
                            val = 450
                        elif "sand" in cov:
                            val = 320
                        elif "soc" in cov:
                            val = 180
                        elif "bdod" in cov:
                            val = 135
                        elif "cfvo" in cov:
                            val = 40
                        else:
                            val = 68
                        return _OfflineMockHTTPResponse(_build_epsg4326_tiff(cx, cy, val))
                    raise AssertionError(f"Unexpected offline mock URL: {url}")

                with (
                    mock.patch("urllib.request.urlopen", side_effect=_mock_urlopen),
                    mock.patch("adaptive_evidence.adapters.nasa_power.urllib.request.urlopen", side_effect=_mock_urlopen),
                    mock.patch("adaptive_evidence.adapters.soilgrids.urllib.request.urlopen", side_effect=_mock_urlopen),
                ):
                    live_res = iso_sys.evaluate_unified(rural_req)
                    self.assertEqual(live_res["capability_statuses"]["C1"], "READY")
                    self.assertEqual(live_res["capability_statuses"]["C2"], "READY")
                    self.assertEqual(live_res["capability_statuses"]["C3"], "CONDITIONAL")
                    self.assertEqual(live_res["adaptive_evidence"]["capabilities"]["C2"]["fixture_origin"], "AUTHENTIC_LIVE_FETCH_RECEIPT")
                    self.assertEqual(live_res["adaptive_evidence"]["capabilities"]["C3"]["fixture_origin"], "AUTHENTIC_LIVE_FETCH_RECEIPT")
                    self.assertEqual(live_res["status_outcome"], "REGIONAL_SCREENING_ONLY")

                    lyon_req = {
                        "schema": "astragron.adaptive-evidence.request.v1",
                        "request_id": "lyon-urban-mask-test",
                        "location": {"site_id": "FR_LYON_URBAN", "point_lon_lat": [4.8357, 45.7640], "crs": "EPSG:4326"},
                        "period": {"start": "2018-01-01", "end": "2018-12-31"},
                        "soil_depth_intervals_cm": [[0, 5]],
                        "candidate_crops": ["wheat"],
                        "water_supply_scenario": {"regime": "rainfed"},
                        "options": {"acquisition": "FETCH_ALLOWED", "allow_conditional_crop_planning": True},
                    }
                    lyon_res = iso_sys.evaluate_unified(lyon_req)
                    self.assertEqual(lyon_res["capability_statuses"]["C2"], "READY")
                    self.assertEqual(lyon_res["capability_statuses"]["C3"], "BLOCKED")
                    self.assertEqual(lyon_res["adaptive_evidence"]["capabilities"]["C3"]["missing_reason"], "point_pixel_missing")
                    self.assertEqual(lyon_res["status_outcome"], "CLIMATE_READY_SOIL_PARTIAL")

                    req_cache = json.loads(json.dumps(rural_req))
                    req_cache["options"]["acquisition"] = "CACHE_ONLY"
                    replay_res = iso_sys.evaluate_unified(req_cache)
                    self.assertEqual(replay_res["capability_statuses"]["C2"], "READY")
                    self.assertEqual(replay_res["adaptive_evidence"]["capabilities"]["C2"]["fixture_origin"], "AUTHENTIC_CACHED_RECEIPT")
                    self.assertEqual(replay_res["capability_statuses"]["C3"], "CONDITIONAL")
                    self.assertEqual(replay_res["adaptive_evidence"]["capabilities"]["C3"]["fixture_origin"], "AUTHENTIC_CACHED_RECEIPT")
                return

            live_res = iso_sys.evaluate_unified(rural_req)
            self.assertEqual(live_res["capability_statuses"]["C1"], "READY")
            self.assertEqual(live_res["capability_statuses"]["C2"], "READY")
            self.assertEqual(live_res["capability_statuses"]["C3"], "CONDITIONAL")
            self.assertEqual(live_res["adaptive_evidence"]["capabilities"]["C2"]["fixture_origin"], "AUTHENTIC_LIVE_FETCH_RECEIPT")
            self.assertEqual(live_res["adaptive_evidence"]["capabilities"]["C3"]["fixture_origin"], "AUTHENTIC_LIVE_FETCH_RECEIPT")
            self.assertEqual(live_res["status_outcome"], "REGIONAL_SCREENING_ONLY")

            # Downtown Lyon urban mask fails closed for SoilGrids while keeping live climate C2 valid
            lyon_req = {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "lyon-urban-mask-test",
                "location": {"site_id": "FR_LYON_URBAN", "point_lon_lat": [4.8357, 45.7640], "crs": "EPSG:4326"},
                "period": {"start": "2018-01-01", "end": "2018-12-31"},
                "soil_depth_intervals_cm": [[0, 5]],
                "candidate_crops": ["wheat"],
                "water_supply_scenario": {"regime": "rainfed"},
                "options": {"acquisition": "FETCH_ALLOWED", "allow_conditional_crop_planning": True},
            }
            lyon_res = iso_sys.evaluate_unified(lyon_req)
            self.assertEqual(lyon_res["capability_statuses"]["C2"], "READY")
            self.assertEqual(lyon_res["capability_statuses"]["C3"], "BLOCKED")
            self.assertEqual(lyon_res["adaptive_evidence"]["capabilities"]["C3"]["missing_reason"], "point_pixel_missing")
            self.assertEqual(lyon_res["status_outcome"], "CLIMATE_READY_SOIL_PARTIAL")

            # Immediate offline replay from same isolated cache hits AUTHENTIC_CACHED_RECEIPT
            req_cache = json.loads(json.dumps(rural_req))
            req_cache["options"]["acquisition"] = "CACHE_ONLY"
            replay_res = iso_sys.evaluate_unified(req_cache)
            self.assertEqual(replay_res["capability_statuses"]["C2"], "READY")
            self.assertEqual(replay_res["adaptive_evidence"]["capabilities"]["C2"]["fixture_origin"], "AUTHENTIC_CACHED_RECEIPT")
            self.assertEqual(replay_res["capability_statuses"]["C3"], "CONDITIONAL")
            self.assertEqual(replay_res["adaptive_evidence"]["capabilities"]["C3"]["fixture_origin"], "AUTHENTIC_CACHED_RECEIPT")


if __name__ == "__main__":
    unittest.main()
