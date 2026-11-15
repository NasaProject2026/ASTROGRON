# P0 Defect Register — ASTRAGRON Global Adaptive Evidence Engine

- **Inspection Baseline Commit:** `7d1e86a871e6c7a8dd158be795754172d38b3bb2` (`feature/global-adaptive-evidence`)
- **Subsystem Scope:** `adaptive_evidence/**`, `docs/adaptive_evidence/**`, `tests/adaptive_evidence/**`, `examples/adaptive_evidence/**` (read-only verification against unmodified `brain.service.ClientDecisionService` and locked `water_core/`)
- **Prepared:** 2026-11-14 (G0)

---

## Summary of Critical Pre-Upgrade Defects

| ID | Component | Severity | Short Title | Target Gate |
|---|---|---|---|---|
| P0-01 | `adaptive_evidence/adapters/soilgrids.py` (`L553`, `L571`, `L603`) | Critical | Depth mislabelling: requests for `0-30`, `30-60`, `60-100`, `100-200` cm silently resolve/label `0-5cm` topsoil values | G1 |
| P0-02 | `adaptive_evidence/adapters/soilgrids.py` (`L102–158`, `L456–488`) | Critical | Georeferencing-blind GeoTIFF decoder & WCS pixel selection (`v > 0` heuristic ignores affine transform, CRS, GDAL nodata, valid zeros, multi-strip/tile) | G1 |
| P0-03 | `adaptive_evidence/adapters/soilgrids.py` (`L734`, `L162`) & `adaptive_evidence/adapters/nasa_power.py` (`L54`, `L543`, `L586`) | Critical | Provenance/evidence-level conflation: static offline/synthetic fixtures emit `OBSERVED_OR_AUTHENTIC_SOURCE` instead of explicit machine-readable evidence tiers | G1 |
| P0-04 | `adaptive_evidence/adapters/nasa_power.py` (`L131–320`) | High | NASA POWER Daily retrieval limited by upstream `water_core` >=1yr wrapper: lacks direct short-window HTTPS fetcher, `time-standard=UTC` vs `LST` cache key isolation, retry/backoff/2 MB cap/telemetry, atomic writes, and explicit `-999`/leap-day checks on custom windows | G1 |
| P0-05 | `adaptive_evidence/engine.py`, `integration.py`, `unified_system.py` | High | Missing unified, versioned `EvidenceQualityGate` + `quality_assessment` sidecar enforcing pre-claim checks across all entry points and ranking the single next missing farmer input | G2 |
| P0-06 | `adaptive_evidence/sensitivity.py` (`L56–382`) | High | Screening sensitivity (`DecisionSensitivityAnalyzer`) emits `DECISION_SENSITIVITY_*` status without canonical `ClientDecisionService` evaluation, conflating regional screening sensitivity with authoritative 5-year planner sensitivity | G3 |
| P0-07 | `adaptive_evidence/license_gate.py`, `docs/adaptive_evidence/*` | Medium | Open-source docs & scanner need Apache-2.0 integration guidance (strictly without mutating root `LICENSE`), explicit CC BY 4.0 vs OSI separation, SBOM completeness, and automated binary/secret/cached-layer fail-closed checks | G4 |

---

## Detailed Defect Entries

### P0-01: Silent SoilGrids Depth Mislabelling (`0-5cm` Returned as Deeper Intervals)

- **Location:** `adaptive_evidence/adapters/soilgrids.py` (`L553`, `L571`, `L578`, `L603`) and cached manifests in `examples/adaptive_evidence/soilgrids_wcs_cache/` and `adaptive_evidence/data/soilgrids_global_cache/`. Also affects `OFFLINE_REGIONAL_SOIL_REFERENCES` (`0-30cm` profile values stamped with requested `depth_interval_cm`).
- **Observed Reproduction:**
  - Executing `SoilGridsWCSAdapter(cache_dir=Path('adaptive_evidence/data/soilgrids_global_cache')).fetch_or_load((9.22, 49.14), depth_intervals_cm=[(30.0, 60.0)], acquisition='CACHE_ONLY')` opens `34ff9971e980eb3efbd9c800.receipt.json` whose stored `depth_label` is `"0-5cm"` (`soc mean=43.1 g/kg`, `clay mean=25.0 %`) and emits `TypedEvidenceObject` records stamped `depth_interval_cm: [30.0, 60.0]`.
  - Executing `SoilGridsWCSAdapter().fetch_or_load((17.65, 59.82), depth_intervals_cm=[(30.0, 60.0)], acquisition='CACHE_ONLY')` similarly loads `"0-5cm"` receipt `114d371fd15c5e3957847531.receipt.json` and emits `[30.0, 60.0]`.
  - Code defect at `L553`: `primary_depth_label = "0-5cm" if (top_cm, bot_cm) == (0, 5) else "5-15cm" if (top_cm, bot_cm) == (5, 15) else "0-5cm"`.
  - Pre-upgrade test dependency discovered during G1 verification: legacy calls omitting `soil_depth_intervals_cm` (`engine.py` default `[[0, 5], [5, 15], [15, 30]]`) in `RT_13` (`evaluation.py`) and `test_g4_performance_and_g5_seven_integration_scenarios` (`test_g1_g5_comprehensive.py`) only passed against the `0-5cm`-only legacy cache (`examples/adaptive_evidence/soilgrids_wcs_cache/`) because `soilgrids.py` silently dropped `5-15cm` and `15-30cm`. Fixed by rejecting uncached missing horizons cleanly in `CACHE_ONLY` and passing explicit `soil_depth_intervals_cm: [[0, 5]]` where testing legacy `0-5cm` receipts.
- **Scientific Impact:** Surface `0-5 cm` organic carbon (`soc`), bulk density (`bdod`), pH (`phh2o`), and texture severely overestimate subsoil carbon and misrepresent root-zone hydraulic properties for `[0, 30]`, `[0, 60]`, `[30, 60]`, `[60, 100]`, `[100, 200] cm`.
- **Fix Plan:**
  - Support all 6 standard ISRIC SoilGrids v2.0 intervals (`0-5cm`, `5-15cm`, `15-30cm`, `30-60cm`, `60-100cm`, `100-200cm`).
  - Resolve any requested `[top_cm, bot_cm]` in `(0, 200]` to exact intersecting native SoilGrids layers via overlap weights (`overlap_cm / sum(overlap_cm)`).
  - Never substitute `0-5cm` (or `0-30cm` offline profile) for unretrieved deeper depths; return missing/unavailable or fail closed if any required constituent horizon is missing/invalid, and record exact native layer lineage.
  - Perform thickness-weighted averaging strictly on intensive continuous properties (`clay`, `silt`, `sand`, `bdod`, `cfvo`, `soc`); handle `phh2o` explicitly (do not linearly average across large pH heterogeneity without `[H+]` / explicit reporting & non-calibration flags); label aggregated `q05`/`q95` combinations strictly as scenario sensitivity bounds, not calibrated 90% interval predictions.
- **Risk:** Live ISRIC WCS/COG requests fetch 1–6 depth layers; bounded concurrency/request budgets and cached replay fixtures for multi-depth verification are needed.
- **Verification Tests:** Request `[0, 5]`, `[30, 60]`, `[0, 30]`, `[0, 60]`, non-standard `[10, 40]`, and out-of-range `[180, 250]`; verify exact overlap weights, abstention/failure on missing depth layer, and non-substitution against synthetic/real multi-layer receipts.
- **Owner:** Adaptive Evidence Upgrade (`G1`).

---

### P0-02: Georeferencing-Blind GeoTIFF Decoder & Non-Spatial Pixel Selection Heuristic

- **Location:** `adaptive_evidence/adapters/soilgrids.py` (`L102–158`, `decode_wcs_int16_geotiff`; `L456–488`, `fetch_live_wcs_profile`).
- **Observed Defect:**
  - `decode_wcs_int16_geotiff` only checks `StripOffsets` (`273`) and `StripByteCounts` (`279`) assuming a single offset scalar rather than multi-strip/tiled offsets, skips TIFF Predictor (`317`), ignores `ModelPixelScaleTag` (`33550`), `ModelTiepointTag` (`33922`), `GeoKeyDirectoryTag` (`34735`), `GeoAsciiParamsTag` (`34737`), and `GDAL_NODATA` (`42113`).
  - `fetch_live_wcs_profile` requests a `+/-0.02 deg` (~4.4 km × 4.4 km) bounding box and searches pixel values with `next((i for i, v in enumerate(vals) if v > 0), ...)`, then reuses the first positive-value pixel index across subsequent properties/quantiles (`vals[min(selected_pixel_idx, len(vals) - 1)]`).
  - **Empirically Reproduced Urban-Mask Drift (Lyon `[4.8357, 45.7640]`):** Live ISRIC WCS at exact downtown Lyon (`+/-0.0025 deg`) returns `0` across all 4 `2x2` pixels (`clay`/`silt`/`sand`/`bdod` = `0`, SoilGrids urban mask without `GDAL_NODATA`). Under the legacy `+/-0.02 deg` `306`-pixel box, `299/306` pixels were `0` and `next(v > 0)` jumped to `idx=31` (~2.1 km away) to borrow an arbitrary soil pixel, masking the urban `POINT_PIXEL_MISSING` condition in `tests/adaptive_evidence/test_unified_acceptance_regressions.py::test_live_uncached_coordinate_fetch_allowed_in_isolated_temp_cache`.
- **Scientific Impact:**
  1. Valid `0` values (especially `cfvo = 0`, `soc = 0`, `clay/sand = 0`) are skipped by `v > 0`, selecting an arbitrary neighbor up to ~2.8 km away.
  2. Negative `GDAL_NODATA` (`-32768`) or masked ocean/urban pixels can produce spatial drift or mask inconsistency across properties (`clay` pixel `(r1, c1)` vs `cfvo` pixel `(r2, c2)`).
  3. Non-georeferenced decoding cannot verify CRS (`EPSG:4326` vs projected), compute pixel center coordinates, or measure geodesic distance from the requested farm point.
- **Fix Plan:**
  - Parse full TIFF IFD tags (`ImageWidth`, `ImageLength`, `BitsPerSample`, `SampleFormat`, `Compression` raw/deflate/LZW if present or explicit error, multi-strip `StripOffsets`/`StripByteCounts`, `RowsPerStrip`, `TileWidth`/`TileLength`/`TileOffsets`/`TileByteCounts`, `ModelPixelScaleTag`, `ModelTiepointTag`, `GeoKeyDirectoryTag`, `GeoAsciiParamsTag`, `GDAL_NODATA`).
  - Compute exact `(row, col)` from affine tiepoint + pixel scale at the requested `(lon, lat)` (and fall back cleanly ONLY within explicit configurable max distance threshold if nearest valid pixel check is opted in, emitting `POINT_PIXEL_MISSING`, `GEO_DISTANCE_EXCEEDED`, `MIXED_SOURCE_SUPPORT`, or `SPATIAL_UNCERTAIN`).
  - Require exact pixel/nodata/CRS consistency across all properties/quantiles and preserve legitimate `0` values (`v != nodata`).
  - Implement WebDAV/COG HTTP Range / WCS fallback awareness while keeping requests bounded and verifiable.
- **Risk:** LZW-compressed GeoTIFFs or non-4326 CRS variants returned by external endpoints must either decode accurately or fail closed rather than misread bytes.
- **Verification Tests:** Synthetic multi-strip & affine-georeferenced GeoTIFFs testing exact coordinate->pixel mapping, `cfvo=0` preservation, `GDAL_NODATA=-32768` at exact point (`POINT_PIXEL_MISSING`), distant pixel > max threshold (`GEO_DISTANCE_EXCEEDED`), cross-property pixel mismatch (`MIXED_SOURCE_SUPPORT`), and real WCS bytes if provider is online.
- **Owner:** Adaptive Evidence Upgrade (`G1`).

---

### P0-03: Provenance & Evidence Level Conflation Across Offline Fixtures and Adapters

- **Location:** `adaptive_evidence/adapters/soilgrids.py` (`L162`, `L734`), `adaptive_evidence/adapters/nasa_power.py` (`L54`, `L543`, `L586`), `adaptive_evidence/schema.py` (`L350–440`), `adaptive_evidence/engine.py`.
- **Observed Reproduction:**
  - Calling `SoilGridsWCSAdapter().fetch_or_load(prof['lon_lat'], acquisition='OFFLINE_REPLAY', allow_offline_reference_fixture=True, site_id='DE_BERLIN')` sets `fixture_origin='REGIONAL_OFFLINE_REFERENCE_FIXTURE'` yet sets `provenance_class='OBSERVED_OR_AUTHENTIC_SOURCE'`.
  - Calling `NASAPowerAdapter().fetch_or_load(prof['lon_lat'], acquisition='OFFLINE_REPLAY', allow_offline_reference_fixture=True, site_id='AR_PERGAMINO_PAMPAS')` similarly emits `provenance_class='OBSERVED_OR_AUTHENTIC_SOURCE'` for bundled reference summaries without a genuine daily receipt.
- **Scientific & Audit Impact:** Downstream checks inspecting `provenance_class` cannot cleanly distinguish authentic live fetches, integrity-verified cached receipts, static regional reference estimates (`VERIFIED_OPEN_SOURCE_MAP_ESTIMATE`), user-declared scenarios, scientific derivations, and synthetic test fixtures.
- **Fix Plan:** Introduce explicit canonical `evidence_level` field (`AUTHENTIC_LIVE`, `AUTHENTIC_VERIFIED_CACHE`, `VERIFIED_OPEN_SOURCE_MAP_ESTIMATE`, `USER_DECLARED_SCENARIO`, `SCIENTIFIC_DERIVATION`, `SYNTHETIC_TEST_FIXTURE`, `UNAVAILABLE`) across `TypedEvidenceObject`, adapter responses, engine output, unified envelope, and coverage matrix metrics. Reserve `OBSERVED_OR_AUTHENTIC_SOURCE` strictly for `AUTHENTIC_LIVE` and `AUTHENTIC_VERIFIED_CACHE`; offline reference fixtures emit `VERIFIED_OPEN_SOURCE_MAP_ESTIMATE` (`provenance_class='DERIVED_WITH_VALIDATED_METHOD'` or regional map reference metadata) and synthetic fixtures emit `SYNTHETIC_TEST_FIXTURE`.
- **Risk:** Existing tests expecting legacy `provenance_class` on `OFFLINE_REGIONAL_*` fixtures must be checked and updated only where asserting the old inflated provenance class (preserving full compatibility for authentic cached receipts).
- **Verification Tests:** Suite verifying every fixture origin maps deterministically to the right `evidence_level`, never inflates coverage counts, and prevents gate upgrades.
- **Owner:** Adaptive Evidence Upgrade (`G1` / `G2` / `G6`).

---

### P0-04: NASA POWER Daily Adapter Gaps (Short Historical Windows, `UTC` vs `LST`, Atomic Cache, Resiliency)

- **Location:** `adaptive_evidence/adapters/nasa_power.py` (`L86–320`).
- **Observed Defect:**
  - Live fetch exclusively calls `water_core.power_source.fetch_power_weather`, which rejects periods shorter than 1 full year or non-Jan-1/Dec-31 spans and hardcodes `time-standard=UTC`.
  - `NASAPowerAdapter` cache lookup keys on `point, start_iso, end_iso, variables` without `time_standard`, `provider_version`, or transform identifier, cannot isolate `UTC` vs `LST`, lacks atomic cache writes (`tmp` + `os.replace`), lacks explicit `-999`/duplicate-date/gap/leap-day checks in independent adapter-managed live requests, and lacks bounded retry/backoff/2 MB cap/request-count telemetry.
  - Note also observed receipt schema mismatch check in repro script (`start_iso`/`end_iso` stored under `period: [start, end]` rather than top-level `start_iso`).
- **Scientific Impact:** Custom agricultural season windows (e.g., 30–120 days), leap-year boundaries, mixed `UTC`/`LST` cache collisions, and partial write corruption under concurrent/interrupted runs are mishandled or blocked unnecessarily.
- **Fix Plan:** Implement direct bounded HTTPS fetcher inside `NASAPowerAdapter` (without editing `water_core/power_source.py`!) for general daily windows while remaining compatible with existing `astragron.nasa-global-receipt.v1` receipts; enforce host allow-list (`power.larc.nasa.gov`), `NoRedirect`, bounded retries with exponential backoff, 2 MB response size cap, timeout, request-count telemetry, atomic temp + `os.replace` writes, SHA-256 verification on read, explicit `time_standard` (`UTC` vs `LST`) cache keying, continuous daily index/leap-day/`-999` validation, and structured failure codes (`SOURCE_OUTAGE`, `NO_DATA`, `INCOMPLETE_DATA`).
- **Risk:** Preserve seamless compatibility with all existing 9 `nasa_power_global_cache` receipts and 4 Wageningen/Almeria `water_core/sources` receipts.
- **Verification Tests:** Live fetch over >=4 previously uncached continental sites for short fixed historical window, `UTC` vs `LST` key separation, tamper detection on cached `.raw.json`, `-999` sentinel rejection, leap-day continuity, outage/429 retry/timeout simulation.
- **Owner:** Adaptive Evidence Upgrade (`G1`).

---

### P0-05: Missing Unified `EvidenceQualityGate` and Single Next-Input Ranking (`quality_assessment`)

- **Location:** `adaptive_evidence/engine.py`, `adaptive_evidence/integration.py`, `adaptive_evidence/unified_system.py`.
- **Observed Defect:**
  - Quality, temporal cutoff, spatial support, depth validity, physical domain bounds, provenance/license constraints, and user-declared "measured" claims (without date/method/depth) are checked piecemeal across adapters and engine helpers, with no unified versioned `EvidenceQualityGate` producing a machine-readable `quality_assessment` sidecar prior to downstream screening/planner outputs.
  - Existing `prioritized_next_measurements` returns unranked/heuristic lists rather than an enforced single top missing farmer input ranked first by blocking dependencies and second by sensitivity impact without fabricating economic VOI.
- **Scientific Impact:** Inconsistent capability readiness verdicts or unguarded partial claims when cross-source disagreement, depth mismatches, missing user measurement metadata, or `LST`/`UTC` conflicts occur.
- **Fix Plan:** Implement `adaptive_evidence/quality_gate.py` (`EvidenceQualityGate`, schema `astragron.quality-gate.v1`) emitting per-capability and overall verdicts (`ACCEPTED_FOR_CLAIM`, `ACCEPTED_CONDITIONALLY`, `DEGRADED_TO_DESCRIPTION`, `REJECTED`, `UNDETERMINED`) with machine-readable reason codes + plain English explanations, wired into `engine.py`, `integration.py`, and `unified_system.py` before downstream claims while preserving descriptive climate (`C2`) and soil (`C3`) partial results cleanly. User-declared "measured" soil inputs lacking explicit date, analytical method, and depth remain `USER_DECLARED_SCENARIO` (`CONDITIONAL` rather than promoted to `C4 = READY`, updated in `test_p7_improvements.py`).
- **Owner:** Adaptive Evidence Upgrade (`G2`).

---

### P0-06: Screening Sensitivity Labeled as `DECISION_SENSITIVITY_*` Without Canonical Planner Execution

- **Location:** `adaptive_evidence/sensitivity.py` (`L56–382`).
- **Observed Reproduction:**
  - `DecisionSensitivityAnalyzer.analyze` returns `sensitivity_gate_status='DECISION_SENSITIVITY_UNDETERMINED'` (or `'DECISION_SENSITIVITY_READY'`) and `stability_classification`, computed purely from `evaluate_crop_under_joint_scenario` regional water-deficit heuristics (`C6` screen) rather than running `brain.service.ClientDecisionService`.
  - Independent physically constrained perturbation of parameters used by `ClientDecisionService` (such as field soil/area/water/nutrient/scenario inputs) can flip the canonical 5-year plan even when the regional water screen reports `STABLE`.
- **Scientific Impact:** Misleads callers or reviewers into believing the authoritative 5-year farm plan is stable when only a simplified regional ET/precipitation water screen was evaluated.
- **Fix Plan:** Explicitly tag existing screening sensitivity with `analysis_kind = "REGIONAL_WATER_SCREENING_SENSITIVITY"` (retaining backward-compatible fields + clear caveat), tighten physically correlated perturbations, and add read-only `CanonicalDecisionSensitivityRunner` calling unmodified `brain.service.ClientDecisionService` over bounded, correlated finite scenarios (`CHANGED_WITHIN_TESTED_SCENARIOS`, `UNCHANGED_WITHIN_TESTED_SCENARIOS`, `CANONICAL_DECISION_SENSITIVITY_UNDETERMINED`) comparing plan identity, feasibility/status, objective values/units, crop sequence, and caveats.
- **Owner:** Adaptive Evidence Upgrade (`G3`).

---

### P0-07: Open-Source Licensing Docs & Scanner Hardening (Apache-2.0 Owner Code Scope + CC BY 4.0 Separation)

- **Location:** `adaptive_evidence/license_gate.py`, `docs/adaptive_evidence/*` (`LICENSE_RECOMMENDATION.md`, `THIRD_PARTY_NOTICES.md`, `DATA_SOURCES_AND_LICENSES.md`, `OPEN_SOURCE_COMPLIANCE_CHECKLIST.md`, `SCIENTIFIC_LIMITATIONS.md`).
- **Observed Need:** Owners approved Apache-2.0 for original owned code only (root `LICENSE` remains untouched). Compliance docs, SBOM, NASA POWER / ISRIC SoilGrids CC BY 4.0 / Natural Earth Public Domain / FAO GAEZ per-layer notices, and fail-closed scanner must enforce separation between Apache-2.0 owned code, permissive OSS packages, CC BY 4.0 environmental data, and third-party upstream components, while detecting secrets or unexpected binary/untracked cache files.
- **Owner:** Adaptive Evidence Upgrade (`G4`).
