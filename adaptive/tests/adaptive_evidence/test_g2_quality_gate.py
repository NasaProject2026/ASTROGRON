"""Suite C — G2 Evidence Quality Gate, Evidence Levels, and Single Next Input Ranking Tests."""
from __future__ import annotations

import io
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

from adaptive_evidence.adapters.nasa_power import NASAPowerAdapter
from adaptive_evidence.engine import AdaptiveEvidenceEngine
from adaptive_evidence.quality_gate import EvidenceQualityGate, rank_single_next_missing_input
from adaptive_evidence.unified_system import UnifiedAstragronSystem


def _subannual_power_bytes() -> bytes:
    d0 = date(2024, 6, 1)
    d1 = date(2024, 6, 15)
    tmin, tmax, tmean, pre = {}, {}, {}, {}
    cur = d0
    while cur <= d1:
        k = cur.strftime("%Y%m%d")
        tmin[k] = 12.0
        tmax[k] = 24.0
        tmean[k] = 18.0
        pre[k] = 1.5
        cur += timedelta(days=1)
    payload = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [17.65, 59.82, 30.0]},
        "header": {
            "api": {"version": "v2.10.3", "name": "POWER Daily API"},
            "sources": ["MERRA2"],
            "fill_value": -999.0,
            "start": "20240601",
            "end": "20240615",
        },
        "parameters": {
            "T2M_MIN": {"units": "C"},
            "T2M_MAX": {"units": "C"},
            "T2M": {"units": "C"},
            "PRECTOTCORR": {"units": "mm/day"},
        },
        "properties": {"parameter": {"T2M_MIN": tmin, "T2M_MAX": tmax, "T2M": tmean, "PRECTOTCORR": pre}},
    }
    return json.dumps(payload).encode("utf-8")


class _MockResp:
    def __init__(self, body: bytes) -> None:
        self.status = 200
        self._bio = io.BytesIO(body)

    def read(self, n: int = -1) -> bytes:
        return self._bio.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class TestG2QualityGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = AdaptiveEvidenceEngine()
        cls.unified = UnifiedAstragronSystem()

    def test_subannual_climate_preserved_descriptively_while_annual_c6_c7_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            eng = AdaptiveEvidenceEngine(nasa_adapter=NASAPowerAdapter(cache_dir=Path(td)))
            req = {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "g2-subannual-c6-block",
                "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                "period": {"start": "2024-06-01", "end": "2024-06-15"},
                "soil_depth_intervals_cm": [[0, 5]],
                "candidate_crops": ["wheat", "barley"],
                "water_supply_scenario": {"regime": "rainfed"},
                "options": {"acquisition": "FETCH_ALLOWED", "allow_conditional_crop_planning": True},
            }
            with mock.patch("adaptive_evidence.adapters.nasa_power.urllib.request.urlopen", return_value=_MockResp(_subannual_power_bytes())):
                resp = eng.evaluate(req)
            self.assertEqual(resp["capability_statuses"]["C2"], "READY")
            self.assertTrue(resp["capabilities"]["C2"]["diagnostics"]["is_sub_annual_window"])
            self.assertEqual(resp["capability_statuses"]["C6"], "BLOCKED")
            self.assertEqual(resp["capabilities"]["C6"]["missing_reason"], "temporal_mismatch")
            self.assertEqual(resp["capability_statuses"]["C7"], "BLOCKED")
            qa = resp["quality_assessment"]
            self.assertEqual(qa["capability_verdicts"]["C2"]["verdict"], "ACCEPTED_CONDITIONALLY")
            self.assertTrue(qa["descriptive_partial_climate_preserved"])
            self.assertEqual(qa["overall_verdict"], "DEGRADED_TO_DESCRIPTION")

    def test_unverified_user_measurement_downgraded_and_verified_metadata_upgraded(self) -> None:
        base_req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g2-user-meta-audit",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["barley"],
            "water_supply_scenario": {"regime": "rainfed"},
            "options": {"allow_conditional_crop_planning": True},
        }
        # 1. User supplies theta_fc/wp without date/method/depth -> USER_DECLARED_SCENARIO + DEGRADED_TO_DESCRIPTION
        unver_req = dict(base_req, user_measurements={"theta_fc": 0.30, "theta_wp": 0.14})
        res_unver = self.engine.evaluate(unver_req)
        self.assertEqual(res_unver["capability_statuses"]["C4"], "CONDITIONAL")
        self.assertIn("USER_DECLARED_SCENARIO", res_unver["evidence_levels_observed"])
        qa_u = res_unver["quality_assessment"]
        self.assertTrue(qa_u["user_measurement_audit"]["downgraded_to_scenario"])
        self.assertEqual(qa_u["capability_verdicts"]["C4"]["verdict"], "DEGRADED_TO_DESCRIPTION")

        # 2. User supplies complete date + lab method + depth -> C4 READY + ACCEPTED_FOR_CLAIM
        ver_req = dict(
            base_req,
            user_measurements={
                "theta_fc": 0.30,
                "theta_wp": 0.14,
                "measured_at": "2026-04-01",
                "lab_method": "pressure_plate_iso_11274",
                "depth_interval_cm": [0, 30],
            },
        )
        res_ver = self.engine.evaluate(ver_req)
        self.assertEqual(res_ver["capability_statuses"]["C4"], "READY")
        self.assertFalse(res_ver["quality_assessment"]["user_measurement_audit"]["downgraded_to_scenario"])
        self.assertEqual(res_ver["quality_assessment"]["capability_verdicts"]["C4"]["verdict"], "ACCEPTED_FOR_CLAIM")

    def test_cross_source_disagreement_triggers_finding_and_blocks_upgrade(self) -> None:
        # Huge user AWC (450 mm/m) diverging sharply from Uppsala mineral SoilGrids PTF
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g2-disagreement",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat"],
            "water_supply_scenario": {"regime": "rainfed"},
            "user_measurements": {
                "theta_fc": 0.55,
                "theta_wp": 0.10,
                "measured_at": "2026-04-01",
                "lab_method": "pressure_plate",
                "depth_interval_cm": [0, 30],
            },
            "options": {"allow_conditional_crop_planning": True},
        }
        resp = self.engine.evaluate(req)
        codes = [f["code"] for f in resp["quality_assessment"]["gate_findings"]]
        self.assertIn("CROSS_SOURCE_DISAGREEMENT", codes)
        # 3. Disagreement keeps C4 CONDITIONAL & DEGRADED_TO_DESCRIPTION (never ACCEPTED_FOR_CLAIM)
        self.assertNotEqual(resp["capability_statuses"]["C4"], "READY")
        self.assertEqual(resp["quality_assessment"]["capability_verdicts"]["C4"]["verdict"], "DEGRADED_TO_DESCRIPTION")
        self.assertEqual(resp["quality_assessment"]["capability_verdicts"]["C7"]["verdict"], "DEGRADED_TO_DESCRIPTION")

        # Direct gate check even if caller spoofed C4=READY
        qa_spoof = EvidenceQualityGate().evaluate(
            req,
            capabilities={**resp["capabilities"], "C4": {"status": "READY"}},
            disagreement_diagnostics={"cross_source_disagreement_detected": True},
        )
        self.assertEqual(qa_spoof["capability_verdicts"]["C4"]["verdict"], "DEGRADED_TO_DESCRIPTION")

    def test_single_next_missing_input_ranking_and_unified_envelope_propagation(self) -> None:
        # Missing water_supply_scenario blocks C7 -> MUST rank irrigation_water_regime BEFORE non-blocking soil AWC / mineral N
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g2-next-input-rank",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["barley"],
            "water_supply_scenario": {},
        }
        env = self.unified.evaluate_unified(req)
        top = env["single_next_missing_input"]
        self.assertIsNotNone(top)
        self.assertEqual(top["priority_tier"], "BLOCKING_DEPENDENCY")
        self.assertEqual(top["input_key"], "water_supply_scenario.regime_and_volume")
        ranking = env["quality_assessment"]["next_input_ranking"]
        self.assertIsNone(ranking["economic_voi_usd"])
        self.assertFalse(ranking["fabricated_voi"])
        # Verify synthetic fixture warning flagged when GAEZ contract test fixture or synthetic evidence is present
        syn_req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "g2-synthetic-fixture-fallback",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["barley"],
            "water_supply_scenario": {"regime": "rainfed"},
            "options": {"allow_gaez_contract_fixture": True},
        }
        syn_resp = self.engine.evaluate(syn_req)
        self.assertIn("SYNTHETIC_TEST_FIXTURE", syn_resp["evidence_levels_observed"])
        self.assertIn("SYNTHETIC_FIXTURE_DETECTED", [f["code"] for f in syn_resp["quality_assessment"]["gate_findings"]])
        # Also verify direct QualityGate downgrades synthetic C2 input
        qa_syn = EvidenceQualityGate().evaluate(
            syn_req,
            capabilities=syn_resp["capabilities"],
            evidence_objects=[{"evidence_level": "SYNTHETIC_TEST_FIXTURE"}],
        )
        self.assertEqual(qa_syn["capability_verdicts"]["C2"]["verdict"], "DEGRADED_TO_DESCRIPTION")

        # Verify spoofed C10=READY is rejected in direct EvidenceQualityGate call
        qa_c10 = EvidenceQualityGate().evaluate(
            syn_req,
            capabilities={**syn_resp["capabilities"], "C10": {"status": "READY", "missing_reason": None}},
        )
        self.assertEqual(qa_c10["capability_verdicts"]["C10"]["verdict"], "REJECTED")
        self.assertIn("official_verification_required", qa_c10["capability_verdicts"]["C10"]["reason_codes"])

        # Verify whitespace metadata & empty/malformed depth_interval_cm degrade to USER_DECLARED_SCENARIO
        ws_req = {
            **syn_req,
            "request_id": "g2-whitespace-meta",
            "user_measurements": {
                "theta_fc": 0.30,
                "theta_wp": 0.14,
                "measured_at": "   ",
                "lab_method": "\t",
                "depth_interval_cm": [],
            },
        }
        ws_resp = self.engine.evaluate(ws_req)
        self.assertEqual(ws_resp["capability_statuses"]["C4"], "CONDITIONAL")
        self.assertTrue(ws_resp["quality_assessment"]["user_measurement_audit"]["downgraded_to_scenario"])
        self.assertEqual(ws_resp["quality_assessment"]["capability_verdicts"]["C4"]["verdict"], "DEGRADED_TO_DESCRIPTION")

        # Direct rank_single_next_missing_input surfaces missing regime when water_supply_scenario lacks regime
        direct_rank = rank_single_next_missing_input(
            {"C1": {"status": "READY"}, "C2": {"status": "READY"}, "C3": {"status": "READY"}, "C4": {"status": "CONDITIONAL"}, "C6": {"status": "BLOCKED"}, "C7": {"status": "BLOCKED", "missing_reason": "insufficient_parameters"}},
            water_supply={},
            user_meas={},
        )
        self.assertEqual(direct_rank["single_next_missing_input"]["input_key"], "water_supply_scenario.regime_and_volume")


if __name__ == "__main__":
    unittest.main()
