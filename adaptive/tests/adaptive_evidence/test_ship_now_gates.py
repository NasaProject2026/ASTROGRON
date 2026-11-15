"""Comprehensive Verification Suite for `ASTRAGRON_SHIP_NOW_FINAL_SYSTEM_INTEGRATION_MISSION_EN_2026-11-14.md`.

Tests Section 1 (Hard-Blocker Geometry & Input Security Fix) and Gates I–VII.
"""
from __future__ import annotations

import json
import math
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from adaptive_evidence.engine import AdaptiveEvidenceEngine
from adaptive_evidence.land_mask import evaluate_field_polygon_land_water
from adaptive_evidence.schema import validate_coordinates_and_crs
from adaptive_evidence.unified_server import create_unified_http_server
from adaptive_evidence.unified_system import (
     UnifiedAstragronSystem,
    build_final_baseline_and_ownership,
    evaluate_gate3_worldwide_12site_matrix,
    evaluate_gate4_five_year_and_partial_cases,
)


class TestShipNowFinalSystemMission(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = AdaptiveEvidenceEngine()
        cls.unified = UnifiedAstragronSystem()

    # --- Section 1A & Gate II: Point vs Polygon Spatial Consistency ---
    def test_sec1a_berlin_polygon_with_heilbronn_point_rejected_before_c2_c3(self) -> None:
        berlin_poly = {
            "type": "Polygon",
            "coordinates": [
                [
                    [13.39, 52.51],
                    [13.40, 52.51],
                    [13.40, 52.52],
                    [13.39, 52.52],
                    [13.39, 52.51],
                ]
            ],
        }
        heilbronn_pt = [9.22, 49.14]

        # 1. Direct validator check
        v_check = validate_coordinates_and_crs(heilbronn_pt, "EPSG:4326", berlin_poly)
        self.assertFalse(v_check["valid"])
        self.assertFalse(v_check["is_land"])
        self.assertEqual(v_check["land_status"], "SPATIAL_MISMATCH")
        self.assertTrue(v_check["spatial_mismatch"])
        self.assertEqual(v_check["missing_reason"], "spatial_mismatch")

        # 2. Full engine evaluation must block C1-C10 and NOT assign NASA C2 or SoilGrids C3
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "sec1a-berlin-poly-heilbronn-pt",
            "location": {
                "site_id": "DE_MISMATCH_TEST",
                "point_lon_lat": heilbronn_pt,
                "crs": "EPSG:4326",
                "geometry": berlin_poly,
            },
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat", "barley"],
            "water_supply_scenario": {"regime": "rainfed"},
        }
        resp = self.engine.evaluate(req)
        self.assertEqual(resp["status_outcome"], "INVALID_LOCATION_OR_GEOMETRY")
        self.assertEqual(resp["overall_summary_status"], "ALL_CAPABILITIES_BLOCKED")
        for cid in ("C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"):
            self.assertEqual(resp["capability_statuses"][cid], "BLOCKED")
            self.assertEqual(resp["capabilities"][cid]["missing_reason"], "spatial_mismatch")
        self.assertIsNone(resp["capabilities"]["C2"]["diagnostics"])
        self.assertIsNone(resp["capabilities"]["C3"]["diagnostics"])
        self.assertEqual(resp["usable_outputs"], {})
        self.assertEqual(resp["provenance_and_uncertainty_ledger"]["evidence_objects"], [])

    # --- Section 1B & Gate II: Malformed GeoJSON Value Handling ---
    def test_sec1b_malformed_geojson_strings_booleans_nan_unclosed_and_missing(self) -> None:
        # 1. Non-numeric string in GeoJSON Point: {'type':'Point','coordinates':['oops',49.14]}
        v_oops = validate_coordinates_and_crs(
            [9.22, 49.14],
            "EPSG:4326",
            {"type": "Point", "coordinates": ["oops", 49.14]},
        )
        self.assertFalse(v_oops["valid"])
        self.assertEqual(v_oops["missing_reason"], "invalid_coordinates_or_crs")

        # 2. Booleans in point_lon_lat or GeoJSON Point or Polygon
        for bad_geom in (
            {"type": "Point", "coordinates": [True, 49.14]},
            {"type": "Point", "coordinates": [9.22, False]},
            {
                "type": "Polygon",
                "coordinates": [
                    [[True, 52.51], [13.40, 52.51], [13.40, 52.52], [13.39, 52.52], [True, 52.51]]
                ],
            },
            {
                "type": "Polygon",
                "coordinates": [
                    [["oops", 52.51], [13.40, 52.51], [13.40, 52.52], [13.39, 52.52], ["oops", 52.51]]
                ],
            },
            # Unclosed linear ring
            {
                "type": "Polygon",
                "coordinates": [
                    [[13.39, 52.51], [13.40, 52.51], [13.40, 52.52], [13.39, 52.52]]
                ],
            },
            # Wrong nesting depth / empty coordinates
            {"type": "Polygon", "coordinates": []},
            {"type": "Polygon", "coordinates": [[13.39, 52.51], [13.40, 52.51], [13.40, 52.52], [13.39, 52.51]]},
            {"type": "MultiPolygon", "coordinates": [[]]},
            # Non-EPSG:4326 geometry CRS
            {"type": "Point", "coordinates": [9.22, 49.14], "crs": "EPSG:3857"},
            # NaN / Infinity inside geometry
            {"type": "Point", "coordinates": [float("nan"), 49.14]},
            {"type": "Point", "coordinates": [float("inf"), 49.14]},
        ):
            res = self.engine.evaluate(
                {
                    "location": {
                        "point_lon_lat": [13.395, 52.515],
                        "crs": "EPSG:4326",
                        "geometry": bad_geom,
                    }
                }
            )
            self.assertEqual(res["status_outcome"], "INVALID_LOCATION_OR_GEOMETRY")
            self.assertEqual(res["capability_statuses"]["C1"], "BLOCKED")
            self.assertEqual(res["capabilities"]["C1"]["missing_reason"], "invalid_coordinates_or_crs")
            self.assertEqual(res["capability_statuses"]["C2"], "BLOCKED")

        # 3. Missing coordinates (empty location dict or point_lon_lat=None) must NOT silently default to [0, 0]
        res_missing = self.engine.evaluate({"location": {}})
        self.assertEqual(res_missing["status_outcome"], "INVALID_LOCATION_OR_GEOMETRY")
        self.assertEqual(res_missing["capabilities"]["C1"]["missing_reason"], "invalid_coordinates_or_crs")
        self.assertEqual(res_missing["capability_statuses"]["C2"], "BLOCKED")

    # --- Gate II: MultiPolygon & Antimeridian Consistent Point/Polygon ---
    def test_gate2_multipolygon_and_antimeridian_point_consistency(self) -> None:
        mp = {
            "type": "MultiPolygon",
            "coordinates": [
                [[[17.64, 59.81], [17.66, 59.81], [17.66, 59.83], [17.64, 59.83], [17.64, 59.81]]],
                [[[17.67, 59.81], [17.68, 59.81], [17.68, 59.83], [17.67, 59.83], [17.67, 59.81]]],
            ],
        }
        v_ok = validate_coordinates_and_crs([17.65, 59.82], "EPSG:4326", mp)
        self.assertTrue(v_ok["valid"])
        self.assertTrue(v_ok["is_land"])

        v_mismatch = validate_coordinates_and_crs([17.665, 59.82], "EPSG:4326", mp)
        self.assertFalse(v_mismatch["valid"])
        self.assertEqual(v_mismatch["missing_reason"], "spatial_mismatch")

        # Antimeridian polygon on Taveuni (Fiji)
        anti_poly = {
            "type": "Polygon",
            "coordinates": [
                [
                    [179.96, -16.86],
                    [-179.96, -16.86],
                    [-179.96, -16.82],
                    [179.96, -16.82],
                    [179.96, -16.86],
                ]
            ],
        }
        anti_ok = evaluate_field_polygon_land_water(anti_poly, point_lon_lat=[179.98, -16.84])
        self.assertTrue(anti_ok["valid"])
        self.assertTrue(anti_ok["crosses_antimeridian"])

    # --- Gate I, Gate III & Gate IV: Ownership, 12-Site Matrix & 5-Year + Partial Cases ---
    def test_gates_1_3_4_ownership_worldwide_12_sites_and_5y_research(self) -> None:
        ownership = build_final_baseline_and_ownership()
        self.assertTrue(ownership["protected_locks_verified"]["passed"])
        self.assertEqual(ownership["protected_locks_verified"]["baseline_locked_file_count"], 301)
        self.assertEqual(ownership["protected_locks_verified"]["growth_locked_file_count"], 59)
        self.assertEqual(ownership["open_source_license_status"]["owner_license_authorized"], "BLOCKED")

        gate3 = evaluate_gate3_worldwide_12site_matrix()
        counts = gate3["summary_counts"]
        self.assertEqual(counts["total_locations_evaluated"], 12)
        self.assertEqual(counts["live_nasa_fetch_and_cached_count"], 8)
        self.assertEqual(counts["upstream_cached_nasa_receipt_count"], 4)
        self.assertEqual(counts["soilgrids_live_or_cached_count"], 11)
        self.assertEqual(counts["true_conditional_5y_planning_count"], 3)
        self.assertEqual(counts["screening_only_output_count"], 8)
        self.assertEqual(counts["climate_ready_soil_or_crop_blocked_count"], 1)

        gate4 = evaluate_gate4_five_year_and_partial_cases()
        for key in ("sweden_5y_research", "kenya_5y_research", "australia_5y_research"):
            case = gate4["cases"][key]
            self.assertEqual(case["status_outcome"], "CONDITIONAL_RESEARCH_COMPARISON")
            self.assertEqual(case["five_year_research_plan"]["status"], "RESEARCH_COMPARISON_COMPLETE")
            self.assertGreaterEqual(case["five_year_research_plan"]["candidate_count"], 2)
            self.assertFalse(case["scientific_guardrails"]["field_validated"])
            self.assertIsNone(case["scientific_guardrails"]["marketable_yield"])
            self.assertIsNone(case["scientific_guardrails"]["profit"])

        jp_case = gate4["cases"]["japan_climate_ready_soil_blocked"]
        self.assertEqual(jp_case["status_outcome"], "CLIMATE_READY_SOIL_PARTIAL")
        self.assertEqual(jp_case["capability_statuses"]["C2"], "READY")
        self.assertEqual(jp_case["capability_statuses"]["C3"], "BLOCKED")

    def test_gate3_newly_fetched_nasa_power_receipt_integrity_and_offline_replay(self) -> None:
        import hashlib
        from adaptive_evidence.unified_system import GLOBAL_NASA_CACHE_DIR

        receipts = sorted(GLOBAL_NASA_CACHE_DIR.glob("*.receipt.json"))
        self.assertGreaterEqual(len(receipts), 8)
        for rpath in receipts:
            rec = json.loads(rpath.read_text(encoding="utf-8"))
            raw_path = GLOBAL_NASA_CACHE_DIR / f"{rec['sha256']}.raw.json"
            self.assertTrue(raw_path.is_file(), f"Missing raw NASA payload for {rpath.name}")
            raw_bytes = raw_path.read_bytes()
            self.assertEqual(hashlib.sha256(raw_bytes).hexdigest(), rec["sha256"])
            self.assertEqual(rec["qualification"]["days"], 1827)
            pt = rec["point_lon_lat"]
            # Replay in strict CACHE_ONLY mode twice and verify byte-identical diagnostics
            res1 = self.unified.nasa.fetch_or_load(
                pt, "2016-01-01", "2020-12-31", acquisition="CACHE_ONLY"
            )
            res2 = self.unified.nasa.fetch_or_load(
                pt, "2016-01-01", "2020-12-31", acquisition="CACHE_ONLY"
            )
            self.assertEqual(res1["status"], "READY")
            self.assertEqual(res1["diagnostics"], res2["diagnostics"])
            self.assertEqual(
                res1["evidence_objects"][0]["raw_source_sha256"],
                rec["sha256"],
            )

    # --- Gate V: Runnable Local HTTP Server & Printable English Report E2E ---
    def test_gate5_unified_http_server_and_6_status_outcomes_e2e(self) -> None:
        httpd = create_unified_http_server("127.0.0.1", 0)
        port = httpd.server_address[1]
        base_url = f"http://127.0.0.1:{port}"
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            # 1. GET /research and GET /unified
            for route in ("/research", "/unified", "/api/v1/adaptive-evidence/capabilities"):
                req = urllib.request.Request(f"{base_url}{route}", headers={"Host": f"127.0.0.1:{port}"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    self.assertEqual(resp.status, 200)
                    body = resp.read().decode("utf-8")
                    self.assertTrue(len(body) > 100)

            def _post_json(payload: dict) -> dict:
                raw = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(
                    f"{base_url}/api/v1/adaptive-evidence",
                    data=raw,
                    headers={
                        "Host": f"127.0.0.1:{port}",
                        "Content-Type": "application/json",
                        "Content-Length": str(len(raw)),
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    self.assertEqual(resp.status, 200)
                    return json.loads(resp.read().decode("utf-8"))

            # Verify all 6 distinct status outcomes via HTTP + HTML/CSV/JSON report export:
            # (1) INVALID_LOCATION_OR_GEOMETRY (Berlin polygon + Heilbronn point)
            r1 = _post_json(
                {
                    "location": {
                        "point_lon_lat": [9.22, 49.14],
                        "crs": "EPSG:4326",
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [[13.39, 52.51], [13.40, 52.51], [13.40, 52.52], [13.39, 52.52], [13.39, 52.51]]
                            ],
                        },
                    }
                }
            )
            self.assertEqual(r1["status_outcome"], "INVALID_LOCATION_OR_GEOMETRY")

            # (2) WATER_OR_UNVERIFIED_LOCATION (Gulf of Guinea [0, 0])
            r2 = _post_json({"location": {"point_lon_lat": [0.0, 0.0], "crs": "EPSG:4326"}})
            self.assertEqual(r2["status_outcome"], "WATER_OR_UNVERIFIED_LOCATION")

            # (3) CLIMATE_READY_SOIL_PARTIAL (Japan Tsukuba [140.12, 36.08])
            r3 = _post_json(
                {
                    "location": {"point_lon_lat": [140.12, 36.08], "crs": "EPSG:4326"},
                    "candidate_crops": ["rice", "soybean"],
                    "water_supply_scenario": {"regime": "rainfed"},
                }
            )
            self.assertEqual(r3["status_outcome"], "CLIMATE_READY_SOIL_PARTIAL")

            # (4) REGIONAL_SCREENING_ONLY (Brazil Cerrado [-47.9, -15.8])
            r4 = _post_json(
                {
                    "location": {"point_lon_lat": [-47.9, -15.8], "crs": "EPSG:4326"},
                    "soil_depth_intervals_cm": [[0, 5]],
                    "candidate_crops": ["soybean", "maize", "sorghum"],
                    "water_supply_scenario": {"regime": "rainfed"},
                }
            )
            self.assertEqual(r4["status_outcome"], "REGIONAL_SCREENING_ONLY")

            # (5) CONDITIONAL_RESEARCH_COMPARISON (Wageningen research point [5.67, 51.97] with mineral N)
            r5 = _post_json(
                {
                    "location": {
                        "site_id": "NL_WAGENINGEN_RESEARCH",
                        "point_lon_lat": [5.67, 51.97],
                        "crs": "EPSG:4326",
                    },
                    "soil_depth_intervals_cm": [[0, 5]],
                    "candidate_crops": ["wheat", "barley", "rapeseed"],
                    "water_supply_scenario": {"regime": "rainfed"},
                    "user_measurements": {"mineral_n_kg_ha": 48.0},
                    "options": {"allow_offline_reference_fixture": True},
                }
            )
            self.assertEqual(r5["status_outcome"], "CONDITIONAL_RESEARCH_COMPARISON")

            # (6) EVIDENCE_BLOCKED (Valid land point with simulated NASA & SoilGrids outage)
            r6 = _post_json(
                {
                    "location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                    "options": {"simulate_nasa_outage": True, "simulate_soilgrids_outage": True},
                }
            )
            self.assertEqual(r6["status_outcome"], "EVIDENCE_BLOCKED")

            # Fetch HTML, JSON, and CSV exports for r4
            for art_key, expected_substr in (
                ("html_report", "1. What Can Be Answered Now"),
                ("json_export", "REGIONAL_SCREENING_ONLY"),
                ("csv_export", "result_id,request_id,status_outcome"),
            ):
                art_url = f"{base_url}{r4['artifacts'][art_key]}"
                req = urllib.request.Request(art_url, headers={"Host": f"127.0.0.1:{port}"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    self.assertEqual(resp.status, 200)
                    text = resp.read().decode("utf-8")
                    self.assertIn(expected_substr, text)
        finally:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    unittest.main()
