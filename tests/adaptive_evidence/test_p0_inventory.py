"""Stage P0 unit tests: upstream integrity, capability DAG, and 32-case baseline matrix."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from adaptive_evidence.capabilities import (
    CAPABILITY_REGISTRY,
    CAPABILITY_STATUSES,
    FORBIDDEN_DERIVATIONS,
    PARAMETER_PROVENANCE_CLASSES,
    capability_dependency_graph,
)
from adaptive_evidence.inventory import (
    P0_BASELINE_CASES,
    ROOT,
    compute_p0_baseline_report,
    evaluate_p0_baseline_case,
    verify_upstream_integrity,
)


class P0InventoryTests(unittest.TestCase):
    def test_upstream_and_protected_baseline_integrity(self) -> None:
        res = verify_upstream_integrity(ROOT)
        self.assertTrue(res["passed"], f"Upstream integrity check failed: {res}")
        self.assertEqual(res["protected_baseline_files_verified"], 301)
        self.assertEqual(res["protected_baseline_mismatches"], [])
        self.assertEqual(res["growth_input_files_verified"], 59)
        self.assertEqual(res["growth_input_mismatches"], [])
        self.assertEqual(res["pre_existing_files_altered"], [])

    def test_capability_dependency_graph_structure(self) -> None:
        graph = capability_dependency_graph()
        self.assertEqual(
            graph["topological_order"],
            ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"],
        )
        # C2 and C3 must be independent of C7 (planner)
        self.assertIn("C2", graph["independent_partial_capabilities"])
        self.assertIn("C3", graph["independent_partial_capabilities"])
        self.assertIn("C4", graph["independent_partial_capabilities"])
        self.assertIn("C6", graph["independent_partial_capabilities"])
        self.assertIn("C7", graph["planner_gated_capabilities"])
        self.assertIn("C8", graph["planner_gated_capabilities"])
        # C10 always requires official local verification
        self.assertEqual(graph["always_official_verification_required"], ["C10"])
        self.assertFalse(graph["non_negotiable_rules"]["ready_implies_field_validated"])
        self.assertFalse(graph["non_negotiable_rules"]["null_converted_to_zero"])
        self.assertFalse(graph["non_negotiable_rules"]["c7_block_suppresses_c2_or_c3"])
        self.assertFalse(graph["non_negotiable_rules"]["soilgrids_total_n_to_mineral_n_allowed"])

    def test_baseline_matrix_has_at_least_24_geographic_and_6_adversarial_cases(self) -> None:
        geo = [c for c in P0_BASELINE_CASES if c["category"] == "geographic"]
        adv = [c for c in P0_BASELINE_CASES if c["category"] == "adversarial"]
        self.assertGreaterEqual(len(geo), 24)
        self.assertGreaterEqual(len(adv), 6)
        self.assertEqual(len(geo), 24)
        self.assertEqual(len(adv), 8)
        # Check hemisphere and region diversity
        hemispheres = {c["hemisphere"] for c in geo}
        self.assertIn("Northern", hemispheres)
        self.assertIn("Southern", hemispheres)
        region_classes = {c["region_class"] for c in geo}
        self.assertGreaterEqual(len(region_classes), 15)

    def test_baseline_evaluation_matches_expected_p0_statuses(self) -> None:
        for case in P0_BASELINE_CASES:
            out = evaluate_p0_baseline_case(case)
            self.assertEqual(
                out["p0_capabilities"],
                case["expected_p0_capabilities"],
                f"Mismatch on {case['case_id']}",
            )
            self.assertFalse(out["field_validated"])
            self.assertIsNone(out["marketable_yield"])
            self.assertIsNone(out["profit"])
            self.assertEqual(out["false_qualification_upgrades"], 0)
            # C10 must always be BLOCKED in unverified baseline
            self.assertEqual(out["p0_capabilities"]["C10"], "BLOCKED")

    def test_partial_capability_isolation_c7_blocked_does_not_suppress_c2(self) -> None:
        # KE_NYERI and DE_BERLIN have cached NASA climate (C2=READY) but incomplete C7 planner inputs
        by_id = {c["case_id"]: evaluate_p0_baseline_case(c) for c in P0_BASELINE_CASES}
        for cid in ("GEO_03_KE_NYERI", "GEO_04_DE_BERLIN"):
            res = by_id[cid]
            self.assertEqual(res["p0_capabilities"]["C7"], "BLOCKED")
            self.assertEqual(res["p0_capabilities"]["C2"], "READY")
            self.assertTrue(res["useful_partial_in_p0_baseline"])

    def test_adversarial_ocean_crs_bounds_and_depth_blocked(self) -> None:
        by_id = {c["case_id"]: evaluate_p0_baseline_case(c) for c in P0_BASELINE_CASES}
        for cid in (
            "ADV_01_PACIFIC_OCEAN",
            "ADV_02_UNSUPPORTED_CRS",
            "ADV_03_OUT_OF_BOUNDS_LAT_LON",
            "ADV_04_ANTARCTICA_ICE_CAP",
        ):
            res = by_id[cid]
            self.assertTrue(
                all(v == "BLOCKED" for v in res["p0_capabilities"].values()),
                f"Expected all capabilities BLOCKED for {cid}",
            )
        # Misaligned soil depth blocks C3, C4, C6, C7 while C1 and C2 stay READY
        depth_res = by_id["ADV_05_MISALIGNED_SOIL_DEPTH"]
        self.assertEqual(depth_res["p0_capabilities"]["C1"], "READY")
        self.assertEqual(depth_res["p0_capabilities"]["C2"], "READY")
        self.assertEqual(depth_res["p0_capabilities"]["C3"], "BLOCKED")
        self.assertEqual(depth_res["p0_capabilities"]["C4"], "BLOCKED")
        self.assertEqual(depth_res["p0_capabilities"]["C7"], "BLOCKED")

    def test_deterministic_p0_report_generation(self) -> None:
        r1 = compute_p0_baseline_report(ROOT)
        r2 = compute_p0_baseline_report(ROOT)
        self.assertEqual(
            json.dumps(r1, sort_keys=True),
            json.dumps(r2, sort_keys=True),
        )
        self.assertEqual(r1["summary_metrics"]["geographic_cases"], 24)
        self.assertEqual(r1["summary_metrics"]["adversarial_cases"], 8)
        self.assertEqual(r1["summary_metrics"]["false_qualification_upgrades"], 0)
        self.assertEqual(r1["summary_metrics"]["field_validated_count"], 0)


if __name__ == "__main__":
    unittest.main()
