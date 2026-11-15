# Open-Source and NASA Space Apps 2026 Compliance Checklist

- [x] **Original Owned Code License Recorded (`Apache-2.0`)**: Owner approval documented in `LICENSE_RECOMMENDATION.md` and `SECURITY_AND_RIGHTS_CHECK.json` without creating or mutating root `LICENSE`.
- [x] **Upstream & Protected Baseline Untouched**: `brain/**`, `contracts/**`, `coordination/**`, `water_core/**`, `FINAL_BASELINE_AND_OWNERSHIP.json`, Codex A/B, and Gemini V5 untouched (`verify-upstream` 301 + 59 passes).
- [x] **SBOM & Transitive Native Obligations Disclosed**: `shapely` (`BSD-3-Clause` + `GEOS LGPL-2.1-or-later`), `pyproj` (`MIT`), `pyshp` (`MIT`), `certifi` (`MPL-2.0`) listed in `THIRD_PARTY_NOTICES.md` and `LICENSE_AND_PROVENANCE_REGISTER.json`.
- [x] **Data vs Software License Separation**: `ISRIC SoilGrids v2.0` (`CC BY 4.0`) never claimed as `Apache-2.0` or an OSI software license; enforced programmatically by `license_gate.py`.
- [x] **FAO GAEZ Fail-Closed Per-Layer Gate**: Disabled by default (`license_unverified`); blocks `CC-BY-NC-4.0` and layer-less v5 claims.
- [x] **No Secrets, Proprietary Fonts, Raw GeoTIFFs, or Unexpected Archives**: Enforced across all sidecar directories by `license_gate.py` -> `SECURITY_AND_RIGHTS_CHECK.json`.
- [x] **Reproducible Offline Replay**: Review package `< 20 MB` verified from fresh clean extraction onto `ASTRAGRON_GEMINI_SOURCE_WITH_GLOBAL_EVIDENCE_PROMPT.zip` with `ASTRAGRON_OFFLINE_ONLY=1`.
