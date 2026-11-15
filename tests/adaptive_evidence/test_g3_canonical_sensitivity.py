"""Suite D — G3 Truthful Screening vs Canonical 5-Year Decision Sensitivity & Side-by-Side Witness Tests."""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from adaptive_evidence.inventory import ROOT
from adaptive_evidence.sensitivity import CanonicalDecisionSensitivityRunner, DecisionSensitivityAnalyzer


class TestG3CanonicalSensitivity(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.screening = DecisionSensitivityAnalyzer()
        cls.canonical_runner = CanonicalDecisionSensitivityRunner()
        cls.supported_soil = json.loads((ROOT / "examples" / "engine" / "supported_soil.json").read_text(encoding="utf-8"))
        cls.missing_evidence = json.loads((ROOT / "examples" / "engine" / "missing_evidence.json").read_text(encoding="utf-8"))

    def test_screening_analyzer_explicitly_labeled_and_does_not_claim_canonical_5y(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g3-screen-label",
            "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat", "chickpea"],
            "water_supply_scenario": {"regime": "rainfed"},
        }
        res = self.screening.analyze(req, feasibility_deficit_threshold=0.35)
        self.assertEqual(res["analysis_kind"], "REGIONAL_WATER_SCREENING_SENSITIVITY")
        self.assertFalse(res["canonical_decision_sensitivity_executed"])
        self.assertIn("NOT a 5-year", res["scope_disclaimer"])

    def test_canonical_runner_three_outcomes_and_input_immutability(self) -> None:
        orig_copy = copy.deepcopy(self.supported_soil)

        # 1. CHANGED_WITHIN_TESTED_SCENARIOS
        res_changed = self.canonical_runner.run(self.supported_soil)
        self.assertEqual(self.supported_soil, orig_copy)  # Caller input never mutated
        self.assertEqual(res_changed["analysis_kind"], "CANONICAL_DECISION_SENSITIVITY")
        self.assertEqual(res_changed["canonical_service_used"], "brain.service.ClientDecisionService")
        self.assertEqual(res_changed["canonical_stability_status"], "CHANGED_WITHIN_TESTED_SCENARIOS")
        self.assertGreater(res_changed["flip_witness_count"], 0)
        self.assertIsNone(res_changed["economic_voi_usd"])
        self.assertFalse(res_changed["fabricated_voi"])

        # 2. UNCHANGED_WITHIN_TESTED_SCENARIOS (mild perturbation well inside 75 mm/yr service limit)
        res_unchanged = self.canonical_runner.run(
            self.supported_soil,
            scenarios=[
                {"scenario_id": "REF"},
                {"scenario_id": "MILD_1PCT", "rain_factor": 0.99, "theta_fc": 0.151},
            ],
        )
        self.assertEqual(res_unchanged["canonical_stability_status"], "UNCHANGED_WITHIN_TESTED_SCENARIOS")
        self.assertEqual(res_unchanged["flip_witness_count"], 0)

        # 3. CANONICAL_DECISION_SENSITIVITY_UNDETERMINED (missing_evidence / max_scenarios=0)
        res_undet = self.canonical_runner.run(self.missing_evidence)
        self.assertEqual(res_undet["canonical_stability_status"], "CANONICAL_DECISION_SENSITIVITY_UNDETERMINED")
        res_bad_budget = self.canonical_runner.run(self.supported_soil, max_scenarios=0)
        self.assertEqual(res_bad_budget["canonical_stability_status"], "CANONICAL_DECISION_SENSITIVITY_UNDETERMINED")

    def test_side_by_side_witness_and_scope_json_match(self) -> None:
        scope_path = ROOT / "docs" / "adaptive_evidence" / "SENSITIVITY_SCOPE_AND_TESTS.json"
        self.assertTrue(scope_path.exists())
        doc = json.loads(scope_path.read_text(encoding="utf-8"))
        w = doc["side_by_side_divergence_witness"]
        self.assertEqual(w["screening_result"]["stability_classification"], "DECISION_STABLE_WITHIN_TESTED_SCENARIOS")
        self.assertEqual(w["canonical_result"]["canonical_stability_status"], "CHANGED_WITHIN_TESTED_SCENARIOS")
        self.assertGreater(w["canonical_result"]["flip_witness_count"], 0)

    def test_screening_analyzer_non_dict_input_fails_safely(self) -> None:
        from adaptive_evidence.sensitivity import DecisionSensitivityAnalyzer
        analyzer = DecisionSensitivityAnalyzer()
        for bad in ("not_a_dict", None, []):
            out = analyzer.analyze(bad)  # type: ignore[arg-type]
            self.assertEqual(out["stability_classification"], "UNDETERMINED")


if __name__ == "__main__":
    unittest.main()
