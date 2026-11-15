"""Independent negative & handoff acceptance checks for ASTRAGRON Adaptive Evidence."""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import struct
import tempfile
import unittest
import urllib.error
import zlib
from pathlib import Path
from unittest import mock

from adaptive_evidence.adapters.fao_gaez import FAOGAEZAdapter
from adaptive_evidence.adapters.nasa_power import NASAPowerAdapter
from adaptive_evidence.adapters.soilgrids import SoilGridsWCSAdapter
from adaptive_evidence.engine import AdaptiveEvidenceEngine
from adaptive_evidence.license_gate import (
    ROOT,
    build_external_data_rights_register,
    evaluate_open_source_license_gate,
)
from adaptive_evidence.quality_gate import EvidenceQualityGate
from adaptive_evidence.sensitivity import DecisionSensitivityAnalyzer


def _corrupt_geotiff_bytes() -> bytes:
    return b"NOT_A_VALID_TIFF"


def _minimal_1x1_tiff(lon: float, lat: float, raw_val: int) -> bytes:
    raw_strip = struct.pack("<h", int(raw_val))
    compressed = zlib.compress(raw_strip)
    ifd_offset = 8
    entries = [
        (256, 4, 1, 1),
        (257, 4, 1, 1),
        (258, 3, 1, 16),
        (259, 3, 1, 8),
        (273, 4, 1, 0),
        (277, 3, 1, 1),
        (278, 4, 1, 1),
        (279, 4, 1, len(compressed)),
        (339, 3, 1, 2),
        (33550, 12, 3, 0),
        (33922, 12, 6, 0),
    ]
    ifd_size = 2 + len(entries) * 12 + 4
    data_offset = ifd_offset + ifd_size
    pixel_scale_off = data_offset
    tiepoint_off = pixel_scale_off + 24
    strip_off = tiepoint_off + 48
    fixed = []
    for tag, typ, cnt, val in entries:
        if tag == 273:
            val = strip_off
        elif tag == 33550:
            val = pixel_scale_off
        elif tag == 33922:
            val = tiepoint_off
        fixed.append(struct.pack("<HHII", tag, typ, cnt, val))
    header = b"II" + struct.pack("<HI", 42, ifd_offset)
    ifd = struct.pack("<H", len(fixed)) + b"".join(fixed) + struct.pack("<I", 0)
    scales = struct.pack("<ddd", 0.002, 0.002, 0.0)
    tiepoints = struct.pack("<dddddd", 0.0, 0.0, 0.0, float(lon) - 0.001, float(lat) + 0.001, 0.0)
    return header + ifd + scales + tiepoints + compressed


class TestHandoffNegativeChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = AdaptiveEvidenceEngine()
        cls.nasa = NASAPowerAdapter()
        cls.soilgrids = SoilGridsWCSAdapter()
        cls.gate = EvidenceQualityGate()
        cls.gaez = FAOGAEZAdapter()
        cls.sensitivity = DecisionSensitivityAnalyzer(cls.engine)

    def test_1_unsupported_evidence_never_upgrades(self) -> None:
        req = {
            "schema": "astragron.adaptive-evidence.request.v1",
            "request_id": "neg-unsupported-evidence",
            "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "soil_depth_intervals_cm": [[0, 5]],
            "candidate_crops": ["barley"],
            "water_supply_scenario": {"regime": "rainfed"},
            "user_measurements": {"theta_fc": 0.31, "theta_wp": 0.14},
            "options": {"allow_gaez_contract_fixture": True},
        }
        resp = self.engine.evaluate(req)
        self.assertFalse(resp["scientific_guardrails"]["field_validated"])
        self.assertIsNone(resp["scientific_guardrails"]["marketable_yield"])
        self.assertIsNone(resp["scientific_guardrails"]["profit"])
        qa = resp["quality_assessment"]
        self.assertTrue(qa["user_measurement_audit"]["downgraded_to_scenario"])
        self.assertEqual(qa["capability_verdicts"]["C4"]["verdict"], "DEGRADED_TO_DESCRIPTION")
        self.assertIn("SYNTHETIC_TEST_FIXTURE", resp["evidence_levels_observed"])

        qa_direct = self.gate.evaluate(
            req,
            capabilities={**resp["capabilities"], "C2": {"status": "READY"}},
            evidence_objects=[{"evidence_level": "SYNTHETIC_TEST_FIXTURE", "parameter_path": "climate.PRECTOTCORR"}],
        )
        self.assertEqual(qa_direct["capability_verdicts"]["C2"]["verdict"], "DEGRADED_TO_DESCRIPTION")

    def test_2_fabricated_source_receipt_fails_closed(self) -> None:
        req = {
            "location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "water_supply_scenario": {"regime": "rainfed"},
        }
        caps = {"C1": {"status": "READY"}, "C2": {"status": "READY"}}
        fabricated = {
            "parameter_path": "climate.PRECTOTCORR",
            "provenance_class": "OBSERVED_OR_AUTHENTIC_SOURCE",
            "evidence_level": "AUTHENTIC_VERIFIED_CACHE",
            "source_id": "NASA_POWER_MERRA2_DAILY_UTC",
            "provider": "NASA POWER",
            "product": "MERRA-2 Daily",
            "version": "v2.10.3",
            "retrieved_at": "2026-11-14T10:00:00+00:00",
            "valid_period": ["2016-01-01", "2020-12-31"],
            "point_lon_lat": [17.65, 59.82],
            "crs": "EPSG:4326",
            "converted_si_value": 550.0,
            "si_unit": "mm/year",
            "raw_source_sha256": "1" * 64,
            "receipt_sha256": "2" * 64,
            "fixture_origin": "AUTHENTIC_CACHED_RECEIPT",
            "license": "NASA_POWER_PUBLIC_DATA_WITH_ATTRIBUTION",
            "attribution": "NASA POWER",
            "verified": True,
            "receipt_path": "../../adaptive_evidence/engine.py",
            "access_path": "https://evil.invalid/fake.json",
        }
        qa = self.gate.evaluate(req, capabilities=caps, evidence_objects=[fabricated])
        self.assertEqual(qa["capability_verdicts"]["C2"]["verdict"], "UNDETERMINED")
        self.assertIn("UNVERIFIED_SOURCE_PROOF", qa["capability_verdicts"]["C2"]["reason_codes"])
        self.assertNotIn("AUTHENTIC_VERIFIED_CACHE", qa["evidence_levels_observed"])

        with tempfile.TemporaryDirectory() as td:
            def _fail_open(req_obj, timeout=20.0):
                raise urllib.error.URLError("simulated provider outage")

            live_miss = NASAPowerAdapter(cache_dir=Path(td)).fetch_or_load(
                [9.21, 49.14], "2016-01-01", "2020-12-31", acquisition="LIVE_ALLOWED", urlopen_fn=_fail_open
            )
            self.assertEqual(live_miss["status"], "BLOCKED")
            self.assertEqual(live_miss["missing_reason"], "source_outage")

    def test_3_mismatched_locations_polygons_and_crs_fail_closed(self) -> None:
        # Berlin polygon with Heilbronn centroid -> spatial_mismatch before C2/C3
        berlin_poly = {
            "type": "Polygon",
            "coordinates": [[[13.38, 52.50], [13.43, 52.50], [13.43, 52.54], [13.38, 52.54], [13.38, 52.50]]],
        }
        r_poly = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "location": {"point_lon_lat": [9.2109, 49.1427], "crs": "EPSG:4326", "geometry": berlin_poly},
            }
        )
        self.assertEqual(r_poly["capability_statuses"]["C1"], "BLOCKED")
        self.assertEqual(r_poly["capabilities"]["C1"]["missing_reason"], "spatial_mismatch")
        self.assertEqual(r_poly["capability_statuses"]["C2"], "BLOCKED")
        self.assertEqual(r_poly["capability_statuses"]["C3"], "BLOCKED")

        # Ocean & Inland Lake & Invalid CRS
        r_ocean = self.engine.evaluate(
            {"location": {"point_lon_lat": [0.0, 0.0], "crs": "EPSG:4326"}}
        )
        self.assertEqual(r_ocean["capabilities"]["C1"]["land_status"], "OCEAN")
        self.assertEqual(r_ocean["capability_statuses"]["C3"], "BLOCKED")

        r_crs = self.engine.evaluate(
            {"location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:3857"}}
        )
        self.assertEqual(r_crs["capability_statuses"]["C1"], "BLOCKED")

        # Tampered NASA evidence point coordinate (mismatched vs authentic receipt) fails gate
        c2 = self.nasa.fetch_or_load([17.65, 59.82], "2016-01-01", "2020-12-31", acquisition="CACHE_ONLY")
        evs = json.loads(json.dumps(c2["evidence_objects"]))
        evs[0]["point_lon_lat"] = [31.23, 30.04]
        qa_mis = self.gate.evaluate(
            {"location": {"point_lon_lat": [31.23, 30.04], "crs": "EPSG:4326"}},
            capabilities={"C1": {"status": "READY"}, "C2": {"status": "READY"}},
            evidence_objects=evs,
        )
        self.assertIn(qa_mis["capability_verdicts"]["C2"]["verdict"], ("REJECTED", "UNDETERMINED"))

        # Out-of-range evidence coordinate rejected immediately in QualityGate
        evs_oob = json.loads(json.dumps(c2["evidence_objects"]))
        evs_oob[0]["point_lon_lat"] = [185.0, 59.82]
        qa_oob = self.gate.evaluate(
            {"location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"}},
            capabilities={"C1": {"status": "READY"}, "C2": {"status": "READY"}},
            evidence_objects=evs_oob,
        )
        self.assertEqual(qa_oob["capability_verdicts"]["C2"]["verdict"], "REJECTED")

    def test_4_missing_or_invalid_depth_metadata_fails_closed(self) -> None:
        # Depth > 200 cm (within schema 0..500cm root horizon) blocks SoilGrids C3/C4;
        # Depth > 500 cm or non-contiguous gaps block C1 directly.
        r_250 = self.engine.evaluate(
            {
                "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                "soil_depth_intervals_cm": [[0, 250]],
            }
        )
        self.assertEqual(r_250["capability_statuses"]["C3"], "BLOCKED")
        self.assertEqual(r_250["capabilities"]["C3"]["missing_reason"], "depth_interval_unavailable")
        self.assertEqual(r_250["capability_statuses"]["C4"], "BLOCKED")

        r_550 = self.engine.evaluate(
            {
                "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                "soil_depth_intervals_cm": [[0, 550]],
            }
        )
        self.assertEqual(r_550["capability_statuses"]["C1"], "BLOCKED")
        self.assertEqual(r_550["capabilities"]["C1"]["missing_reason"], "depth_inconsistency")

        # Topsoil-only cache (0-5cm) must NOT silently substitute for requested 0-30cm under CACHE_ONLY
        sg_multi = self.soilgrids.fetch_or_load([17.65, 59.82], [(0, 30)], acquisition="CACHE_ONLY")
        self.assertEqual(sg_multi["status"], "BLOCKED")

        # Non-contiguous soil depth interval (omitting 5-15cm gap) fails closed
        r_gap = self.engine.evaluate(
            {
                "location": {"site_id": "SE_UPPSALA", "point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                "soil_depth_intervals_cm": [[0, 5], [15, 30]],
            }
        )
        self.assertEqual(r_gap["capability_statuses"]["C1"], "BLOCKED")
        self.assertEqual(r_gap["capabilities"]["C1"]["missing_reason"], "depth_inconsistency")

        # SoilGrids evidence mutated to wrong depth interval fails gate
        sg_05 = self.soilgrids.fetch_or_load([17.65, 59.82], [(0, 5)], acquisition="CACHE_ONLY")
        bad_depth = json.loads(json.dumps(sg_05["evidence_objects"]))
        bad_depth[0]["depth_interval_cm"] = [60.0, 100.0]
        qa_depth = self.gate.evaluate(
            {"location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"}},
            capabilities={"C1": {"status": "READY"}, "C3": {"status": "CONDITIONAL"}},
            evidence_objects=bad_depth,
        )
        self.assertEqual(qa_depth["capability_verdicts"]["C3"]["verdict"], "UNDETERMINED")

    def test_5_expired_or_invalid_observations_fail_closed(self) -> None:
        # Stale max_age_days=1 against 2026-11-06 cached NASA POWER receipt
        expired = self.nasa.fetch_or_load(
            [17.65, 59.82],
            "2016-01-01",
            "2020-12-31",
            acquisition="CACHE_ONLY",
            as_of_iso="2026-11-14T00:00:00Z",
            max_age_days=1,
        )
        self.assertEqual(expired["status"], "BLOCKED")
        self.assertEqual(expired["missing_reason"], "stale_or_post_cutoff_snapshot")

        # Post-cutoff receipt (retrieved_at after as_of) blocked
        post_cut = self.nasa.fetch_or_load(
            [17.65, 59.82],
            "2016-01-01",
            "2020-12-31",
            acquisition="CACHE_ONLY",
            as_of_iso="2020-01-01T00:00:00Z",
        )
        self.assertEqual(post_cut["status"], "BLOCKED")
        self.assertEqual(post_cut["missing_reason"], "stale_or_post_cutoff_snapshot")

        # Invalid calendar date rejected in QualityGate strict ISO validation & never accepted
        qa_bad_dt = self.gate.evaluate(
            {
                "location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
                "user_measurements": {"theta_fc": 0.31, "theta_wp": 0.14, "sampled_at": "2026-13-45"},
            },
            capabilities={"C1": {"status": "READY"}, "C4": {"status": "READY"}},
            evidence_objects=[
                {
                    "evidence_level": "USER_DECLARED_SCENARIO",
                    "parameter_path": "soil.theta_fc",
                    "retrieved_at": "2026-13-45T00:00:00Z",
                }
            ],
        )
        self.assertIn(qa_bad_dt["capability_verdicts"]["C4"]["verdict"], ("REJECTED", "UNDETERMINED", "DEGRADED_TO_DESCRIPTION"))
        self.assertTrue(qa_bad_dt["user_measurement_audit"]["downgraded_to_scenario"])

        # NASA -999 fill sentinel in live/fetched JSON rejected
        class _FillResp:
            status = 200
            def __init__(self) -> None:
                body = json.dumps({
                    "header": {"fill_value": -999.0, "api": {"version": "v2.10"}, "sources": ["MERRA2"]},
                    "geometry": {"coordinates": [9.21, 49.14, 150.0]},
                    "properties": {"parameter": {
                        "T2M_MIN": {"20240101": -999.0},
                        "T2M_MAX": {"20240101": 10.0},
                        "T2M": {"20240101": 5.0},
                        "PRECTOTCORR": {"20240101": 0.0},
                    }},
                }).encode("utf-8")
                self._bio = io.BytesIO(body)
            def read(self, n: int = -1) -> bytes:
                return self._bio.read(n)
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False

        with tempfile.TemporaryDirectory() as td:
            res_fill = NASAPowerAdapter(cache_dir=Path(td)).fetch_or_load(
                [9.21, 49.14], "2024-01-01", "2024-01-01", acquisition="LIVE_ALLOWED", urlopen_fn=lambda *a, **k: _FillResp()
            )
            self.assertEqual(res_fill["status"], "BLOCKED")
            self.assertEqual(res_fill["missing_reason"], "no_data")

    def test_6_corrupted_caches_fail_closed(self) -> None:
        # Tampered NASA raw JSON in isolated temp cache
        src_dir = ROOT / "adaptive_evidence" / "data" / "nasa_power_global_cache"
        rec_path = sorted(src_dir.glob("0dff6df*.receipt.json"))[0]
        rec = json.loads(rec_path.read_text(encoding="utf-8"))
        raw_path = src_dir / f"{rec['sha256']}.raw.json"

        with tempfile.TemporaryDirectory() as td:
            td_p = Path(td)
            shutil.copy2(rec_path, td_p / rec_path.name)
            shutil.copy2(raw_path, td_p / raw_path.name)
            valid_res = NASAPowerAdapter(cache_dir=td_p).fetch_or_load(
                [107.61, -6.91], "2016-01-01", "2020-12-31", acquisition="CACHE_ONLY"
            )
            self.assertEqual(valid_res["status"], "READY")

            # Corrupt raw cached JSON bytes -> structured BLOCKED failure
            (td_p / raw_path.name).write_bytes(raw_path.read_bytes() + b" ")
            tampered_res = NASAPowerAdapter(cache_dir=td_p).fetch_or_load(
                [107.61, -6.91], "2016-01-01", "2020-12-31", acquisition="CACHE_ONLY"
            )
            self.assertEqual(tampered_res["status"], "BLOCKED")
            self.assertEqual(tampered_res["missing_reason"], "corrupt_receipt_or_hash_mismatch")
            qa_tamper = self.gate.evaluate(
                {"location": {"point_lon_lat": [107.61, -6.91], "crs": "EPSG:4326"}},
                capabilities={"C1": {"status": "READY"}, "C2": {"status": "READY"}},
                evidence_objects=valid_res["evidence_objects"],
                trusted_nasa_dirs=[td_p],
            )
            self.assertEqual(qa_tamper["capability_verdicts"]["C2"]["verdict"], "REJECTED")

        # Corrupted GeoTIFF byte stream fails closed
        class _BadTiffResp:
            status = 200
            def __init__(self, body: bytes) -> None:
                self._bio = io.BytesIO(body)
            def read(self, n: int = -1) -> bytes:
                return self._bio.read(n)
            def getheaders(self):
                return []
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False

        with tempfile.TemporaryDirectory() as td:
            res_bad_tif = SoilGridsWCSAdapter(cache_dir=Path(td)).fetch_or_load(
                [9.8, 54.15],
                [(0, 5)],
                acquisition="LIVE_ALLOWED",
                urlopen_fn=lambda *a, **k: _BadTiffResp(_corrupt_geotiff_bytes()),
            )
            self.assertEqual(res_bad_tif["status"], "BLOCKED")

    def test_7_unsupported_crop_claims_and_non_planning_guardrails(self) -> None:
        resp = self.engine.evaluate(
            {
                "schema": "astragron.adaptive-evidence.request.v1",
                "request_id": "neg-unsupported-crop",
                "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
                "soil_depth_intervals_cm": [[0, 5]],
                "candidate_crops": ["dragonfruit_uncalibrated"],
                "water_supply_scenario": {"regime": "rainfed"},
            }
        )
        self.assertEqual(resp["capability_statuses"]["C6"], "BLOCKED")
        self.assertEqual(resp["capabilities"]["C6"]["missing_reason"], "unsupported_crop_profile")
        self.assertEqual(resp["capability_statuses"]["C7"], "BLOCKED")
        self.assertFalse(resp["scientific_guardrails"]["field_validated"])
        self.assertIsNone(resp["scientific_guardrails"]["marketable_yield"])
        self.assertIsNone(resp["scientific_guardrails"]["profit"])
        self.assertEqual(resp["capabilities"]["C10"]["status"], "BLOCKED")

        sens = self.sensitivity.analyze(
            {
                "location": {"site_id": "AU_WAGGA_REGION", "point_lon_lat": [147.35, -35.05], "crs": "EPSG:4326"},
                "soil_depth_intervals_cm": [[0, 5]],
                "candidate_crops": ["wheat", "chickpea"],
                "water_supply_scenario": {"regime": "rainfed"},
            }
        )
        self.assertEqual(sens["analysis_kind"], "REGIONAL_WATER_SCREENING_SENSITIVITY")
        self.assertFalse(sens["canonical_decision_sensitivity_executed"])
        self.assertIsNone(sens["economic_voi_usd"])
        self.assertFalse(sens["fabricated_voi"])

    def test_8_license_and_security_negative_gates(self) -> None:
        # FAO GAEZ disabled by default & rejects CC-BY-NC
        g_def = self.gaez.evaluate_suitability([17.65, 59.82], "wheat", "rainfed")
        self.assertEqual(g_def["status"], "BLOCKED")
        self.assertEqual(g_def["missing_reason"], "license_unverified")

        g_nc = self.gaez.evaluate_suitability(
            [17.65, 59.82],
            "wheat",
            "rainfed",
            verified_local_receipt={"gaez_version": "v4.0", "layer_id": "L1", "license": "CC-BY-NC-4.0", "suitability_index_0_100": 80.0},
        )
        self.assertEqual(g_nc["status"], "BLOCKED")
        self.assertEqual(g_nc["missing_reason"], "license_unverified")

        # Relabeling CC-BY data as Apache-2.0 or bundling secret fails compliance gate
        reg = build_external_data_rights_register()
        for row in reg:
            if "CC-BY" in row.get("declared_license", "").upper():
                bad_reg = [dict(r) for r in reg]
                idx = reg.index(row)
                bad_reg[idx]["is_osi_software_license"] = True
                res_relabel = evaluate_open_source_license_gate(data_register=bad_reg)
                self.assertFalse(res_relabel["OPEN_SOURCE_RELEASE_REVIEW_READY"])
                break

        with tempfile.TemporaryDirectory() as td:
            tp = Path(td)
            (tp / "leak.txt").write_text("token = ghp_" + ("a" * 36), encoding="utf-8")
            res_secret = evaluate_open_source_license_gate(scan_dirs=[tp])
            self.assertFalse(res_secret["OPEN_SOURCE_RELEASE_REVIEW_READY"])
            self.assertIn("BUNDLED_SECRET_OR_CREDENTIAL_DETECTED", [b["code"] for b in res_secret["blockers"]])


if __name__ == "__main__":
    unittest.main()
