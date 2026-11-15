"""Targeted negative and remediation tests for Fixes 1-5."""
from __future__ import annotations

import math
import unittest

from adaptive_evidence.engine import AdaptiveEvidenceEngine
from adaptive_evidence.evaluation import evaluate_p5_generalization_and_redteam
from adaptive_evidence.improvements import run_illustrative_texture_reference_comparison
from adaptive_evidence.integration import AdaptiveClientDecisionBridge
from adaptive_evidence.schema import validate_coordinates_and_crs


class TestRemediationFixes(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = AdaptiveEvidenceEngine()
        cls.bridge = AdaptiveClientDecisionBridge(adaptive_engine=cls.engine)

    # --- Fix 1: Honest geographic coverage labels ---
    def test_fix1_authentic_vs_offline_reference_split(self) -> None:
        report = evaluate_p5_generalization_and_redteam()
        m = report["summary_metrics"]
        self.assertIn("AUTHENTIC_SOURCE_RETRIEVAL", m)
        self.assertIn("OFFLINE_REFERENCE_SCENARIO", m)
        self.assertIn("CONDITIONAL_USER_ASSUMPTION", m)
        self.assertFalse(m["AUTHENTIC_SOURCE_RETRIEVAL"]["counts_offline_fixtures"])
        self.assertFalse(m["OFFLINE_REFERENCE_SCENARIO"]["is_authentic_live_source_retrieval"])
        self.assertEqual(m["AUTHENTIC_SOURCE_RETRIEVAL"]["authentic_source_retrieval_count"], 6)
        self.assertEqual(m["AUTHENTIC_SOURCE_RETRIEVAL"]["c7_screening_from_authentic_cache_count"], 3)
        self.assertNotIn("SOURCE_RETRIEVAL_COVERAGE", m["OFFLINE_REFERENCE_SCENARIO"])

    # --- Fix 2: C7_SCREENING is not a 5-year planner ---
    def test_fix2_single_crop_and_incompatible_family_no_fake_5yr_plan(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "fix2-single-barley",
            "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["barley"],
            "water_supply_scenario": {"regime": "rainfed"},
        }
        resp = self.engine.evaluate(req)
        c7 = resp["capabilities"]["C7"]
        self.assertEqual(c7["capability_tag"], "C7_SCREENING")
        self.assertEqual(c7["status"], "CONDITIONAL")
        diag = c7["diagnostics"]
        self.assertNotIn("conditional_5yr_rotation_sequence", diag)
        self.assertFalse(diag["is_multiyear_rotation_plan"])
        self.assertTrue(diag["not_for_farmer_submission"])
        self.assertEqual(diag["illustrative_unvalidated_crop_list"], ["barley"])

        # Same-family incompatible pair also stays a screening aid, never a 5-year plan
        req_fam = dict(req, request_id="fix2-same-family", candidate_crops=["barley", "wheat"])
        resp_fam = self.engine.evaluate(req_fam)
        self.assertFalse(resp_fam["capabilities"]["C7"]["diagnostics"]["is_multiyear_rotation_plan"])
        self.assertNotIn("conditional_5yr_rotation_sequence", resp_fam["capabilities"]["C7"]["diagnostics"])

    # --- Fix 3: No silently changed farmer inputs ---
    def test_fix3_unknown_crops_empty_candidates_and_unknown_irrigation(self) -> None:
        for unknown_crop in ("avocado_uncalibrated", "mango_unknown", "hybrid_maize_custom_99"):
            client_req = {
                "schema": "astragron.client-decision.request.v1",
                "farm_id": f"neg-{unknown_crop}",
                "engine_request": {
                    "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
                    "fields": [{"field_id": "F1", "crop_candidates": [unknown_crop]}],
                },
            }
            ae_req = self.bridge.translate_client_request_to_adaptive(client_req)
            self.assertEqual(ae_req["candidate_crops"], [unknown_crop])
            self.assertEqual(ae_req["requested_crop_ids"], [unknown_crop])
            self.assertIsNone(ae_req["water_supply_scenario"]["regime"])

            ae_resp = self.engine.evaluate(ae_req)
            self.assertEqual(ae_resp["capability_statuses"]["C1"], "READY")
            self.assertEqual(ae_resp["capability_statuses"]["C2"], "READY")
            self.assertEqual(ae_resp["capability_statuses"]["C3"], "CONDITIONAL")
            self.assertEqual(ae_resp["capability_statuses"]["C4"], "CONDITIONAL")
            self.assertEqual(ae_resp["capability_statuses"]["C6"], "BLOCKED")
            self.assertEqual(ae_resp["capabilities"]["C6"]["missing_reason"], "unsupported_crop_profile")
            self.assertEqual(ae_resp["capability_statuses"]["C7"], "BLOCKED")

        # Empty crop candidates + multiple fields with missing irrigation_access
        empty_req = {
            "schema": "astragron.client-decision.request.v1",
            "farm_id": "neg-empty-multi",
            "engine_request": {
                "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                "fields": [
                    {"field_id": "F1", "crop_candidates": []},
                    {"field_id": "F2", "crop_candidates": []},
                ],
            },
        }
        ae_empty = self.bridge.translate_client_request_to_adaptive(empty_req)
        self.assertEqual(ae_empty["candidate_crops"], [])
        self.assertIsNone(ae_empty["water_supply_scenario"]["regime"])
        resp_empty = self.engine.evaluate(ae_empty)
        self.assertEqual(resp_empty["capability_statuses"]["C7"], "BLOCKED")
        self.assertEqual(resp_empty["capabilities"]["C7"]["missing_reason"], "insufficient_parameters")

    # --- Fix 4: Realistic global land/sea validation ---
    def test_fix4_global_land_sea_coastal_poles_and_dateline(self) -> None:
        # Gulf of Guinea [0, 0] must be OCEAN
        gulf = validate_coordinates_and_crs([0.0, 0.0], "EPSG:4326")
        self.assertTrue(gulf["valid"])
        self.assertFalse(gulf["is_land"])
        self.assertEqual(gulf["land_status"], "OCEAN")
        self.assertEqual(gulf["missing_reason"], "ocean_or_non_land_cell")

        # Other ocean points outside old 5 boxes
        for lon, lat in ((-140.0, 25.0), (75.0, -25.0), (-30.0, -35.0), (14.0, 35.5), (-85.0, 60.0)):
            oc = validate_coordinates_and_crs([lon, lat], "EPSG:4326")
            self.assertFalse(oc["is_land"], msg=f"Expected ocean for {[lon, lat]}")
            self.assertEqual(oc["land_status"], "OCEAN")

        # Coastal uncertainty fails closed (< 1,000 m from Natural Earth 10m shoreline)
        coastal = validate_coordinates_and_crs([4.0159, 51.5308], "EPSG:4326")
        self.assertTrue(coastal["valid"])
        self.assertFalse(coastal["is_land"])
        self.assertEqual(coastal["land_status"], "COASTAL_UNCERTAIN")
        self.assertEqual(coastal["missing_reason"], "land_status_unverified")

        # Poles: Antarctica is physically LAND (not water) per Natural Earth 10m, but blocked for agriculture
        south_pole = validate_coordinates_and_crs([0.0, -85.0], "EPSG:4326")
        self.assertFalse(south_pole["is_land"])
        self.assertEqual(south_pole["physical_surface"], "LAND")
        self.assertTrue(south_pole["is_polar"])
        self.assertEqual(south_pole["missing_reason"], "unsupported_region")

        # Invalid coordinates
        bad = validate_coordinates_and_crs([185.0, 0.0], "EPSG:4326")
        self.assertFalse(bad["valid"])
        self.assertFalse(bad["is_land"])

        nan_pt = validate_coordinates_and_crs([math.nan, 0.0], "EPSG:4326")
        self.assertFalse(nan_pt["valid"])

        # Dateline point on Chukotka land
        dateline = validate_coordinates_and_crs([-179.0, 66.5], "EPSG:4326")
        self.assertTrue(dateline["valid"])
        self.assertTrue(dateline["is_land"])

        # Coastal-uncertainty point near a cached/offline regional climate site (NL coast [4.0159, 51.5308])
        # fails closed on C1/C3-C7 while still allowing non-agricultural C2 climate description.
        coastal_climate_req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "fix4-coastal-climate",
            "location": {"site_id": "NL_WAGENINGEN_RESEARCH", "point_lon_lat": [4.0159, 51.5308], "crs": "EPSG:4326"},
            "options": {"allow_offline_reference_fixture": True},
        }
        coastal_resp = self.engine.evaluate(coastal_climate_req)
        self.assertEqual(coastal_resp["capability_statuses"]["C1"], "BLOCKED")
        self.assertEqual(coastal_resp["capabilities"]["C1"]["missing_reason"], "land_status_unverified")
        self.assertIn(coastal_resp["capability_statuses"]["C2"], ("READY", "CONDITIONAL"))
        self.assertEqual(coastal_resp["capability_statuses"]["C3"], "BLOCKED")
        self.assertEqual(coastal_resp["capability_statuses"]["C7"], "BLOCKED")

    # --- Fix 5: Illustrative texture-class reference comparison wording ---
    def test_fix5_ptf_comparison_provenance_honesty(self) -> None:
        comp = run_illustrative_texture_reference_comparison()
        self.assertEqual(comp["provenance_class"], "ILLUSTRATIVE_TEXTURE_CLASS_REFERENCE_COMPARISON")
        self.assertFalse(comp["is_independent_held_out_field_dataset"])
        self.assertFalse(comp["field_validated"])
        self.assertEqual(comp["prediction_accuracy"], "NOT_MEASURED")


if __name__ == "__main__":
    unittest.main()
