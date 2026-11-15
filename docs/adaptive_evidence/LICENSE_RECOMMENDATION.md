# License Recommendation and Owner Authorization Record — ASTRAGRON Adaptive Evidence Subsystem

## Owner License Decision (Recorded)
- **Approved License for Original Owned Code Only**: **Apache License 2.0 (`Apache-2.0`)**, as explicitly authorized by the project owners.
- **Root Repository Scope Preservation**: By explicit mission instruction, this subsystem **DOES NOT create or modify** a root `LICENSE` file in the ASTRAGRON repository. All licensing governance for pre-existing repository code (`brain/**`, `contracts/**`, `coordination/**`, `water_core/**`, Codex A/B, Gemini V5) remains unchanged under the existing repository baseline (`verify-upstream` 301 + 59 untouched).

## Strict Boundary Between Code, Runtime Dependencies, and Third-Party Data
1. **Original Owned Adaptive-Evidence Code** (`adaptive_evidence/**/*.py` excluding any third-party templates, `tests/adaptive_evidence/**/*.py`, `docs/adaptive_evidence/*.schema.json`):
   - Covered by owner-approved **Apache-2.0** terms (OSI-approved permissive software license with explicit patent grant).
2. **Third-Party Python & Native Dependencies** (`requirements.lock` / SBOM):
   - `shapely 2.2.0` (`BSD-3-Clause`, bundled GEOS C++ library under `LGPL-2.1-or-later`),
   - `pyproj 3.7.2` (`MIT`, bundled PROJ C++ library under `MIT`),
   - `pyshp 3.0.3` (`MIT`), `certifi` (`MPL-2.0`), `numpy` (`BSD-3-Clause`).
   - Retained verbatim under their respective upstream notices in `THIRD_PARTY_NOTICES.md`.
3. **External Scientific Datasets (Never Relabeled as Apache-2.0)**:
   - **ISRIC SoilGrids v2.0**: **CC BY 4.0** (data license, *not* an OSI software license; mandatory attribution to Poggio et al. 2021 / ISRIC).
   - **NASA POWER Daily API**: **NASA Open Data / Public Domain** (mandatory scientific citation to NASA POWER Prediction Of Worldwide Energy Resources).
   - **Natural Earth 10m Vector Masks**: **Public Domain** (`1:10m Physical Vectors` bundled ZIP SHA-256 pinned in `NATURAL_EARTH_10M_RECEIPT.json`).
   - **FAO GAEZ v4/v5**: **Disabled by default** (`license_unverified`); per-layer verification required before admission (any `CC-BY-NC` or unverified layer is hard-blocked).
