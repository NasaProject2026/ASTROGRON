"""Unit and integration tests for Stage P6 — Coordinator-Ready Handoff and Integration Adapter."""
from __future__ import annotations

import json
import unittest

from adaptive_evidence.integration import (
    PROVENANCE_AND_LICENSE_LEDGER,
    ROLLBACK_AND_ISOLATION_PLAN,
    AdaptiveClientDecisionBridge,
)
from adaptive_evidence.inventory import ROOT


class TestStageP6IntegrationHandoff(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.bridge = AdaptiveClientDecisionBridge()

    def test_bridge_enriches_blocked_upstream_water_only_request(self) -> None:
        water_only_path = ROOT / "examples" / "engine" / "water_only.json"
        client_req = json.loads(water_only_path.read_text(encoding="utf-8"))

        env = self.bridge.evaluate_with_adaptive_sidecar(client_req)
        self.assertEqual(env["schema"], "astragron.adaptive-evidence.coordinator-envelope.v1")
        self.assertTrue(env["upstream_integrity_verified"])
        # Upstream blocks or returns water-only while adaptive sidecar provides C1, C2, C3, C4, C6, C7!
        sidecar = env["adaptive_evidence_sidecar"]
        self.assertEqual(sidecar["overall_summary_status"], "PARTIAL_OR_CONDITIONAL_READY")
        self.assertEqual(sidecar["capability_statuses"]["C1"], "READY")
        self.assertEqual(sidecar["capability_statuses"]["C2"], "READY")
        self.assertEqual(sidecar["capability_statuses"]["C3"], "CONDITIONAL")
        self.assertEqual(sidecar["capability_statuses"]["C4"], "CONDITIONAL")
        self.assertEqual(sidecar["capability_statuses"]["C6"], "CONDITIONAL")
        self.assertEqual(sidecar["capability_statuses"]["C7"], "CONDITIONAL")
        self.assertIn(
            env["decision_sensitivity"]["stability_classification"],
            ("DECISION_STABLE_WITHIN_TESTED_SCENARIOS", "DECISION_SENSITIVE"),
        )

    def test_provenance_license_ledger_and_rollback_plan_complete(self) -> None:
        self.assertGreaterEqual(len(PROVENANCE_AND_LICENSE_LEDGER), 6)
        for entry in PROVENANCE_AND_LICENSE_LEDGER:
            self.assertTrue(entry["source_or_method_id"])
            self.assertTrue(entry["license"])
            self.assertTrue(entry["citation"])
        self.assertEqual(ROLLBACK_AND_ISOLATION_PLAN["pre_existing_files_modified"], [])
        self.assertEqual(ROLLBACK_AND_ISOLATION_PLAN["protected_baseline_files_touched"], 0)
        self.assertEqual(ROLLBACK_AND_ISOLATION_PLAN["growth_input_files_touched"], 0)


if __name__ == "__main__":
    unittest.main()
