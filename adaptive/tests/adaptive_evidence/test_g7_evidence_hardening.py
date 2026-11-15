"""Suite G7 — Independent Evidence Hardening, Provenance Chain, Temporal Validation,
Canonical Sensitivity Sequence Flip, and SoilGrids Safe Optimization Regression Tests.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import struct
import tempfile
import unittest
import urllib.error
import urllib.parse
from pathlib import Path
from unittest import mock

from adaptive_evidence.adapters.nasa_power import NASAPowerAdapter
from adaptive_evidence.adapters.soilgrids import SoilGridsWCSAdapter
from adaptive_evidence.quality_gate import (
    EvidenceQualityGate,
    validate_user_measurement_metadata,
)
from adaptive_evidence.sensitivity import CanonicalDecisionSensitivityRunner


_FAKE_SHA_D = "d" * 64


def _authentic_climate_ev() -> dict:
    res = NASAPowerAdapter().fetch_or_load([17.65, 59.82], "2016-01-01", "2020-12-31", acquisition="CACHE_ONLY")
    assert res.get("status") == "READY" and res.get("evidence_objects")
    return json.loads(json.dumps(res["evidence_objects"][0]))


def _authentic_soil_ev() -> dict:
    res = SoilGridsWCSAdapter().fetch_or_load([17.65, 59.82], [(0, 5)], acquisition="CACHE_ONLY")
    assert res.get("status") == "CONDITIONAL" and res.get("evidence_objects")
    return json.loads(json.dumps(res["evidence_objects"][0]))


def _derived_c4_ev(*, parent_raw_sha: str) -> dict:
    soil_parent = _authentic_soil_ev()
    return {
        "parameter_path": "soil_hydraulics.awc_mm_m",
        "provenance_class": "DERIVED_WITH_VALIDATED_METHOD",
        "evidence_level": "AUTHENTIC_VERIFIED_CACHE",
        "source_id": "SAXTON_RAWLS_2006_PTF",
        "provider": "ASTRAGRON_ADAPTIVE_EVIDENCE_ESTIMATORS",
        "product": "Saxton & Rawls (2006)",
        "version": "2006.1",
        "retrieved_at": soil_parent["retrieved_at"],
        "evidence_type": "DERIVED",
        "point_lon_lat": [17.65, 59.82],
        "crs": "EPSG:4326",
        "depth_interval_cm": (0.0, 5.0),
        "converted_si_value": 138.5,
        "quantiles": {"q05": 115.0, "q50": 138.5, "mean": 138.5, "q95": 155.0},
        "si_unit": "mm/m",
        "raw_source_sha256": parent_raw_sha,
        "receipt_sha256": hashlib.sha256(parent_raw_sha.encode("utf-8")).hexdigest(),
        "fixture_origin": "AUTHENTIC_CACHED_RECEIPT",
        "license": "CC-BY-4.0",
        "attribution": "Saxton & Rawls (2006)",
    }


def _synthetic_c5_ev() -> dict:
    return {
        "parameter_path": "suitability.wheat",
        "provenance_class": "USER_SCENARIO_ASSUMPTION",
        "evidence_level": "SYNTHETIC_TEST_FIXTURE",
        "source_id": "SYNTHETIC_OFFLINE_GAEZ_TEST",
        "provider": "Test Harness",
        "product": "Synthetic Control",
        "version": "1.0",
        "retrieved_at": "2026-10-15T12:00:00+00:00",
        "evidence_type": "DERIVED",
        "point_lon_lat": [17.65, 59.82],
        "crs": "EPSG:4326",
        "converted_si_value": 72.0,
        "si_unit": "index_0_100",
        "raw_source_sha256": _FAKE_SHA_D,
        "receipt_sha256": _FAKE_SHA_D,
        "fixture_origin": "SYNTHETIC_OFFLINE_CONTROL_FIXTURE",
        "license": "INTERNAL_SYNTHETIC_TEST_ONLY",
        "attribution": "Synthetic Test",
    }


def _build_1x1_epsg4326_tiff(lon: float, lat: float, pixel_val: int) -> bytes:
    scale = 0.002
    px_bytes = struct.pack("<h", int(pixel_val))
    header = bytearray(b"II\x2a\x00\x08\x00\x00\x00")
    ps_bytes = struct.pack("<3d", scale, scale, 0.0)
    tp_bytes = struct.pack("<6d", 0.0, 0.0, 0.0, lon - scale * 0.5, lat + scale * 0.5, 0.0)
    gkeys = struct.pack("<12H", 1, 1, 0, 2, 1024, 0, 1, 2, 2048, 0, 1, 4326)
    nodata_b = b"-32768\x00"
    entries_spec = [
        (256, 4, 1, 1, None),
        (257, 4, 1, 1, None),
        (258, 3, 1, 16, None),
        (259, 3, 1, 1, None),
        (273, 4, 1, 0, b"STRIP"),
        (277, 3, 1, 1, None),
        (278, 4, 1, 1, None),
        (279, 4, 1, len(px_bytes), None),
        (339, 3, 1, 2, None),
        (33550, 12, 3, 0, ps_bytes),
        (33922, 12, 6, 0, tp_bytes),
        (34735, 3, len(gkeys) // 2, 0, gkeys),
        (42113, 2, len(nodata_b), 0, nodata_b),
    ]
    ifd_start = 8
    ifd_len = 2 + 12 * len(entries_spec) + 4
    cursor = ifd_start + ifd_len
    buf = bytearray(header + b"\x00" * ifd_len)
    strip_off = cursor
    buf.extend(px_bytes)
    cursor += len(px_bytes)
    struct.pack_into("<H", buf, ifd_start, len(entries_spec))
    for idx, (tag, ftype, cnt, imm, ext) in enumerate(entries_spec):
        pos = ifd_start + 2 + idx * 12
        if ext == b"STRIP":
            val = strip_off
        elif ext is not None:
            val = cursor
            buf.extend(ext)
            cursor += len(ext)
        else:
            val = imm
        struct.pack_into("<HHII", buf, pos, tag, ftype, cnt, val)
    struct.pack_into("<I", buf, ifd_start + 2 + len(entries_spec) * 12, 0)
    return bytes(buf)


class _SimpleHttpResp:
    def __init__(self, body: bytes) -> None:
        self.status = 200
        self.headers = {"Content-Type": "image/tiff", "Content-Length": str(len(body))}
        self._bio = io.BytesIO(body)

    def read(self, n: int = -1) -> bytes:
        return self._bio.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class TestG7EvidenceHardening(unittest.TestCase):
    def test_synthetic_c5_does_not_pollute_authentic_c2_and_refuses_claim(self) -> None:
        gate = EvidenceQualityGate()
        req = {
            "location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "water_supply_scenario": {"regime": "rainfed"},
        }
        caps = {
            "C1": {"status": "READY"},
            "C2": {"status": "READY"},
            "C3": {"status": "BLOCKED", "missing_reason": "no_data"},
            "C4": {"status": "BLOCKED", "missing_reason": "no_data"},
            "C5": {"status": "READY"},
            "C6": {"status": "BLOCKED", "missing_reason": "no_data"},
            "C7": {"status": "BLOCKED", "missing_reason": "no_data"},
        }
        verdict = gate.evaluate(
            req,
            capabilities=caps,
            evidence_objects=[_authentic_climate_ev(), _synthetic_c5_ev()],
        )
        cv = verdict["capability_verdicts"]
        self.assertEqual(cv["C2"]["verdict"], "ACCEPTED_FOR_CLAIM")
        self.assertEqual(cv["C5"]["verdict"], "DEGRADED_TO_DESCRIPTION")
        self.assertIn("SYNTHETIC_FIXTURE_DETECTED", cv["C5"]["reason_codes"])

    def test_spoofed_self_claimed_authentic_receipt_with_synthetic_source_or_missing_hash_rejected(self) -> None:
        gate = EvidenceQualityGate()
        spoofed_ev = _authentic_climate_ev()
        spoofed_ev["source_id"] = "SYNTHETIC_SPOOF_POWER"
        spoofed_ev["raw_source_sha256"] = "not-a-valid-sha256"

        mismatched_level_ev = _authentic_climate_ev()
        mismatched_level_ev["provenance_class"] = "USER_SCENARIO_ASSUMPTION"
        mismatched_level_ev["fixture_origin"] = "USER_DECLARED_SCENARIO_INPUT"
        # Claims AUTHENTIC_VERIFIED_CACHE while provenance says USER_SCENARIO_ASSUMPTION
        mismatched_level_ev["evidence_level"] = "AUTHENTIC_VERIFIED_CACHE"

        req = {"location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"}}
        caps = {"C1": {"status": "READY"}, "C2": {"status": "READY"}}
        for bad_ev in (spoofed_ev, mismatched_level_ev):
            res = gate.evaluate(req, capabilities=caps, evidence_objects=[bad_ev])
            c2_v = res["capability_verdicts"]["C2"]["verdict"]
            self.assertNotIn(c2_v, ("ACCEPTED_FOR_CLAIM", "ACCEPTED_CONDITIONALLY"))

    def test_c4_derived_parent_sha_must_link_to_authentic_c3_receipt(self) -> None:
        gate = EvidenceQualityGate()
        req = {
            "location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "water_supply_scenario": {"regime": "rainfed"},
        }
        caps = {
            "C1": {"status": "READY"},
            "C2": {"status": "READY"},
            "C3": {"status": "CONDITIONAL"},
            "C4": {"status": "CONDITIONAL"},
            "C6": {"status": "CONDITIONAL"},
            "C7": {"status": "CONDITIONAL"},
        }
        soil_ev = _authentic_soil_ev()
        linked_parent_sha = hashlib.sha256(json.dumps([soil_ev], sort_keys=True).encode("utf-8")).hexdigest()

        # Disconnected parent hash -> C4 rejected & C6/C7 rejected downstream
        bad = gate.evaluate(
            req,
            capabilities=caps,
            evidence_objects=[
                _authentic_climate_ev(),
                soil_ev,
                _derived_c4_ev(parent_raw_sha=_FAKE_SHA_D),
            ],
        )
        self.assertEqual(bad["capability_verdicts"]["C4"]["verdict"], "REJECTED")
        self.assertIn("DISCONNECTED_OR_UNVERIFIED_PARENT", bad["capability_verdicts"]["C4"]["reason_codes"])
        self.assertEqual(bad["capability_verdicts"]["C6"]["verdict"], "REJECTED")
        self.assertEqual(bad["capability_verdicts"]["C7"]["verdict"], "REJECTED")

        # Connected parent hash -> C4, C6, C7 admitted strictly conditionally
        good = gate.evaluate(
            req,
            capabilities=caps,
            evidence_objects=[
                _authentic_climate_ev(),
                soil_ev,
                _derived_c4_ev(parent_raw_sha=linked_parent_sha),
            ],
        )
        self.assertEqual(good["capability_verdicts"]["C4"]["verdict"], "ACCEPTED_CONDITIONALLY")
        self.assertEqual(good["capability_verdicts"]["C6"]["verdict"], "ACCEPTED_CONDITIONALLY")
        self.assertEqual(good["capability_verdicts"]["C7"]["verdict"], "ACCEPTED_CONDITIONALLY")

    def test_dependency_graph_refuses_ready_c6_c7_when_upstream_c2_or_c4_unverified(self) -> None:
        gate = EvidenceQualityGate()
        req = {
            "location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "water_supply_scenario": {"regime": "rainfed"},
        }
        caps = {
            "C1": {"status": "READY"},
            "C2": {"status": "READY"},  # no C2 evidence object supplied -> UNDETERMINED
            "C3": {"status": "CONDITIONAL"},
            "C4": {"status": "READY"},  # no C4 evidence object supplied -> UNDETERMINED
            "C6": {"status": "READY"},
            "C7": {"status": "READY"},
        }
        res = gate.evaluate(req, capabilities=caps, evidence_objects=[_authentic_soil_ev()])
        cv = res["capability_verdicts"]
        self.assertEqual(cv["C2"]["verdict"], "UNDETERMINED")
        self.assertEqual(cv["C4"]["verdict"], "UNDETERMINED")
        self.assertEqual(cv["C6"]["verdict"], "UNDETERMINED")
        self.assertEqual(cv["C7"]["verdict"], "UNDETERMINED")

    def test_strict_iso_temporal_validation_and_user_declared_scenario_distinction(self) -> None:
        invalid_payloads = [
            {"sampled_at": "2026-02-30", "available_at": "2026-03-01", "method": "ISO 11274", "lab_name": "Eurofins", "depth_interval_cm": [0, 30]},
            {"sampled_at": "2026-13-01", "available_at": "2026-13-02", "method": "ISO 11274", "lab_name": "Eurofins", "depth_interval_cm": [0, 30]},
            {"sampled_at": "2026-06-01T12:00+25:00", "available_at": "2026-06-02T12:00+00:00", "method": "ISO 11274", "lab_name": "Eurofins", "depth_interval_cm": [0, 30]},
            {"sampled_at": "2099-01-01", "available_at": "2099-01-02", "method": "ISO 11274", "lab_name": "Eurofins", "depth_interval_cm": [0, 30]},
            {"sampled_at": "2026-10-05", "available_at": "2026-10-01", "method": "ISO 11274", "lab_name": "Eurofins", "depth_interval_cm": [0, 30]},
            {"sampled_at": "2026-10-01", "available_at": "2026-10-02", "method": "N/A", "lab_name": "Eurofins", "depth_interval_cm": [0, 30]},
            {"sampled_at": "2026-10-01", "available_at": "2026-10-02", "method": "ISO 11274", "lab_name": "Eurofins", "depth_interval_cm": [30, 10]},
        ]
        for payload in invalid_payloads:
            chk = validate_user_measurement_metadata(payload, as_of_iso="2026-11-14")
            self.assertFalse(chk["verified"], msg=f"Expected invalid metadata rejection for {payload}")

        valid_past = validate_user_measurement_metadata(
            {
                "sampled_at": "2026-10-01",
                "available_at": "2026-10-02",
                "method": "ISO 11274",
                "lab_name": "Eurofins Agro",
                "depth_interval_cm": [0, 30],
            },
            as_of_iso="2026-11-14",
        )
        self.assertTrue(valid_past["verified"])
        self.assertEqual(valid_past["provenance_class"], "USER_SCENARIO_ASSUMPTION")
        self.assertEqual(valid_past["evidence_level"], "USER_DECLARED_SCENARIO")
        self.assertFalse(valid_past["independent_lab_authenticity_verified"])

    def test_canonical_sensitivity_detects_sequence_change_with_identical_ids(self) -> None:
        class _SeqFlipStubService:
            def run(self, req: dict, use_cache: bool = False) -> dict:
                rf = float(req["engine_request"]["scenarios"][0]["rain_factor"])
                seq_p1 = ["wheat"] if rf >= 0.8 else ["maize"]
                return {
                    "status": "CONDITIONAL_RESEARCH_COMPLETE",
                    "decision": {
                        "status": "OK",
                        "selected_ids": ["P1", "P2"],
                        "service_compliant_ids": ["P1", "P2"],
                    },
                    "alternatives": [
                        {"policy_id": "P1", "choices": seq_p1, "scenarios": [{"status": "FEASIBLE", "ET_shortfall_m3_equivalent": 100.0}]},
                        {"policy_id": "P2", "choices": ["barley"], "scenarios": [{"status": "FEASIBLE", "ET_shortfall_m3_equivalent": 120.0}]},
                    ],
                }

        runner = CanonicalDecisionSensitivityRunner(client_service=_SeqFlipStubService())
        base_req = {
            "engine_request": {
                "scenarios": [{"rain_factor": 1.0}],
                "fields": [{"area_ha": 2.0, "soil": {"theta_wp": 0.12, "theta_fc": 0.28, "initial_available_fraction": 0.5}}],
                "supply": {"annual_farm_source_m3": 1500.0},
            }
        }
        out = runner.run(
            base_req,
            scenarios=[
                {"scenario_id": "REF", "rain_factor": 1.0},
                {"scenario_id": "DRY", "rain_factor": 0.5},
            ],
        )
        self.assertEqual(out["canonical_stability_status"], "CHANGED_WITHIN_TESTED_SCENARIOS")
        self.assertEqual(out["flip_witness_count"], 1)
        w = out["flip_witnesses"][0]
        self.assertTrue(w["selected_sequences_changed"])
        self.assertEqual(w["reference_selected_sequences"]["P1"], ["wheat"])
        self.assertEqual(w["perturbed_selected_sequences"]["P1"], ["maize"])

    def test_soilgrids_preflight_urban_mask_fast_fails_within_three_requests(self) -> None:
        calls = []

        def _zero_tiff_open(req, timeout=20.0):
            calls.append(req.full_url)
            return _SimpleHttpResp(_build_1x1_epsg4326_tiff(9.22, 49.14, 0))

        with tempfile.TemporaryDirectory() as td:
            adapter = SoilGridsWCSAdapter(cache_dir=Path(td))
            res = adapter.fetch_or_load(
                [9.22, 49.14],
                [(0, 30)],
                acquisition="LIVE_ALLOWED",
                urlopen_fn=_zero_tiff_open,
            )
        self.assertEqual(res["status"], "BLOCKED")
        self.assertEqual(res["missing_reason"], "point_pixel_missing")
        self.assertLessEqual(len(calls), 3)

    def test_soilgrids_partial_outage_persists_completed_layers_and_reuses_on_overlap(self) -> None:
        raw_vals = {"clay": 260, "silt": 410, "sand": 330, "bdod": 135, "cfvo": 40, "soc": 180, "phh2o": 68}
        fail_15_30 = True
        calls = []

        def _layer_open(req, timeout=20.0):
            calls.append(req.full_url)
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(req.full_url).query)
            cov_id = qs["COVERAGEID"][0]
            prop, depth_lbl, _stat = cov_id.split("_")
            if fail_15_30 and depth_lbl == "15-30cm":
                raise urllib.error.HTTPError(req.full_url, 503, "Simulated partial outage", {}, None)
            return _SimpleHttpResp(_build_1x1_epsg4326_tiff(9.15, 49.18, raw_vals[prop]))

        with tempfile.TemporaryDirectory() as td:
            adapter = SoilGridsWCSAdapter(cache_dir=Path(td))
            # Outage on layer 3 (15-30cm) fails closed WITHOUT substituting shallower layers
            blocked = adapter.fetch_or_load(
                [9.15, 49.18],
                [(0, 30)],
                acquisition="LIVE_ALLOWED",
                urlopen_fn=_layer_open,
            )
            self.assertEqual(blocked["status"], "BLOCKED")
            self.assertEqual(blocked["missing_reason"], "source_outage")

            # Layers 0-5cm and 5-15cm were atomically cached before outage -> 0 HTTP calls for (0, 15)!
            calls.clear()
            fail_15_30 = False
            reused = adapter.fetch_or_load(
                [9.15, 49.18],
                [(0, 15)],
                acquisition="CACHE_ONLY",
                urlopen_fn=_layer_open,
            )
            self.assertEqual(reused["status"], "CONDITIONAL")
            self.assertEqual(len(calls), 0)
            self.assertEqual(reused["diagnostics"]["request_telemetry"]["cache_hit_count"], 2)

            # Now fetching (0, 30) only fetches missing 15-30cm (28 calls instead of 84)
            res_full = adapter.fetch_or_load(
                [9.15, 49.18],
                [(0, 30)],
                acquisition="LIVE_ALLOWED",
                urlopen_fn=_layer_open,
            )
            self.assertEqual(res_full["status"], "CONDITIONAL")
            self.assertEqual(len(calls), 28)
            self.assertEqual(res_full["diagnostics"]["request_telemetry"]["cache_hit_count"], 2)

    def test_soilgrids_cache_hash_tamper_rejected(self) -> None:
        raw_vals = {"clay": 260, "silt": 410, "sand": 330, "bdod": 135, "cfvo": 40, "soc": 180, "phh2o": 68}

        def _ok_open(req, timeout=20.0):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(req.full_url).query)
            prop = qs["COVERAGEID"][0].split("_")[0]
            return _SimpleHttpResp(_build_1x1_epsg4326_tiff(9.15, 49.18, raw_vals[prop]))

        with tempfile.TemporaryDirectory() as td:
            adapter = SoilGridsWCSAdapter(cache_dir=Path(td))
            ok_res = adapter.fetch_or_load([9.15, 49.18], [(0, 5)], acquisition="LIVE_ALLOWED", urlopen_fn=_ok_open)
            self.assertEqual(ok_res["status"], "CONDITIONAL")

            key = adapter._cache_key(9.15, 49.18, "0-5cm")
            rpath = Path(td) / f"{key}.receipt.json"
            rec = json.loads(rpath.read_text(encoding="utf-8"))
            rec["properties"]["clay"]["mean"] = 999
            rpath.write_text(json.dumps(rec), encoding="utf-8")

            tampered = adapter.fetch_or_load([9.15, 49.18], [(0, 5)], acquisition="CACHE_ONLY")
            self.assertEqual(tampered["status"], "BLOCKED")
            self.assertEqual(tampered["missing_reason"], "corrupt_receipt_or_hash_mismatch")

    def test_soilgrids_default_retains_all_seven_properties_while_explicit_subset_works(self) -> None:
        raw_vals = {"clay": 260, "silt": 410, "sand": 330, "bdod": 135, "cfvo": 40, "soc": 180, "phh2o": 68}

        def _ok_open(req, timeout=20.0):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(req.full_url).query)
            prop = qs["COVERAGEID"][0].split("_")[0]
            return _SimpleHttpResp(_build_1x1_epsg4326_tiff(9.15, 49.18, raw_vals[prop]))

        with tempfile.TemporaryDirectory() as td:
            adapter_sub = SoilGridsWCSAdapter(cache_dir=Path(td) / "sub")
            sub = adapter_sub.fetch_or_load(
                [9.15, 49.18],
                [(0, 5)],
                acquisition="LIVE_ALLOWED",
                properties=("clay", "silt", "sand", "soc"),
                urlopen_fn=_ok_open,
            )
            self.assertEqual(sub["status"], "CONDITIONAL")
            self.assertEqual(set(sub["diagnostics"]["properties_si"].keys()), {"clay", "silt", "sand", "soc"})
            self.assertEqual(sub["diagnostics"]["request_telemetry"]["request_count"], 16)

            adapter_def = SoilGridsWCSAdapter(cache_dir=Path(td) / "def")
            full = adapter_def.fetch_or_load(
                [9.15, 49.18],
                [(0, 5)],
                acquisition="LIVE_ALLOWED",
                urlopen_fn=_ok_open,
            )
            self.assertEqual(full["status"], "CONDITIONAL")
            self.assertEqual(
                set(full["diagnostics"]["properties_si"].keys()),
                {"clay", "silt", "sand", "bdod", "cfvo", "soc", "phh2o"},
            )
            self.assertEqual(full["diagnostics"]["request_telemetry"]["request_count"], 28)


if __name__ == "__main__":
    unittest.main()
