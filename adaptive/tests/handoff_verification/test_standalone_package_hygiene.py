"""Pure stdlib standalone hygiene and contract verification (runs without upstream brain/)."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SIDECAR_DIRS = (
    "adaptive_evidence",
    "tests/adaptive_evidence",
    "tests/handoff_verification",
    "examples/adaptive_evidence",
    "docs/adaptive_evidence",
    "contracts",
)
HANDOFF_ROOT_FILES = (
    "INTEGRATION_INSTRUCTIONS.md",
    "REQUIRED_UPSTREAM_DEPENDENCIES.json",
    "SOURCE_AND_LICENSE_AUDIT.md",
)


class TestStandalonePackageHygiene(unittest.TestCase):
    def _iter_sidecar_files(self):
        for d in SIDECAR_DIRS:
            base = ROOT / d
            if base.is_dir():
                for p in base.rglob("*"):
                    if p.is_file() and "__pycache__" not in p.parts:
                        yield p
        for fname in HANDOFF_ROOT_FILES:
            fp = ROOT / fname
            if fp.is_file():
                yield fp
        for opt in ("FINAL_TEST_RESULTS.json", "FINAL_READINESS_REPORT.md", "FINAL_HANDOFF_SHA256_MANIFEST.json"):
            fp = ROOT / opt
            if fp.is_file():
                yield fp

    def test_required_layout_and_no_forbidden_artifacts(self) -> None:
        for req_dir in SIDECAR_DIRS:
            self.assertTrue((ROOT / req_dir).is_dir(), f"Missing directory: {req_dir}")

        self.assertFalse((ROOT / "LICENSE").exists(), "Sidecar overlay must not ship a root LICENSE file")
        for p in self._iter_sidecar_files():
            self.assertNotIn(p.suffix.lower(), {".tif", ".tiff"}, f"Raw GeoTIFF leaked: {p}")

    def test_module_schemas_and_contracts_valid_json(self) -> None:
        for rel in (
            "contracts/adaptive_evidence_request_v1.schema.json",
            "contracts/adaptive_evidence_response_v1.schema.json",
            "docs/adaptive_evidence/adaptive_evidence_request_v1.schema.json",
            "docs/adaptive_evidence/adaptive_evidence_response_v1.schema.json",
            "docs/adaptive_evidence/LICENSE_AND_PROVENANCE_REGISTER.json",
            "docs/adaptive_evidence/SECURITY_AND_RIGHTS_CHECK.json",
            "REQUIRED_UPSTREAM_DEPENDENCIES.json",
        ):
            path = ROOT / rel
            self.assertTrue(path.is_file(), f"Missing file: {rel}")
            raw = path.read_bytes()
            self.assertNotIn(b"\r\n", raw, f"CRLF detected in {rel}")
            json.loads(raw.decode("utf-8"))

        req_a = (ROOT / "contracts" / "adaptive_evidence_request_v1.schema.json").read_bytes()
        req_b = (ROOT / "docs" / "adaptive_evidence" / "adaptive_evidence_request_v1.schema.json").read_bytes()
        self.assertEqual(req_a, req_b)

    def test_no_machine_paths_or_secrets_in_text_files(self) -> None:
        forbidden = re.compile(
            r"(C:\\Nasa|C:/Nasa|Users\\PCCV|Users/PCCV|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY)"
        )
        for p in self._iter_sidecar_files():
            if p.name == Path(__file__).name:
                continue
            if p.suffix.lower() in {".py", ".md", ".json", ".txt", ".html", ".css", ".js", ".lock", ".sha256"}:
                text = p.read_text(encoding="utf-8", errors="ignore")
                m = forbidden.search(text)
                self.assertIsNone(m, f"Forbidden token/path in {p.relative_to(ROOT)}: {m.group(0) if m else ''}")


if __name__ == "__main__":
    unittest.main()
