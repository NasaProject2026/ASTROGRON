"""Comprehensive Gate G1-G5 tests: Natural Earth 10m geography, polygons, license gate, performance, and G5 examples."""
from __future__ import annotations

import json
import tempfile
import time
import tracemalloc
import unittest
from pathlib import Path

from adaptive_evidence.adapters.fao_gaez import FAOGAEZAdapter
from adaptive_evidence.engine import AdaptiveEvidenceEngine
from adaptive_evidence.estimators import derive_soil_hydraulics_from_soilgrids
from adaptive_evidence.integration import AdaptiveClientDecisionBridge, verify_upstream_integrity
from adaptive_evidence.land_mask import (
    DEFAULT_NE_DIR,
    NaturalEarth10mIndex,
    classify_global_land_status,
    evaluate_field_polygon_land_water,
    get_natural_earth_index,
)
from adaptive_evidence.license_gate import (
    SOFTWARE_BILL_OF_MATERIALS,
    build_external_data_rights_register,
    evaluate_open_source_license_gate,
)
from adaptive_evidence.schema import validate_coordinates_and_crs
from adaptive_evidence.sensitivity import DecisionSensitivityAnalyzer

# Documented independent manual ground-truth table (independent of Natural Earth internal IDs)
INDEPENDENT_GROUND_TRUTH_POINTS = (
    # Terrestrial cities & islands previously misclassified by hand-drawn polygons
    ("London_UK", [-0.1276, 51.5072], "LAND", True),
    ("Jakarta_ID", [106.8456, -6.2088], "LAND", True),
    ("Manila_PH", [120.9842, 14.5995], "LAND", True),
    ("Bali_Denpasar_ID", [115.2126, -8.6705], "LAND", True),
    ("Singapore_SG", [103.8198, 1.3521], "LAND", True),
    ("Tokyo_JP", [139.6917, 35.6895], "LAND", True),
    ("Wageningen_NL", [5.6700, 51.9700], "LAND", True),
    ("Munich_DE", [11.5820, 48.1351], "LAND", True),
    ("Heilbronn_DE", [9.2109, 49.1427], "LAND", True),
    ("Nairobi_KE", [36.8219, -1.2921], "LAND", True),
    ("Wagga_Wagga_AU", [147.3500, -35.0500], "LAND", True),
    # Small islands & islands inside lakes
    ("Malta_Island", [14.4300, 35.8900], "LAND", True),
    ("Manitoulin_Island_Lake_Huron", [-82.2000, 45.7500], "LAND", True),
    ("Ukerewe_Island_Lake_Victoria", [33.0000, -2.0300], "LAND", True),
    # Open oceans & seas (including [0,0] Gulf of Guinea where fictional 'Null island' is filtered)
    ("Gulf_of_Guinea_0_0", [0.0, 0.0], "OCEAN", False),
    ("Mid_North_Atlantic", [-35.0, 30.0], "OCEAN", False),
    ("Central_Pacific", [-140.0, 0.0], "OCEAN", False),
    ("Mediterranean_Sea", [18.0, 35.5], "OCEAN", False),
    ("Black_Sea", [34.0, 43.0], "OCEAN", False),
    # Major inland lakes & endorheic seas
    ("Caspian_Sea", [50.5, 41.5], "INLAND_WATER", False),
    ("Lake_Victoria", [33.0, -1.0], "INLAND_WATER", False),
    ("Lake_Michigan", [-87.0, 43.5], "INLAND_WATER", False),
    ("Lake_Baikal", [108.0, 53.5], "INLAND_WATER", False),
    ("North_Aral_Sea", [60.63, 46.43], "INLAND_WATER", False),
    ("Dead_Sea", [35.48, 31.54], "INLAND_WATER", False),
    # Near-coast & near-lake shoreline points where 1:10M footprint is insufficient -> COASTAL_UNCERTAIN
    ("Zeeland_Land_Shoreline", [4.0159, 51.5308], "COASTAL_UNCERTAIN", False),
    ("Zeeland_Water_Shoreline", [4.0100, 51.5350], "COASTAL_UNCERTAIN", False),
    ("Lake_Victoria_Near_Shore_Buffer", [32.5800, 0.0500], "COASTAL_UNCERTAIN", False),
    ("Alexandria_Harbor_Shoreline", [29.8800, 31.2100], "COASTAL_UNCERTAIN", False),
)


class TestGatesG1ToG5Comprehensive(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = AdaptiveEvidenceEngine()
        cls.bridge = AdaptiveClientDecisionBridge(adaptive_engine=cls.engine)
        cls.sensitivity = DecisionSensitivityAnalyzer(cls.engine)
        cls.gaez = FAOGAEZAdapter()

    def test_g1_independent_ground_truth_points_cities_lakes_and_oceans(self) -> None:
        for label, lon_lat, expected_status, expected_is_land in INDEPENDENT_GROUND_TRUTH_POINTS:
            res = validate_coordinates_and_crs(lon_lat, "EPSG:4326")
            self.assertTrue(res["valid"], msg=f"{label} should be valid WGS84")
            self.assertEqual(
                res["land_status"],
                expected_status,
                msg=f"{label} {lon_lat}: expected {expected_status}, got {res['land_status']} ({res['detail']})",
            )
            self.assertEqual(res["is_land"], expected_is_land, msg=f"{label} is_land mismatch")
            self.assertIn("Natural Earth", res["dataset_metadata"]["dataset_name"])

        # Polar checks: Antarctica is physical LAND (not water), Arctic Pole is physical OCEAN
        antarctica = validate_coordinates_and_crs([0.0, -85.0], "EPSG:4326")
        self.assertEqual(antarctica["physical_surface"], "LAND")
        self.assertTrue(antarctica["is_polar"])
        self.assertFalse(antarctica["is_land"])
        self.assertEqual(antarctica["missing_reason"], "unsupported_region")

        arctic_ocean = validate_coordinates_and_crs([0.0, 89.0], "EPSG:4326")
        self.assertEqual(arctic_ocean["physical_surface"], "OCEAN")
        self.assertTrue(arctic_ocean["is_polar"])
        self.assertFalse(arctic_ocean["is_land"])

        # Antimeridian +/-180 on Chukotka land
        for lon_am in (-180.0, 180.0):
            am = validate_coordinates_and_crs([lon_am, 66.5], "EPSG:4326")
            self.assertTrue(am["valid"])
            self.assertEqual(am["land_status"], "LAND")
            self.assertTrue(am["is_land"])

    def test_g1_farm_polygons_bowtie_coast_crossing_lake_overlap_inversion_and_tampered_files(self) -> None:
        # 1. Valid inland farm polygon (Wageningen)
        inland_poly = {
            "type": "Polygon",
            "coordinates": [[[5.65, 51.96], [5.69, 51.96], [5.69, 51.98], [5.65, 51.98], [5.65, 51.96]]],
        }
        r_inland = validate_coordinates_and_crs([5.67, 51.97], "EPSG:4326", inland_poly)
        self.assertTrue(r_inland["valid"])
        self.assertTrue(r_inland["is_land"])
        self.assertEqual(r_inland["land_status"], "LAND")
        self.assertEqual(r_inland["polygon_evaluation"]["land_fraction"], 1.0)

        # 2. Self-intersecting (bowtie) polygon -> INVALID_GEOMETRY
        bowtie_poly = {
            "type": "Polygon",
            "coordinates": [[[5.65, 51.96], [5.69, 51.98], [5.69, 51.96], [5.65, 51.98], [5.65, 51.96]]],
        }
        r_bowtie = validate_coordinates_and_crs([5.67, 51.97], "EPSG:4326", bowtie_poly)
        self.assertFalse(r_bowtie["valid"])
        self.assertFalse(r_bowtie["is_land"])
        self.assertEqual(r_bowtie["land_status"], "INVALID_GEOMETRY")

        # 3. Coast-crossing polygon (straddling NL coast into North Sea)
        coast_poly = {
            "type": "Polygon",
            "coordinates": [[[3.95, 51.50], [4.10, 51.50], [4.10, 51.56], [3.95, 51.56], [3.95, 51.50]]],
        }
        r_coast = validate_coordinates_and_crs([4.05, 51.53], "EPSG:4326", coast_poly)
        self.assertTrue(r_coast["valid"])
        self.assertFalse(r_coast["is_land"])
        self.assertEqual(r_coast["land_status"], "COASTAL_UNCERTAIN")
        self.assertTrue(r_coast["polygon_evaluation"]["mixed_land_water_overlap"])

        # 4. Partial lake coverage polygon (straddling Lake Victoria shoreline)
        lake_edge_poly = {
            "type": "Polygon",
            "coordinates": [[[34.70, -0.15], [34.85, -0.15], [34.85, -0.05], [34.70, -0.05], [34.70, -0.15]]],
        }
        r_lake_edge = evaluate_field_polygon_land_water(lake_edge_poly)
        self.assertTrue(r_lake_edge["valid"])
        self.assertFalse(r_lake_edge["is_land"])
        self.assertEqual(r_lake_edge["land_status"], "COASTAL_UNCERTAIN")
        self.assertGreater(r_lake_edge["inland_water_fraction"], 0.01)

        # 5. Longitude/latitude inversion ([lat=51.97, lon=147.35] -> |lat| > 90)
        inv = validate_coordinates_and_crs([51.97, 147.35], "EPSG:4326")
        self.assertFalse(inv["valid"])
        self.assertTrue(inv["lon_lat_inversion_detected"])

        # 6. Geometry crossing +/-180 antimeridian on Chukotka land
        am_poly = {
            "type": "Polygon",
            "coordinates": [[[179.90, 66.40], [-179.90, 66.40], [-179.90, 66.50], [179.90, 66.50], [179.90, 66.40]]],
        }
        r_am = evaluate_field_polygon_land_water(am_poly)
        self.assertTrue(r_am["valid"])
        self.assertTrue(r_am["crosses_antimeridian"])
        self.assertEqual(r_am["land_status"], "LAND")

        # 7. Missing/tampered spatial files -> fails closed as LAND_STATUS_UNVERIFIED (never promoted to LAND or OCEAN)
        with tempfile.TemporaryDirectory() as tmpdir:
            bad_res = classify_global_land_status(5.67, 51.97, data_dir=Path(tmpdir))
            self.assertEqual(bad_res["land_status"], "LAND_STATUS_UNVERIFIED")
            self.assertFalse(bad_res["is_land"])
            self.assertEqual(bad_res["missing_reason"], "land_status_unverified")
        # Restore singleton index to default directory
        get_natural_earth_index(DEFAULT_NE_DIR, force_reload=True)

    def test_g2_evidence_anti_upgrade_and_fao_gaez_per_layer_gate(self) -> None:
        # Malformed / negative PTF inputs rejected
        bad_sg = {
            "status": "CONDITIONAL",
            "diagnostics": {
                "properties_si": {
                    "clay": {"q05": -5.0, "q50": -2.0, "mean": -2.0, "q95": 10.0},
                    "silt": {"q05": 40.0, "q50": 50.0, "mean": 50.0, "q95": 60.0},
                    "sand": {"q05": 40.0, "q50": 52.0, "mean": 52.0, "q95": 60.0},
                    "soc": {"q05": 10.0, "q50": 15.0, "mean": 15.0, "q95": 20.0},
                    "bdod": {"q05": 1.2, "q50": 1.3, "mean": 1.3, "q95": 1.4},
                    "cfvo": {"q05": 5.0, "q50": 10.0, "mean": 10.0, "q95": 15.0},
                }
            },
        }
        ptf_bad = derive_soil_hydraulics_from_soilgrids(bad_sg, root_depth_m=0.6, point_lon_lat=[17.65, 59.82])
        self.assertEqual(ptf_bad["status"], "BLOCKED")

        # FAO GAEZ v5 layer without layer_id or with CC-BY-NC is blocked
        gaez_nc = self.gaez.evaluate_suitability(
            [17.65, 59.82],
            "wheat",
            "rainfed",
            verified_local_receipt={"gaez_version": "v5.0", "layer_id": "RES05_WHEAT", "license": "CC-BY-NC-4.0", "suitability_index_0_100": 75.0},
        )
        self.assertEqual(gaez_nc["status"], "BLOCKED")
        self.assertEqual(gaez_nc["missing_reason"], "license_unverified")

        gaez_v5_no_layer = self.gaez.evaluate_suitability(
            [17.65, 59.82],
            "wheat",
            "rainfed",
            verified_local_receipt={"gaez_version": "v5.0", "license": "CC-BY-4.0", "suitability_index_0_100": 75.0},
        )
        self.assertEqual(gaez_v5_no_layer["status"], "BLOCKED")
        self.assertEqual(gaez_v5_no_layer["missing_reason"], "license_unverified")

        # Incomplete scenario set returns DECISION_SENSITIVITY_UNDETERMINED
        sens_inc = self.sensitivity.analyze(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                "candidate_crops": [],
            }
        )
        self.assertEqual(sens_inc["sensitivity_gate_status"], "DECISION_SENSITIVITY_UNDETERMINED")

    def test_g3_open_source_license_gate_pass_and_negative_probes(self) -> None:
        # Clean workspace passes G3 gate
        clean_gate = evaluate_open_source_license_gate()
        self.assertTrue(clean_gate["OPEN_SOURCE_RELEASE_REVIEW_READY"])
        self.assertEqual(clean_gate["blocker_count"], 0)

        # Negative probe 1: Mislabeling CC-BY-4.0 dataset as OSI software license or Apache-2.0
        bad_data = build_external_data_rights_register()
        bad_data[3] = dict(bad_data[3], declared_license="CC-BY-4.0 / Apache-2.0", is_osi_software_license=True)
        res_mislabeled = evaluate_open_source_license_gate(data_register=bad_data)
        self.assertFalse(res_mislabeled["OPEN_SOURCE_RELEASE_REVIEW_READY"])
        self.assertIn("MISLEADING_CC_BY_AS_OSI_OR_APACHE", [b["code"] for b in res_mislabeled["blockers"]])

        # Negative probe 2: Disallowed bundled CC-BY-NC dataset
        bad_nc = build_external_data_rights_register()
        bad_nc[0] = dict(bad_nc[0], declared_license="CC-BY-NC-4.0")
        res_nc = evaluate_open_source_license_gate(data_register=bad_nc)
        self.assertFalse(res_nc["OPEN_SOURCE_RELEASE_REVIEW_READY"])
        self.assertIn("DISALLOWED_BUNDLED_DATA_LICENSE", [b["code"] for b in res_nc["blockers"]])

        # Negative probe 3: Missing attribution or secret/proprietary font in scanned directory
        with tempfile.TemporaryDirectory() as tmpdir:
            tpath = Path(tmpdir)
            (tpath / "proprietary_font.ttf").write_bytes(b"fake-font")
            res_font = evaluate_open_source_license_gate(scan_dirs=[tpath])
            self.assertFalse(res_font["OPEN_SOURCE_RELEASE_REVIEW_READY"])
            self.assertIn("DISALLOWED_BINARY_OR_FONT_ASSET", [b["code"] for b in res_font["blockers"]])

    def test_g4_performance_and_g5_seven_integration_scenarios(self) -> None:
        idx = get_natural_earth_index()
        self.assertTrue(idx.dataset_available)
        latencies_ms = []
        for _, (lon, lat), _, _ in INDEPENDENT_GROUND_TRUTH_POINTS:
            t0 = time.perf_counter()
            classify_global_land_status(lon, lat)
            latencies_ms.append((time.perf_counter() - t0) * 1000.0)
        latencies_ms.sort()
        p50_ms = latencies_ms[len(latencies_ms) // 2]
        p95_ms = latencies_ms[int(len(latencies_ms) * 0.95)]
        self.assertLess(p50_ms, 25.0)
        self.assertLess(p95_ms, 50.0)

        # G5: Verify all 7 canonical scenarios: (a) inland farm, (b) ocean, (c) inland water,
        # (d) coastal uncertain, (e) unsupported crop, (f) source outage, (g) ambiguous data license
        scen_a = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "g5-a-inland-farm",
                "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
                "soil_depth_intervals_cm": [[0, 5]],
                "candidate_crops": ["wheat", "chickpea"],
                "water_supply_scenario": {"regime": "rainfed"},
            }
        )
        self.assertEqual(scen_a["capability_statuses"]["C1"], "READY")
        self.assertEqual(scen_a["capability_statuses"]["C7"], "CONDITIONAL")

        scen_b = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "g5-b-ocean",
                "location": {"point_lon_lat": [0.0, 0.0], "crs": "EPSG:4326"},
            }
        )
        self.assertEqual(scen_b["capability_statuses"]["C1"], "BLOCKED")
        self.assertEqual(scen_b["capabilities"]["C1"]["land_status"], "OCEAN")
        self.assertEqual(scen_b["capability_statuses"]["C3"], "BLOCKED")
        self.assertEqual(scen_b["capability_statuses"]["C7"], "BLOCKED")

        scen_c = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "g5-c-inland-water",
                "location": {"point_lon_lat": [50.5, 41.5], "crs": "EPSG:4326"},
            }
        )
        self.assertEqual(scen_c["capability_statuses"]["C1"], "BLOCKED")
        self.assertEqual(scen_c["capabilities"]["C1"]["land_status"], "INLAND_WATER")
        self.assertEqual(scen_c["capability_statuses"]["C3"], "BLOCKED")

        scen_d = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "g5-d-coastal-uncertain",
                "location": {"site_id": "NL_WAGENINGEN_RESEARCH", "point_lon_lat": [4.0159, 51.5308], "crs": "EPSG:4326"},
                "options": {"allow_offline_reference_fixture": True},
            }
        )
        self.assertEqual(scen_d["capability_statuses"]["C1"], "BLOCKED")
        self.assertEqual(scen_d["capabilities"]["C1"]["land_status"], "COASTAL_UNCERTAIN")
        self.assertEqual(scen_d["capability_statuses"]["C2"], "CONDITIONAL")
        self.assertEqual(scen_d["capability_statuses"]["C3"], "BLOCKED")

        scen_e = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "g5-e-unsupported-crop",
                "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
                "soil_depth_intervals_cm": [[0, 5]],
                "candidate_crops": ["avocado_uncalibrated"],
                "water_supply_scenario": {"regime": "rainfed"},
            }
        )
        self.assertEqual(scen_e["capability_statuses"]["C2"], "READY")
        self.assertEqual(scen_e["capability_statuses"]["C4"], "CONDITIONAL")
        self.assertEqual(scen_e["capability_statuses"]["C6"], "BLOCKED")
        self.assertEqual(scen_e["capabilities"]["C6"]["missing_reason"], "unsupported_crop_profile")

        scen_f = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "g5-f-source-outage",
                "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
                "options": {"simulate_soilgrids_outage": True},
            }
        )
        self.assertEqual(scen_f["capability_statuses"]["C2"], "READY")
        self.assertEqual(scen_f["capability_statuses"]["C3"], "BLOCKED")
        self.assertEqual(scen_f["capabilities"]["C3"]["missing_reason"], "source_outage")

        scen_g = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "g5-g-ambiguous-license",
                "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
                "candidate_crops": ["wheat"],
                "water_supply_scenario": {"regime": "rainfed"},
            }
        )
        self.assertEqual(scen_g["capability_statuses"]["C5"], "BLOCKED")
        self.assertEqual(scen_g["capabilities"]["C5"]["missing_reason"], "license_unverified")

    def test_g0_current_source_verification_receipt_and_clean_replay_fallback(self) -> None:
        from adaptive_evidence.inventory import (
            EXPECTED_CURRENT_VERIFICATION_RECEIPT_SHA256,
            EXPECTED_ORIGINAL_SOURCE_ARCHIVE_SHA256,
            EXPECTED_PROMPT_BUNDLE_RECEIPT_SHA256,
            ROOT,
            sha256_file,
            verify_upstream_integrity,
        )

        # 1. Verify current reconstructed receipt exists, matches SHA-256, and is explicitly marked non-pre-existing
        cur_path = ROOT / "docs" / "adaptive_evidence" / "CURRENT_SOURCE_VERIFICATION_RECEIPT_2026-11-14.json"
        self.assertTrue(cur_path.is_file())
        self.assertEqual(sha256_file(cur_path), EXPECTED_CURRENT_VERIFICATION_RECEIPT_SHA256)
        cur_data = json.loads(cur_path.read_text(encoding="utf-8"))
        self.assertEqual(cur_data["receipt_type"], "RECONSTRUCTED_CURRENT_VERIFICATION_RECEIPT")
        self.assertFalse(cur_data["is_previously_existing_baseline_file"])
        self.assertEqual(cur_data["original_archive_sha256"], EXPECTED_ORIGINAL_SOURCE_ARCHIVE_SHA256)
        self.assertEqual(cur_data["prompt_bundle_receipt_actual_sha256"], EXPECTED_PROMPT_BUNDLE_RECEIPT_SHA256)

        # 2. Verify full workspace integrity check passes
        integ = verify_upstream_integrity(ROOT)
        self.assertTrue(integ["passed"])
        self.assertTrue(integ["current_verification_receipt_is_reconstructed"])
        self.assertEqual(integ["protected_baseline_files_verified"], 301)
        self.assertEqual(integ["growth_input_files_verified"], 59)


if __name__ == "__main__":
    unittest.main()
