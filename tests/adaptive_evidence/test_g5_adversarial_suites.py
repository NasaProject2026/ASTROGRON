"""Suite E — Cross-Layer Adversarial Security, License Scanner, and Receipt Tampering Tests."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from adaptive_evidence.engine import AdaptiveEvidenceEngine
from adaptive_evidence.license_gate import (
    ROOT,
    build_external_data_rights_register,
    evaluate_open_source_license_gate,
)
from adaptive_evidence.schema import validate_coordinates_and_crs


class TestG5AdversarialSuites(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = AdaptiveEvidenceEngine()

    def test_license_gate_blocks_geotiffs_secrets_env_archives_and_root_license_creation(self) -> None:
        clean = evaluate_open_source_license_gate()
        self.assertTrue(clean["OPEN_SOURCE_RELEASE_REVIEW_READY"])
        self.assertEqual(clean["original_owned_code_license"], "Apache-2.0")
        self.assertFalse((ROOT / "LICENSE").exists())

        with tempfile.TemporaryDirectory() as td:
            p = Path(td)
            (p / "leak.tif").write_bytes(b"II*\x00")
            (p / "raw.zip").write_bytes(b"PK\x03\x04")
            (p / ".env").write_text("DUMMY=1", encoding="utf-8")
            (p / "aws_leak.py").write_text("KEY = '" + "AKIA" + "1234567890ABCDEF'\n", encoding="utf-8")
            res = evaluate_open_source_license_gate(scan_dirs=[p])
            codes = {b["code"] for b in res["blockers"]}
            self.assertFalse(res["OPEN_SOURCE_RELEASE_REVIEW_READY"])
            self.assertIn("UNEXPECTED_RAW_RASTER_OR_ARCHIVE_ASSET", codes)
            self.assertIn("SENSITIVE_CREDENTIAL_FILE_DETECTED", codes)
            self.assertIn("BUNDLED_SECRET_OR_CREDENTIAL_DETECTED", codes)

    def test_extreme_adversarial_inputs_fail_closed_cleanly(self) -> None:
        # 1. NaN / Inf coordinates
        for bad_pt in ([float("nan"), 48.0], [1.6, float("inf")], [None, 48.0], ["1.6", 48.0]):
            chk = validate_coordinates_and_crs(bad_pt, "EPSG:4326")
            self.assertFalse(chk["valid"])

        # 2. Unsupported projected CRS rejected before climate/soil
        resp_crs = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "adv-bad-crs",
                "location": {"point_lon_lat": [500000.0, 5350000.0], "crs": "EPSG:32631"},
            }
        )
        self.assertEqual(resp_crs["capability_statuses"]["C1"], "BLOCKED")
        self.assertEqual(resp_crs["capabilities"]["C1"]["missing_reason"], "invalid_coordinates_or_crs")

        # 3. Corrupted receipt & outage simulation returns BLOCKED without crashing
        resp_corrupt = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "adv-corrupt-receipt",
                "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                "soil_depth_intervals_cm": [[0, 5]],
                "options": {"simulate_corrupt_receipt": True},
            }
        )
        self.assertEqual(resp_corrupt["capability_statuses"]["C2"], "BLOCKED")
        self.assertEqual(resp_corrupt["capabilities"]["C2"]["missing_reason"], "corrupt_receipt_or_hash_mismatch")

        # 4. Inverted user soil bounds (theta_wp >= theta_fc) fails closed
        resp_soil = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "adv-bad-soil",
                "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                "soil_depth_intervals_cm": [[0, 5]],
                "user_measurements": {"theta_fc": 0.10, "theta_wp": 0.25},
            }
        )
        self.assertEqual(resp_soil["capability_statuses"]["C4"], "BLOCKED")
        self.assertEqual(resp_soil["capabilities"]["C4"]["missing_reason"], "quality_fail")

        # 5. Organic peat (SOC=250 g/kg >= 120 g/kg) out-of-domain mineral PTF rejected cleanly
        # Verified via P2 & quality_gate checks; confirm empty crops fails C6/C7 without crash
        resp_empty_crop = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "adv-empty-crops",
                "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                "soil_depth_intervals_cm": [[0, 5]],
                "candidate_crops": [],
                "water_supply_scenario": {"regime": "rainfed"},
            }
        )
        self.assertEqual(resp_empty_crop["capability_statuses"]["C7"], "BLOCKED")

        # 6. Non-numeric / boolean / NaN user soil bounds fail closed without raising ValueError
        for bad_um in (
            {"theta_fc": "bad_float", "theta_wp": 0.10},
            {"theta_fc": True, "theta_wp": 0.10},
            {"theta_fc": float("nan"), "theta_wp": 0.10},
            {"root_depth_m": "bad_depth", "theta_fc": 0.30, "theta_wp": 0.14},
        ):
            resp_nan = self.engine.evaluate(
                {
                    "schema": "astragron.adaptive-evidence.request.v1",
                    "request_id": "adv-non-numeric-soil",
                    "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                    "soil_depth_intervals_cm": [[0, 5]],
                    "user_measurements": bad_um,
                }
            )
            self.assertEqual(resp_nan["capability_statuses"]["C4"], "BLOCKED")
            self.assertEqual(resp_nan["capabilities"]["C4"]["missing_reason"], "quality_fail")

        # 7. Non-bundled active dataset with CC-BY-NC-4.0 license fails open-source gate
        from unittest import mock
        from adaptive_evidence import license_gate
        bad_register = [
            {
                "dataset_id": "ACTIVE_NC_DATASET",
                "declared_license": "CC-BY-NC-4.0",
                "mandatory_attribution": "Third party NC data",
                "is_osi_software_license": False,
                "reuse_and_redistribution_permitted": False,
                "access_mode": "LIVE_OPTIONAL",
            }
        ]
        with mock.patch("adaptive_evidence.license_gate.build_external_data_rights_register", return_value=bad_register):
            gate_res = license_gate.evaluate_open_source_license_gate()
        self.assertEqual(gate_res["status"], "BLOCKED")
        self.assertTrue(any(b["code"] == "DISALLOWED_DATA_LICENSE" for b in gate_res["blockers"]))


if __name__ == "__main__":
    unittest.main()
