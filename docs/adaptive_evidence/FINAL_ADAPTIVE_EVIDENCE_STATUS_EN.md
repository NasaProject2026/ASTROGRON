# ASTRAGRON Global Adaptive Evidence Subsystem — Final Upgrade Status (`G0–G7`)

**Audit Date (UTC):** `2026-11-14`  
**Scope:** Independent sidecar subsystem (`adaptive_evidence/**`, `tests/adaptive_evidence/**`, `examples/adaptive_evidence/**`, `docs/adaptive_evidence/**`)  
**Protected Baseline Integrity:** `301` upstream protected files and `59` growth input files verified intact (`pre_existing_files_altered: []`); root `LICENSE` neither created nor modified (`root_license_exists: false`).

---

## 1. Feature & Gate Status Summary

| Capability / Component | Status | Evidence & Verification |
|---|---|---|
| **G0** — Baseline, Defect Register (`P0_DEFECT_REGISTER.md`), Protected Checksums | **IMPLEMENTED & TESTED** | `docs/adaptive_evidence/BASELINE_ID.json`, `P0_DEFECT_REGISTER.md`, `verify_upstream_integrity() -> passed: true` |
| **G1 (NASA POWER)** — Global uncached daily retrieval, `time-standard=UTC` vs `LST`, leap days, `-999` fill vs dry `0.0`, atomic receipts, `ASTRAGRON_OFFLINE_ONLY=1` fail-closed guard, host allowlist, raw 301/302/303/307/308 redirect blocking, 2 MB cap, retry/backoff | **IMPLEMENTED & TESTED** | `6/6` live continental agricultural sites (`DE_MUNICH_AGRI`, `DE_HEILBRONN`, `US_AMES_IOWA`, `BR_SORRISO`, `KE_NAKURU`, `AU_TOOWOOMBA`, 62 days `2023-07-01..2023-08-31`) + `6/6` offline bit-for-bit replay parity; see `LIVE_SOURCE_VERIFICATION.json` |
| **G1 (ISRIC SoilGrids v2.0 250 m WCS)** — All 6 native depths (`0–5`..`100–200 cm`), GeoTIFF Deflate/LZW+Predictor=2/Int16/Float32 affine geotransform decoder, `<= 500 m` center distance check, valid `cfvo=0` vs `-32768` nodata, thickness-weighted intensive aggregation, `phh2o` scalar abstention, non-contiguous gap & `> 200 cm` fail-closed guards | **IMPLEMENTED & TESTED** | `5/5` rural cropland sites (`DE_KRAICHGAU_AGRI`, `US_AGRONOMY_AMES`, `BR_SORRISO_AGRI`, `KE_NAKURU`, `AU_TOOWOOMBA_AGRI`) x 2 depths (`[0, 30]`, `[30, 60]`) = `10/10` live WCS queries (`166.25–196.13 m`) + `10/10` offline parity + urban mask fail-closed probe (`DE_HEILBRONN_URBAN_CENTER` -> `point_pixel_missing`); see `SOIL_DEPTH_AND_SPATIAL_AUDIT.json` |
| **G2 (Evidence Quality Gate & Ranking)** — `EvidenceQualityGate` (`astragron.quality-gate.v1`), sub-annual vs annual temporal gate, strict metadata check (`date` + `method` + valid `[top, bot]` depth), `CROSS_SOURCE_DISAGREEMENT` downgrade (`C4`/`C6`/`C7` never `ACCEPTED_FOR_CLAIM`), spoofed `C10` rejection, non-numeric `theta_fc`/`theta_wp` fail-closed guard, `single_next_missing_input` blocking-first ranking (`economic_voi_usd: null`, `fabricated_voi: false`) | **IMPLEMENTED & TESTED** | `7/7` Quality Gate acceptance checks (`QUALITY_GATE_FALSE_UPGRADES = 0`); see `QUALITY_GATE_ACCEPTANCE.json` |
| **G3 (Sensitivity Separation)** — Explicit `REGIONAL_WATER_SCREENING_SENSITIVITY` label on `DecisionSensitivityAnalyzer` (`canonical_decision_sensitivity_executed: false`) + non-invasive `CanonicalDecisionSensitivityRunner` calling unmodified `brain.service.ClientDecisionService` | **IMPLEMENTED & TESTED** | All 3 canonical stability classes covered (`CHANGED_WITHIN_TESTED_SCENARIOS`, `UNCHANGED_WITHIN_TESTED_SCENARIOS`, `CANONICAL_DECISION_SENSITIVITY_UNDETERMINED`) plus live `AU_WAGGA_REGION` divergence witness (`flips=2`, `+6162.39 m3` max shortfall delta); see `SENSITIVITY_SCOPE_AND_TESTS.json` |
| **G4 (Open Source & NASA Space Apps 2026 Compliance)** — Owner-approved `Apache-2.0` for original owned code only (no root `LICENSE` created/edited), SPDX SBOM, `CC-BY-4.0` data attribution preserved and separated from OSI code licenses, non-bundled active `NC`/proprietary data blocked, secret/GeoTIFF/archive scanner (`license_gate.py`) | **IMPLEMENTED & TESTED** | `license_gate.py` -> `PASS` (`0` blockers across `132+` scanned files); see `SECURITY_AND_RIGHTS_CHECK.json`, `LICENSE_AND_PROVENANCE_REGISTER.json`, `THIRD_PARTY_NOTICES.md`, `DATA_SOURCES_AND_LICENSES.md` |
| **G5 (Suites A–E + Independent Suite F Regressions)** | **IMPLEMENTED & TESTED** | `82` unit/integration tests in `tests/adaptive_evidence` (`0` failed, `0` errors, `0` skipped under `ASTRAGRON_OFFLINE_ONLY=1`) + `37/37` canonical `tests/engine/test_client_api.py` |
| **Native PCSE Growth Worker Tests (`tests/engine/test_growth_*`)** | **BLOCKED / SKIPPED IN SIDECAR VENV** | `pcse` is not installed in the isolated sidecar `.venv` (logged honestly in `BASELINE_ID.json`; never fabricated as PASS) |
| **G6 (24-Site + 8-Adversarial Matrix & Metrics)** | **IMPLEMENTED & TESTED** | `COVERAGE_MATRIX.csv`: `4/24` NASA POWER & `5/24` SoilGrids authentic cached sites, `6/24` useful partial coverage under real-sources-only policy, `5/5` depth & spatial provenance completeness, `0` false upgrades (`1954.98 ms`, `4.912 MiB` peak traced RAM) |

---

## 2. Honest History of Discovered Failures & Fixes

1. **Town-Center SoilGrids Urban/Built-Up Masking (Initial G6 Live Run -> Corrected Rural Agricultural Selection):**
   - Initial live WCS run (`2026-11-14T16:55:47Z`) succeeded on `6/6` NASA POWER sites but `1/4` SoilGrids sites (`KE_NAKURU`) because town-center coordinates (`[9.22, 49.14]` Heilbronn, `[-93.62, 42.03]` Ames, `[-55.72, -12.55]` Sorriso) intersected ISRIC SoilGrids urban/built-up nodata masks (`point_pixel_missing`) instead of silently snapping kilometers away.
   - Kept `[9.22, 49.14]` (`DE_HEILBRONN_URBAN_CENTER`) documented in `urban_or_water_mask_fail_closed_probes` (`point_pixel_missing`) and re-ran live SoilGrids across 5 rural agricultural cropland sites (`DE_KRAICHGAU_AGRI`, `US_AGRONOMY_AMES`, `BR_SORRISO_AGRI`, `KE_NAKURU`, `AU_TOOWOOMBA_AGRI`) at `2026-11-14T17:05:29Z`: **`5/5` sites (`10/10` multi-depth queries)** succeeded with distances `166.25–196.13 m`.
2. **Independent Suite F Adversarial Review (`29` Probes -> `8` GAPs Fixed & Regressed):**
   - Independent Suite F execution initially passed `21/29` probes and uncovered `8` edge-case gaps (`GAP-1` raw HTTP 302 redirect return on injected `urlopen_fn`, `GAP-2` whitespace metadata and empty `depth_interval_cm=[]` in `user_measurements`, `GAP-3` `C4` not downgraded on `CROSS_SOURCE_DISAGREEMENT`, `GAP-4` direct `EvidenceQualityGate` accepting spoofed `C10=READY`, `GAP-5` non-dict input crash in `DecisionSensitivityAnalyzer.analyze`, `GAP-6` active `CC-BY-NC-4.0` check skipped outside `BUNDLED_OFFLINE`, `GAP-7` non-contiguous depth interval `[[0, 5], [15, 30]]` silently interpolating skipped `5-15cm` layer, `GAP-8` unhandled `ValueError` on non-numeric `theta_fc`/`theta_wp`).
   - All 8 gaps were fixed and converted into permanent regression assertions in `tests/adaptive_evidence/`.
3. **Matrix Denominator Correction (`DEPTH_PROVENANCE_COMPLETENESS`):**
   - Initial G6 matrix counter counted `UNAVAILABLE` blocked `soil.*` ledger stubs alongside eligible soil sites (`24/5`); restricted denominator matching to `AUTHENTIC_LIVE` / `AUTHENTIC_VERIFIED_CACHE` C3 results, yielding exact **`5/5`** completeness.

---

## 3. Explicit Scientific Caveats & Prohibitions

- Historical NASA POWER data describe past meteorological realizations only (**never** future 2027–2031 crop-year forecasts or on-farm weather stations).
- ISRIC SoilGrids v2.0 reflects nominal `250 m x 250 m` model predictions (**never** field-scale laboratory calibration; `phh2o` scalar linear averaging across multiple horizons is abstained; SoilGrids total nitrogen `cg/kg` cannot substitute for plant-available mineral `NO3-/NH4+`).
- Multi-horizon SoilGrids quantiles represent thickness-weighted scenario bounds across depth intervals, not calibrated 90% prediction intervals.
- Sample matrix metrics (`6/6`, `5/5`, `6/24`, `24+8`) characterize tested sample sites only — never global Earth land coverage or agronomic yield accuracy.
- Regulatory legality (`C10`) never promotes without verified official authority clearance.
