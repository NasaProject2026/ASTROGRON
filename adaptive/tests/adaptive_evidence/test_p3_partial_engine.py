"""Unit and scenario tests for Stage P3 — Capability-Level Partial-Results Engine."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

import jsonschema

from adaptive_evidence.engine import AdaptiveEvidenceEngine
from adaptive_evidence.inventory import ROOT

REQ_SCHEMA_PATH = ROOT / "docs" / "adaptive_evidence" / "adaptive_evidence_request_v1.schema.json"
RESP_SCHEMA_PATH = ROOT / "docs" / "adaptive_evidence" / "adaptive_evidence_response_v1.schema.json"


class TestStageP3PartialResultsEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = AdaptiveEvidenceEngine()
        cls.req_schema = json.loads(REQ_SCHEMA_PATH.read_text(encoding="utf-8"))
        cls.resp_schema = json.loads(RESP_SCHEMA_PATH.read_text(encoding="utf-8"))

    def _validate_and_run(self, req: dict) -> dict:
        jsonschema.validate(req, self.req_schema)
        resp = self.engine.evaluate(req)
        jsonschema.validate(resp, self.resp_schema)
        self.assertFalse(resp["scientific_guardrails"]["field_validated"])
        self.assertIsNone(resp["scientific_guardrails"]["marketable_yield"])
        self.assertIsNone(resp["scientific_guardrails"]["profit"])
        self.assertEqual(resp["scientific_guardrails"]["prediction_accuracy"], "NOT_MEASURED")
        self.assertEqual(resp["scientific_guardrails"]["false_qualification_upgrades"], 0)
        return resp

    def test_scenario_1_climate_only(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p3-scen-1-climate-only",
            "location": {"site_id": "DE_BERLIN", "point_lon_lat": [13.405, 52.52], "crs": "EPSG:4326"},
            "options": {"acquisition": "CACHE_ONLY", "allow_offline_reference_fixture": False},
        }
        resp = self._validate_and_run(req)
        self.assertEqual(resp["capability_statuses"]["C1"], "READY")
        self.assertEqual(resp["capability_statuses"]["C2"], "READY")
        self.assertEqual(resp["capability_statuses"]["C3"], "BLOCKED")
        self.assertEqual(resp["capability_statuses"]["C4"], "BLOCKED")
        self.assertEqual(resp["capability_statuses"]["C7"], "BLOCKED")
        self.assertIn("historical_regional_climate", resp["usable_outputs"])

    def test_scenario_2_climate_plus_regional_soil(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p3-scen-2-climate-plus-soil",
            "location": {"site_id": "KE_NYERI_REGION", "point_lon_lat": [36.95, -0.42], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "options": {"acquisition": "CACHE_ONLY"},
        }
        resp = self._validate_and_run(req)
        self.assertEqual(resp["capability_statuses"]["C1"], "READY")
        self.assertEqual(resp["capability_statuses"]["C2"], "READY")
        self.assertEqual(resp["capability_statuses"]["C3"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C4"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C6"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C7"], "BLOCKED")
        self.assertEqual(resp["capability_statuses"]["C8"], "BLOCKED")
        self.assertEqual(resp["capability_statuses"]["C10"], "BLOCKED")

    def test_scenario_3_source_outage(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p3-scen-3-source-outage",
            "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "options": {"simulate_nasa_outage": True, "simulate_soilgrids_outage": False},
        }
        resp = self._validate_and_run(req)
        self.assertEqual(resp["capability_statuses"]["C1"], "READY")
        self.assertEqual(resp["capability_statuses"]["C2"], "BLOCKED")
        self.assertEqual(resp["capabilities"]["C2"]["missing_reason"], "source_outage")
        # Soil C3 & C4 still succeed independently even when NASA POWER C2 has an outage!
        self.assertEqual(resp["capability_statuses"]["C3"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C4"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C6"], "BLOCKED")

    def test_scenario_4_unsupported_crop(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p3-scen-4-unsupported-crop",
            "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["dragonfruit", "wheat"],
            "water_supply_scenario": {"regime": "rainfed"},
        }
        resp = self._validate_and_run(req)
        self.assertEqual(resp["capability_statuses"]["C1"], "READY")
        self.assertEqual(resp["capability_statuses"]["C2"], "READY")
        self.assertEqual(resp["capability_statuses"]["C3"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C4"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C6"], "BLOCKED")
        self.assertEqual(resp["capabilities"]["C6"]["missing_reason"], "unsupported_crop_profile")
        self.assertEqual(resp["capability_statuses"]["C7"], "BLOCKED")

    def test_scenario_5_supported_conditional_research(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p3-scen-5-conditional-research",
            "location": {
                "site_id": "NL_WAGENINGEN_RESEARCH",
                "point_lon_lat": [5.67, 51.97],
                "crs": "EPSG:4326",
            },
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat", "barley", "potato"],
            "water_supply_scenario": {"regime": "rainfed"},
            "user_measurements": {"mineral_n_kg_ha": 45.0, "input_cost_eur_ha": 620.0},
            "options": {"allow_offline_reference_fixture": True, "allow_conditional_crop_planning": True},
        }
        resp = self._validate_and_run(req)
        self.assertEqual(resp["capability_statuses"]["C1"], "READY")
        self.assertEqual(resp["capability_statuses"]["C2"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C3"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C4"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C6"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C7"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C8"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C9"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C10"], "BLOCKED")

    def test_scenario_6_missing_water_rights(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p3-scen-6-missing-water-rights",
            "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["wheat", "barley", "chickpea"],
            "water_supply_scenario": {
                "regime": "irrigated",
                "seasonal_supply_m3_ha": 1800.0,
                "official_water_permit_verified": False,
            },
        }
        resp = self._validate_and_run(req)
        self.assertEqual(resp["capability_statuses"]["C6"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C7"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C10"], "BLOCKED")
        self.assertEqual(resp["capabilities"]["C10"]["missing_reason"], "official_verification_required")

    def test_scenario_7_unknown_field_measurements(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "p3-scen-7-unknown-field-measurements",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
        }
        resp = self._validate_and_run(req)
        self.assertEqual(resp["capability_statuses"]["C1"], "READY")
        self.assertEqual(resp["capability_statuses"]["C2"], "READY")
        self.assertEqual(resp["capability_statuses"]["C3"], "CONDITIONAL")
        self.assertEqual(resp["capability_statuses"]["C4"], "CONDITIONAL")
        self.assertGreaterEqual(len(resp["minimal_next_measurements"]), 3)


if __name__ == "__main__":
    unittest.main()
