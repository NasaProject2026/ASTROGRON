"""Unit tests for Stage P5 — Geographic Generalization Evaluation, Security & Scientific Red-Team."""
from __future__ import annotations

import json
import unittest

from adaptive_evidence.evaluation import evaluate_p5_generalization_and_redteam


class TestStageP5GeneralizationAndRedTeam(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.report_1 = evaluate_p5_generalization_and_redteam()
        cls.report_2 = evaluate_p5_generalization_and_redteam()

    def test_rerun_determinism_byte_identical(self) -> None:
        j1 = json.dumps(self.report_1, sort_keys=True, separators=(",", ":"))
        j2 = json.dumps(self.report_2, sort_keys=True, separators=(",", ":"))
        self.assertEqual(j1, j2)

    def test_coverage_metrics_and_zero_false_upgrades(self) -> None:
        m = self.report_1["summary_metrics"]
        self.assertEqual(m["total_geographic_cases"], 24)
        self.assertEqual(m["FALSE_QUALIFICATION_UPGRADES"], 0)
        self.assertEqual(m["EVIDENCE_METADATA_COMPLETENESS"], 1.0)
        self.assertEqual(m["prediction_accuracy"], "NOT_MEASURED")
        auth = m["AUTHENTIC_SOURCE_RETRIEVAL"]
        off = m["OFFLINE_REFERENCE_SCENARIO"]
        self.assertFalse(auth["counts_offline_fixtures"])
        self.assertEqual(auth["denominator"], 24)
        self.assertAlmostEqual(auth["authentic_source_retrieval_coverage"], 6 / 24, places=4)
        self.assertFalse(off["is_authentic_live_source_retrieval"])
        self.assertNotIn("SOURCE_RETRIEVAL_COVERAGE", off)
        self.assertEqual(off["offline_fixture_partial_rate"], 1.0)
        self.assertAlmostEqual(off["offline_fixture_c7_screening_rate"], 23 / 24, places=4)
        self.assertEqual(off["domain_blocked_peatland_cases"], ["FI_OSTROBOTHNIA_OULU"])

    def test_all_16_redteam_and_security_probes_pass(self) -> None:
        m = self.report_1["summary_metrics"]
        self.assertEqual(m["total_redteam_cases"], 16)
        self.assertEqual(m["REDTEAM_PASS_RATE"], 1.0)
        for probe in self.report_1["redteam_and_security_results"]:
            self.assertTrue(probe["passed"], msg=probe["probe_id"])


if __name__ == "__main__":
    unittest.main()
