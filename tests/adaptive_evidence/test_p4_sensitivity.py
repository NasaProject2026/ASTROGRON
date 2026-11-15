"""Unit tests for Stage P4 — Uncertainty Propagation, Decision Stability, and Next Measurements."""
from __future__ import annotations

import unittest

from adaptive_evidence.sensitivity import DecisionSensitivityAnalyzer


class TestStageP4Sensitivity(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.analyzer = DecisionSensitivityAnalyzer()

    def test_decision_sensitive_with_flip_witness_on_semi_arid_wagga(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p4-sensitive-wagga",
            "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["chickpea", "wheat", "potato"],
            "water_supply_scenario": {"regime": "rainfed"},
        }
        res = self.analyzer.analyze(req, feasibility_deficit_threshold=0.45)
        self.assertEqual(res["stability_classification"], "DECISION_SENSITIVE")
        self.assertGreater(res["tested_scenario_count"], 0)
        self.assertGreater(res["flip_witness_count"], 0)
        witness = res["flip_witnesses"][0]
        self.assertIn("reference_scenario_id", witness)
        self.assertIn("perturbed_scenario_id", witness)
        self.assertTrue(witness["top_crop_flipped"] or witness["feasibility_set_flipped"])
        self.assertIsNone(res["economic_voi_usd"])
        self.assertFalse(res["fabricated_voi"])

    def test_decision_stable_within_tested_scenarios_on_humid_site_with_irrigation(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p4-stable-uppsala",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["barley", "potato"],
            "water_supply_scenario": {"regime": "supplemental", "seasonal_supply_m3_ha": 2500.0},
        }
        res = self.analyzer.analyze(req, feasibility_deficit_threshold=0.50)
        self.assertEqual(res["stability_classification"], "DECISION_STABLE_WITHIN_TESTED_SCENARIOS")
        self.assertEqual(res["flip_witness_count"], 0)
        self.assertIsNotNone(res["stability_witness"])
        self.assertEqual(res["stability_witness"]["invariant_top_crop"], "barley")
        self.assertEqual(
            len(res["stability_witness"]["tested_scenario_ids"]),
            res["tested_scenario_count"],
        )

    def test_undetermined_when_upstream_evidence_blocked(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p4-undetermined-ocean",
            "location": {"point_lon_lat": [-140.0, 0.0], "crs": "EPSG:4326"},
        }
        res = self.analyzer.analyze(req)
        self.assertEqual(res["stability_classification"], "UNDETERMINED")
        self.assertEqual(res["tested_scenario_count"], 0)
        self.assertEqual(res["undetermined_reason"], "ocean_or_non_land_cell")

    def test_parameter_influence_ranking_and_zero_fabricated_voi(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p4-influence-nyeri",
            "location": {"site_id": "KE_NYERI_REGION", "point_lon_lat": [36.95, -0.42], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["maize", "sorghum", "faba_bean"],
            "water_supply_scenario": {"regime": "rainfed"},
        }
        res = self.analyzer.analyze(req)
        self.assertGreaterEqual(len(res["parameter_influence_ranking"]), 2)
        for m in res["prioritized_next_measurements"]:
            self.assertIsNone(m["economic_voi_usd"])


if __name__ == "__main__":
    unittest.main()
