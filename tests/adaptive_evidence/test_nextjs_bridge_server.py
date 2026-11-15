"""End-to-end HTTP tests for the Python V7 Next.js <-> UnifiedAstragronSystem bridge (`/health`, `/analyses`, restart persistence)."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen

from adaptive_evidence.unified_server import create_unified_http_server


def _http_json(url: str, method: str = "GET", payload: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, method=method, headers=headers)
    try:
        with urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        if hasattr(exc, "code") and hasattr(exc, "read"):
            raw = exc.read().decode("utf-8")
            try:
                return int(exc.code), json.loads(raw)
            except Exception:
                return int(exc.code), {"raw": raw}
        raise


class TestNextJsPythonBridgeServer(unittest.TestCase):
    def test_health_analyses_status_mapping_and_restart_persistence(self) -> None:
        prev_offline = os.environ.get("ASTRAGRON_OFFLINE_ONLY")
        os.environ["ASTRAGRON_OFFLINE_ONLY"] = "1"
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                store_path = Path(tmpdir) / "python-store.json"
                httpd = create_unified_http_server("127.0.0.1", 0, store_path=store_path)
                port = httpd.server_address[1]
                t = threading.Thread(target=httpd.serve_forever, daemon=True)
                t.start()
                base = f"http://127.0.0.1:{port}"
                try:
                    # 1. /health
                    st, health = _http_json(f"{base}/health")
                    self.assertEqual(st, 200)
                    self.assertTrue(health["ok"])
                    self.assertEqual(health["status"], "healthy")
                    self.assertTrue(health["upstreamIntegrityVerified"])

                    # 2. Unmodified Uppsala research archive
                    st, uppsala = _http_json(
                        f"{base}/analyses",
                        method="POST",
                        payload={
                            "farmId": "uppsala-demo",
                            "farmName": "Uppsala Research Farm",
                            "locationLabel": "Uppsala, Sweden",
                            "inputRevision": "rev-uppsala-ref",
                            "datasetMode": "RECORDED_M14_RESEARCH",
                            "coordinates": [17.6389, 59.8586],
                            "fieldCount": 3,
                            "inputsModified": False,
                            "isUserCreatedDraft": False,
                        },
                    )
                    self.assertEqual(st, 200)
                    self.assertEqual(uppsala["status"], "ABSTAINED")
                    self.assertEqual(uppsala["failClosedStatus"], "OK_RECORDED_RESEARCH")
                    self.assertTrue(uppsala["evidenceVerified"])
                    self.assertEqual(uppsala["reportEnvelope"]["dataAvailabilityClass"], "VERIFIED_RECORDED_CORPUS")

                    # 3. Cached land site (Heilbronn Germany) regional screening -> COMPLETED_LIMITED + OK_COVERAGE_ONLY
                    st, germany = _http_json(
                        f"{base}/analyses",
                        method="POST",
                        payload={
                            "farmId": "custom-heilbronn-1",
                            "farmName": "Heilbronn Parcel",
                            "locationLabel": "Heilbronn, Germany",
                            "inputRevision": "rev-heilbronn-v1",
                            "datasetMode": "REAL_SCIENTIFIC_BACKEND",
                            "coordinates": [9.22, 49.14],
                            "fieldCount": 1,
                            "totalAreaHa": 14.5,
                            "fields": [
                                {
                                    "id": "F1",
                                    "label": "North Wheat",
                                    "declaredAreaHa": 14.5,
                                    "candidateCrops": ["Winter Wheat", "Spring Barley"],
                                }
                            ],
                            "inputsModified": True,
                            "isUserCreatedDraft": True,
                        },
                    )
                    self.assertEqual(st, 200)
                    self.assertEqual(germany["statusOutcome"], "REGIONAL_SCREENING_ONLY")
                    self.assertEqual(germany["status"], "COMPLETED_LIMITED")
                    self.assertEqual(germany["failClosedStatus"], "OK_COVERAGE_ONLY")
                    self.assertTrue(germany["evidenceVerified"])
                    rep = germany["reportEnvelope"]
                    self.assertEqual(rep["dataAvailabilityClass"], "COVERAGE_ONLY")
                    self.assertGreaterEqual(len(rep["waterBalanceChart"]), 1)
                    self.assertEqual(len(rep["sourceReadinessChart"]), 3)
                    self.assertGreaterEqual(len(germany["allowedCitationIds"]), 2)
                    saved_job_id = germany["jobId"]
                    saved_rep_id = rep["reportId"]
                    saved_res_id = germany["resultId"]

                    # 4. Ocean location -> UNAVAILABLE + MODEL_UNQUALIFIED
                    st, ocean = _http_json(
                        f"{base}/analyses",
                        method="POST",
                        payload={
                            "farmId": "ocean-atlantic",
                            "inputRevision": "rev-ocean-1",
                            "datasetMode": "REAL_SCIENTIFIC_BACKEND",
                            "coordinates": [-30.0, 45.0],
                            "fieldCount": 0,
                        },
                    )
                    self.assertEqual(st, 200)
                    self.assertEqual(ocean["statusOutcome"], "WATER_OR_UNVERIFIED_LOCATION")
                    self.assertEqual(ocean["status"], "UNAVAILABLE")
                    self.assertEqual(ocean["failClosedStatus"], "MODEL_UNQUALIFIED")
                    self.assertFalse(ocean["evidenceVerified"])

                    # 5. Spatial mismatch (coords in Uppsala, polygon in Berlin) -> FAILED + SOURCE_NOT_PROVIDED
                    st, mismatch = _http_json(
                        f"{base}/analyses",
                        method="POST",
                        payload={
                            "farmId": "custom-mismatch-1",
                            "inputRevision": "rev-mismatch-1",
                            "datasetMode": "REAL_SCIENTIFIC_BACKEND",
                            "coordinates": [17.6389, 59.8586],
                            "fieldCount": 1,
                            "fields": [
                                {
                                    "id": "F1",
                                    "geometry": {
                                        "type": "Polygon",
                                        "coordinates": [[[13.38, 52.50], [13.42, 52.50], [13.42, 52.53], [13.38, 52.53], [13.38, 52.50]]],
                                    },
                                }
                            ],
                        },
                    )
                    self.assertEqual(st, 200)
                    self.assertEqual(mismatch["statusOutcome"], "INVALID_LOCATION_OR_GEOMETRY")
                    self.assertEqual(mismatch["status"], "FAILED")
                    self.assertEqual(mismatch["failClosedStatus"], "SOURCE_NOT_PROVIDED")
                    self.assertFalse(mismatch["evidenceVerified"])
                finally:
                    httpd.shutdown()
                    httpd.server_close()

                # 6. Restart server with same disk store and confirm job, report, and unified result persist
                httpd2 = create_unified_http_server("127.0.0.1", 0, store_path=store_path)
                port2 = httpd2.server_address[1]
                t2 = threading.Thread(target=httpd2.serve_forever, daemon=True)
                t2.start()
                base2 = f"http://127.0.0.1:{port2}"
                try:
                    st, rec_job = _http_json(f"{base2}/analyses/{saved_job_id}")
                    self.assertEqual(st, 200)
                    self.assertEqual(rec_job["job"]["reportId"], saved_rep_id)

                    st, rec_rep = _http_json(f"{base2}/api/v1/reports/{saved_rep_id}")
                    self.assertEqual(st, 200)
                    self.assertEqual(rec_rep["report"]["farmId"], "custom-heilbronn-1")

                    st, rec_env = _http_json(f"{base2}/api/v1/adaptive-evidence/results/{saved_res_id}.json")
                    self.assertEqual(st, 200)
                    self.assertEqual(rec_env["status_outcome"], "REGIONAL_SCREENING_ONLY")
                finally:
                    httpd2.shutdown()
                    httpd2.server_close()
        finally:
            if prev_offline is None:
                os.environ.pop("ASTRAGRON_OFFLINE_ONLY", None)
            else:
                os.environ["ASTRAGRON_OFFLINE_ONLY"] = prev_offline


if __name__ == "__main__":
    unittest.main()
