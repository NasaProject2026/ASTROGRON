"""Suite G8 — Receipt & Source-Proof Trust Boundary, Tamper Resistance, and License Report LF Reproducibility."""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import struct
import tempfile
import unittest
import urllib.parse
import zlib
from pathlib import Path
from unittest import mock

from adaptive_evidence.adapters.nasa_power import NASAPowerAdapter
from adaptive_evidence.adapters.soilgrids import SoilGridsWCSAdapter
from adaptive_evidence.engine import AdaptiveEvidenceEngine
from adaptive_evidence.license_gate import ROOT, write_security_and_rights_reports
from adaptive_evidence.quality_gate import EvidenceQualityGate


def _build_1x1_tiff(lon: float, lat: float, raw_i16: int) -> bytes:
    """Build a minimal valid 1x1 int16 EPSG:4326 GeoTIFF matching SoilGrids WCS responses."""
    raw_strip = struct.pack("<h", int(raw_i16))
    compressed = zlib.compress(raw_strip)
    ifd_offset = 8
    num_entries = 9
    ifd_size = 2 + num_entries * 12 + 4
    data_offset = ifd_offset + ifd_size
    pixel_scale_off = data_offset
    tiepoint_off = pixel_scale_off + 24
    strip_off = tiepoint_off + 48
    entries = [
        (256, 4, 1, 1),
        (257, 4, 1, 1),
        (258, 3, 1, 16),
        (259, 3, 1, 8),
        (273, 4, 1, strip_off),
        (277, 3, 1, 1),
        (278, 4, 1, 1),
        (279, 4, 1, len(compressed)),
        (339, 3, 1, 2),
        (33550, 12, 3, pixel_scale_off),
        (33922, 12, 6, tiepoint_off),
    ]
    header = b"II" + struct.pack("<HI", 42, ifd_offset)
    ifd_size = 2 + len(entries) * 12 + 4
    data_offset = ifd_offset + ifd_size
    pixel_scale_off = data_offset
    tiepoint_off = pixel_scale_off + 24
    strip_off = tiepoint_off + 48
    fixed_entries = []
    for tag, typ, cnt, val in entries:
        if tag == 273:
            val = strip_off
        elif tag == 33550:
            val = pixel_scale_off
        elif tag == 33922:
            val = tiepoint_off
        fixed_entries.append(struct.pack("<HHII", tag, typ, cnt, val))
    ifd = struct.pack("<H", len(fixed_entries)) + b"".join(fixed_entries) + struct.pack("<I", 0)
    scales = struct.pack("<ddd", 0.002, 0.002, 0.0)
    tiepoints = struct.pack("<dddddd", 0.0, 0.0, 0.0, float(lon) - 0.001, float(lat) + 0.001, 0.0)
    return header + ifd + scales + tiepoints + compressed


class _HttpResp:
    def __init__(self, body: bytes) -> None:
        self._buf = io.BytesIO(body)
        self.status = 200
        self.headers = {"Content-Type": "application/octet-stream"}

    def read(self, n: int = -1) -> bytes:
        return self._buf.read(n)

    def getheaders(self):
        return list(self.headers.items())

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class TestG8ReceiptTrustBoundary(unittest.TestCase):
    def test_unbacked_sha_with_caller_verified_flag_and_traversal_paths_rejected(self) -> None:
        req = {
            "location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "water_supply_scenario": {"regime": "rainfed"},
        }
        caps = {
            "C1": {"status": "READY"},
            "C2": {"status": "READY"},
            "C3": {"status": "BLOCKED", "missing_reason": "no_data"},
            "C4": {"status": "BLOCKED", "missing_reason": "no_data"},
            "C6": {"status": "READY"},
            "C7": {"status": "READY"},
        }
        forged = {
            "parameter_path": "climate.PRECTOTCORR",
            "provenance_class": "OBSERVED_OR_AUTHENTIC_SOURCE",
            "evidence_level": "AUTHENTIC_VERIFIED_CACHE",
            "source_id": "NASA_POWER_MERRA2_DAILY_UTC",
            "provider": "NASA Langley Research Center POWER Project",
            "product": "MERRA-2 Assimilated Daily Meteorology (AG Community)",
            "variable": "PRECTOTCORR",
            "version": "v2.10.3",
            "retrieved_at": "2026-11-06T21:03:33.648665+00:00",
            "valid_period": ("2016-01-01", "2020-12-31"),
            "evidence_type": "MODELLED",
            "point_lon_lat": [17.65, 59.82],
            "crs": "EPSG:4326",
            "converted_si_value": 630.77,
            "si_unit": "mm/year",
            "raw_source_sha256": "a" * 64,
            "receipt_sha256": "b" * 64,
            "fixture_origin": "AUTHENTIC_CACHED_RECEIPT",
            "license": "NASA_POWER_PUBLIC_DATA_WITH_ATTRIBUTION",
            "attribution": "NASA POWER Project",
            "verified": True,
            "is_authentic_source": True,
            "receipt_path": "../../docs/adaptive_evidence/GATES.json",
            "access_path": "https://attacker.invalid/forged_power.json",
        }
        qa = EvidenceQualityGate().evaluate(req, capabilities=caps, evidence_objects=[forged])
        cv = qa["capability_verdicts"]
        self.assertEqual(cv["C2"]["verdict"], "UNDETERMINED")
        self.assertIn("UNVERIFIED_SOURCE_PROOF", cv["C2"]["reason_codes"])
        self.assertNotIn("AUTHENTIC_VERIFIED_CACHE", qa["evidence_levels_observed"])
        self.assertNotIn("AUTHENTIC_LIVE", qa["evidence_levels_observed"])
        self.assertIn("SOURCE_CLAIMED_BUT_UNVERIFIED", qa["provenance_trust_summary"]["tiers_observed"])
        self.assertFalse(qa["provenance_trust_summary"]["external_url_fetch_during_gate"])
        self.assertEqual(cv["C6"]["verdict"], "UNDETERMINED")
        self.assertEqual(cv["C7"]["verdict"], "UNDETERMINED")

    def test_verified_nasa_cache_passes_and_tampers_or_mismatches_fail_closed(self) -> None:
        c2 = NASAPowerAdapter().fetch_or_load([17.65, 59.82], "2016-01-01", "2020-12-31", acquisition="CACHE_ONLY")
        self.assertEqual(c2["status"], "READY")
        real_evs = c2["evidence_objects"]
        req = {
            "location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"},
            "water_supply_scenario": {"regime": "rainfed"},
        }
        caps = {"C1": {"status": "READY"}, "C2": {"status": "READY"}}
        ok_qa = EvidenceQualityGate().evaluate(req, capabilities=caps, evidence_objects=real_evs)
        self.assertEqual(ok_qa["capability_verdicts"]["C2"]["verdict"], "ACCEPTED_FOR_CLAIM")
        ver_recs = ok_qa["provenance_trust_summary"]["evidence_verifications"]
        self.assertTrue(all(r["proof_tier"] == "AUTHENTIC_VERIFIED_RAW_SOURCE" for r in ver_recs))
        self.assertTrue(all(r["raw_bytes_verified"] for r in ver_recs))
        self.assertTrue(all(r["upstream_cryptographic_authenticity_proven"] is False for r in ver_recs))

        # 1. Wrong coordinates paired with genuine hashes -> REJECTED
        wrong_pt = json.loads(json.dumps(real_evs))
        wrong_pt[0]["point_lon_lat"] = [31.23, 30.04]
        qa_pt = EvidenceQualityGate().evaluate(
            {"location": {"point_lon_lat": [31.23, 30.04], "crs": "EPSG:4326"}},
            capabilities=caps,
            evidence_objects=wrong_pt,
        )
        self.assertEqual(qa_pt["capability_verdicts"]["C2"]["verdict"], "REJECTED")

        # 2. Wrong valid_period or spoofed SI value -> REJECTED
        wrong_val = json.loads(json.dumps(real_evs))
        wrong_val[0]["converted_si_value"] = 9999.0
        qa_val = EvidenceQualityGate().evaluate(req, capabilities=caps, evidence_objects=wrong_val)
        self.assertEqual(qa_val["capability_verdicts"]["C2"]["verdict"], "REJECTED")

        wrong_dates = json.loads(json.dumps(real_evs))
        wrong_dates[0]["valid_period"] = ["2010-01-01", "2015-12-31"]
        qa_dates = EvidenceQualityGate().evaluate(req, capabilities=caps, evidence_objects=wrong_dates)
        self.assertEqual(qa_dates["capability_verdicts"]["C2"]["verdict"], "REJECTED")

        # 3. Cached artifact claiming AUTHENTIC_LIVE without in-process live attestation -> REJECTED
        spoof_live = json.loads(json.dumps(real_evs))
        spoof_live[0]["evidence_level"] = "AUTHENTIC_LIVE"
        spoof_live[0]["fixture_origin"] = "AUTHENTIC_LIVE_FETCH_RECEIPT"
        qa_live = EvidenceQualityGate().evaluate(req, capabilities=caps, evidence_objects=spoof_live)
        self.assertEqual(qa_live["capability_verdicts"]["C2"]["verdict"], "REJECTED")

        # 4. Tampered raw JSON bytes inside isolated store -> REJECTED
        with tempfile.TemporaryDirectory() as td:
            src_dir = ROOT / "adaptive_evidence" / "data" / "nasa_power_global_cache"
            bd_rec_path = sorted(src_dir.glob("0dff6df*.receipt.json"))[0]
            bd_rec = json.loads(bd_rec_path.read_text(encoding="utf-8"))
            bd_raw_path = src_dir / f"{bd_rec['sha256']}.raw.json"

            td_p = Path(td)
            shutil.copy2(bd_rec_path, td_p / bd_rec_path.name)
            shutil.copy2(bd_raw_path, td_p / bd_raw_path.name)

            # Build real evidence objects from authentic uncorrupted Bandung cache
            bd_res = NASAPowerAdapter(cache_dir=td_p).fetch_or_load(
                [107.61, -6.91], "2016-01-01", "2020-12-31", acquisition="CACHE_ONLY"
            )
            self.assertEqual(bd_res["status"], "READY")

            # Tamper raw JSON bytes on disk while keeping old receipt SHAs on evidence dict
            (td_p / bd_raw_path.name).write_bytes(bd_raw_path.read_bytes() + b" ")
            qa_tampered = EvidenceQualityGate().evaluate(
                {"location": {"point_lon_lat": [107.61, -6.91], "crs": "EPSG:4326"}},
                capabilities={"C1": {"status": "READY"}, "C2": {"status": "READY"}},
                evidence_objects=bd_res["evidence_objects"],
                trusted_nasa_dirs=[td_p],
            )
            self.assertEqual(qa_tampered["capability_verdicts"]["C2"]["verdict"], "REJECTED")

    def test_soilgrids_extract_integrity_vs_live_geotiff_and_mismatch_rejection(self) -> None:
        # 1. Offline SoilGrids cache passes as LOCALLY_INTEGRITY_VERIFIED_CACHE_EXTRACT (raw_bytes_verified=False)
        sg_offline = SoilGridsWCSAdapter().fetch_or_load([17.65, 59.82], [(0, 5)], acquisition="CACHE_ONLY")
        self.assertEqual(sg_offline["status"], "CONDITIONAL")
        req = {"location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"}}
        caps = {"C1": {"status": "READY"}, "C3": {"status": "CONDITIONAL"}}
        qa_off = EvidenceQualityGate().evaluate(req, capabilities=caps, evidence_objects=sg_offline["evidence_objects"])
        self.assertEqual(qa_off["capability_verdicts"]["C3"]["verdict"], "ACCEPTED_CONDITIONALLY")
        self.assertIn(
            "LOCALLY_INTEGRITY_VERIFIED_CACHE_EXTRACT",
            qa_off["provenance_trust_summary"]["tiers_observed"],
        )
        sg_recs = qa_off["provenance_trust_summary"]["evidence_verifications"]
        self.assertTrue(all(r["captured_extract_integrity_verified"] for r in sg_recs))
        self.assertTrue(all(r["raw_bytes_verified"] is False for r in sg_recs))

        # 2. Mutating offline SoilGrids extract to AUTHENTIC_LIVE without live GeoTIFF decode -> REJECTED
        spoof_sg_live = json.loads(json.dumps(sg_offline["evidence_objects"]))
        spoof_sg_live[0]["evidence_level"] = "AUTHENTIC_LIVE"
        spoof_sg_live[0]["fixture_origin"] = "AUTHENTIC_LIVE_FETCH_RECEIPT"
        qa_sg_spoof = EvidenceQualityGate().evaluate(req, capabilities=caps, evidence_objects=spoof_sg_live)
        self.assertEqual(qa_sg_spoof["capability_verdicts"]["C3"]["verdict"], "REJECTED")

        # 3. Mutating SoilGrids depth interval or converted value -> REJECTED / UNDETERMINED
        bad_val = json.loads(json.dumps(sg_offline["evidence_objects"]))
        bad_val[0]["converted_si_value"] = 99.0
        qa_bad_val = EvidenceQualityGate().evaluate(req, capabilities=caps, evidence_objects=bad_val)
        self.assertEqual(qa_bad_val["capability_verdicts"]["C3"]["verdict"], "REJECTED")

        bad_depth = json.loads(json.dumps(sg_offline["evidence_objects"]))
        bad_depth[0]["depth_interval_cm"] = [15.0, 30.0]
        qa_bad_depth = EvidenceQualityGate().evaluate(req, capabilities=caps, evidence_objects=bad_depth)
        self.assertEqual(qa_bad_depth["capability_verdicts"]["C3"]["verdict"], "UNDETERMINED")

        # 4. In-process live GeoTIFF decode earns AUTHENTIC_VERIFIED_RAW_SOURCE (raw_bytes_verified=True)
        raw_vals = {"clay": 260, "silt": 410, "sand": 330, "bdod": 135, "cfvo": 40, "soc": 180, "phh2o": 68}

        def _wcs_open(req_obj, timeout=20.0):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(req_obj.full_url).query)
            prop = qs["COVERAGEID"][0].split("_")[0]
            return _HttpResp(_build_1x1_tiff(8.5, 47.4, raw_vals[prop]))

        with tempfile.TemporaryDirectory() as td:
            sg_live_adp = SoilGridsWCSAdapter(cache_dir=Path(td))
            sg_live = sg_live_adp.fetch_or_load([8.5, 47.4], [(0, 5)], acquisition="LIVE_ALLOWED", urlopen_fn=_wcs_open)
            self.assertEqual(sg_live["status"], "CONDITIONAL")
            qa_live = EvidenceQualityGate().evaluate(
                {"location": {"point_lon_lat": [8.5, 47.4], "crs": "EPSG:4326"}},
                capabilities=caps,
                evidence_objects=sg_live["evidence_objects"],
                trusted_soilgrids_dirs=[Path(td)],
            )
            self.assertEqual(qa_live["capability_verdicts"]["C3"]["verdict"], "ACCEPTED_CONDITIONALLY")
            self.assertIn(
                "AUTHENTIC_VERIFIED_RAW_SOURCE",
                qa_live["provenance_trust_summary"]["tiers_observed"],
            )
            self.assertTrue(
                all(r["raw_bytes_verified"] for r in qa_live["provenance_trust_summary"]["evidence_verifications"])
            )

    def test_unverified_c5_does_not_taint_verified_c2_and_c3(self) -> None:
        c2 = NASAPowerAdapter().fetch_or_load([17.65, 59.82], "2016-01-01", "2020-12-31", acquisition="CACHE_ONLY")
        c3 = SoilGridsWCSAdapter().fetch_or_load([17.65, 59.82], [(0, 5)], acquisition="CACHE_ONLY")
        unverified_c5 = {
            "parameter_path": "suitability.fao_gaez",
            "provenance_class": "OBSERVED_OR_AUTHENTIC_SOURCE",
            "evidence_level": "AUTHENTIC_VERIFIED_CACHE",
            "source_id": "FAO_GAEZ_V4_CLAIMED",
            "provider": "FAO",
            "product": "GAEZ v4",
            "version": "v4.0",
            "retrieved_at": "2026-11-08T12:00:00+00:00",
            "evidence_type": "MODELLED",
            "point_lon_lat": [17.65, 59.82],
            "crs": "EPSG:4326",
            "converted_si_value": 78.0,
            "si_unit": "index_0_100",
            "raw_source_sha256": "e" * 64,
            "receipt_sha256": "f" * 64,
            "fixture_origin": "AUTHENTIC_CACHED_RECEIPT",
            "license": "CC-BY-4.0",
            "attribution": "FAO/IIASA",
        }
        qa = EvidenceQualityGate().evaluate(
            {"location": {"point_lon_lat": [17.65, 59.82], "crs": "EPSG:4326"}},
            capabilities={
                "C1": {"status": "READY"},
                "C2": {"status": "READY"},
                "C3": {"status": "CONDITIONAL"},
                "C5": {"status": "READY"},
            },
            evidence_objects=list(c2["evidence_objects"]) + list(c3["evidence_objects"]) + [unverified_c5],
        )
        self.assertEqual(qa["capability_verdicts"]["C2"]["verdict"], "ACCEPTED_FOR_CLAIM")
        self.assertEqual(qa["capability_verdicts"]["C3"]["verdict"], "ACCEPTED_CONDITIONALLY")
        self.assertEqual(qa["capability_verdicts"]["C5"]["verdict"], "UNDETERMINED")

    def test_license_gate_reports_are_lf_and_byte_stable_across_runs(self) -> None:
        docs_dir = ROOT / "docs" / "adaptive_evidence"
        reg_p = docs_dir / "LICENSE_AND_PROVENANCE_REGISTER.json"
        sec_p = docs_dir / "SECURITY_AND_RIGHTS_CHECK.json"
        write_security_and_rights_reports()
        b1_reg = reg_p.read_bytes()
        b1_sec = sec_p.read_bytes()
        self.assertNotIn(b"\r\n", b1_reg)
        self.assertNotIn(b"\r\n", b1_sec)
        h1_reg = hashlib.sha256(b1_reg).hexdigest()
        h1_sec = hashlib.sha256(b1_sec).hexdigest()

        write_security_and_rights_reports()
        h2_reg = hashlib.sha256(reg_p.read_bytes()).hexdigest()
        h2_sec = hashlib.sha256(sec_p.read_bytes()).hexdigest()
        self.assertEqual(h1_reg, h2_reg)
        self.assertEqual(h1_sec, h2_sec)


if __name__ == "__main__":
    unittest.main()
