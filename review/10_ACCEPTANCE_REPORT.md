# ASTRAGRON V7 — Final Release-Closure Acceptance Report (Gates G0–G7)

**Deliverable Package:** `ASTRAGRON_FRONTEND_V7_CLOSURE_CODEX_READY.zip`  
**Branch:** `feat/v7-final-release-closure`  
**Acceptance Matrix:** `review/final-closure/ACCEPTANCE_MATRIX.csv` (`53/53 PASS`)

---

## 1. Executive Summary

All **8 Release Gates (`G0`–`G7`)** and **53 Acceptance Criteria (`AC-001`–`AC-053`)** have been completed and verified against the production build:

| Gate | Scope | Verification Result | Primary Evidence |
| :--- | :--- | :--- | :--- |
| **G0** | Baseline Preservation & 28 Protected Files | **PASS (`28/28`)** | `review/final-closure/BASELINE.json`, `review/SMART_FIELD_PROTECTED_HASHES.json` |
| **G1** | Close All 4 Playwright Failures (`P0-1`..`P0-4`) | **PASS (`54/54` E2E)** | `review/evidence/playwright-results.json` |
| **G2** | Strict Scientific Coverage & Zero Radius/Containment Inference | **PASS** | `src/server/capability-overlay-service.ts`, `tests/smart-fields-and-coverage.test.ts` |
| **G3** | FTW 2nd Edition GeoParquet Completeness, Budget & Cancellation | **PASS** | `src/server/ftw-boundary-service.ts`, `src/components/forms/smart-field-editor.tsx` |
| **G4** | Worldwide Geocoding, Provider Licensing & Farmer Workflow | **PASS** | `review/evidence/live-geocode-proof.json`, `e2e/smart-fields-coverage.spec.ts` |
| **G5** | Authoritative SHA-256 Release Manifest & Tamper Tests | **PASS (`0 failed`)** | `review/12_HASHES_AND_DELIVERY_MANIFEST.json`, `review/final-closure/MANIFEST_TAMPER_TESTS.json` |
| **G6** | Codex Scientific Backend Integration Handoff Contract | **PASS** | `review/FINAL_CODEX_FRONTEND_HANDOFF.md` |
| **G7** | Full Validation Pipeline & Clean Extracted ZIP Verification | **PASS** | `96/96` Vitest, `2/2` Live Provider Vitest, `54/54` Playwright, `9/9` Static UX Gates |

---

## 2. Detailed Gate Closure Evidence

### Gate 1 — All 4 Confirmed Playwright Regressions Closed
1. **`P0-1` (WebKit `g6-integration-gates.spec.ts` recorded M14 state persistence):**
   - **Root Cause:** In `src/hooks/use-astragron-store.tsx`, `persistPrefs` relied on React state variables in its closure (`complexityMode`, `unitMode`, `datasetMode`, `reducedMotion`), which on WebKit could overwrite `datasetMode: "RECORDED_M14_RESEARCH"` in `localStorage` during rapid preference updates before route navigation from `/farm/uppsala-demo/results` to `/farm/uppsala-demo/decisions`.
   - **Fix:** Added a synchronous `prefsRef` updated atomically inside `persistPrefs` and `handleSetDatasetMode` so `localStorage` (`astragron_v6_prefs`) always retains `datasetMode: "RECORDED_M14_RESEARCH"`.
2. **`P0-2` (WebKit `smart-fields-coverage.spec.ts` `SF-1` Heilbronn autocomplete visibility):**
   - **Root Cause:** An `onFocus` `setTimeout(..., 150)` calling `scrollIntoView({ behavior: 'smooth' })` in `src/components/maps/place-search-box.tsx` interrupted WebKit input focus/fill timing.
   - **Fix:** Removed the smooth-scroll timer on focus, lowered debounce to `180ms`, called `setOpen(true)` when remote results resolve, and added explicit `aria-label={`${cand.label} — ${cand.region}`}` on each `<button role="option">`.
3. **`P0-3` & `P0-4` (Chromium & WebKit `v4-review-regressions.spec.ts` HTTP 403 imagery block -> `VECTOR_MAP` recovery):**
   - **Root Cause:** `sources['openfreemap']` is shared between `SATELLITE_HYBRID` and `VECTOR_MAP`. When `eox-sentinel2` and `nasa-blue-marble` returned HTTP 403 in `SATELLITE_HYBRID`, `openfreemap` vector tiles had already loaded. Switching to `VECTOR_MAP` via `map.setStyle` reused the loaded `openfreemap` source without re-emitting tile load events, leaving `tileStatus` stuck at `REMOTE_LOADING`.
   - **Fix:** Added `vectorTilesLoadedRef` and `vectorTileErrorsRef` in `src/components/maps/maplibre-globe-canvas.tsx` to track `openfreemap` independently of raster satellite tiles. Switching to `VECTOR_MAP` immediately transitions to `LIVE_REMOTE_AND_VECTOR` when `openfreemap` is loaded (and re-syncs all GeoJSON sources so field geometry and center are preserved), or degrades honestly to `VECTOR_LOCAL_OFFLINE` (`FALLBACK_ONLY`) if `tiles.openfreemap.org` is also unreachable.

### Gate 2 — Zero Radius or Polygon-Containment Eligibility Inference
- Removed `BENCHMARK_MATCH_RADIUS_KM = 5.0` and `inputPolys.some((p) => booleanPointInPolygon(bPt, p))` from `src/server/capability-overlay-service.ts`.
- Verified via unit tests (`tests/smart-fields-and-coverage.test.ts`) that coordinates `1.1–2.2 km` from Uppsala (`[17.65, 59.86]`), Nyeri (`[36.96, -0.43]`), Wagga Wagga (`[147.37, -35.12]`), Svalbard (`[15.63, 78.22]`), and Atlantic (`[-30.02, 45.02]`), as well as custom polygons enclosing Uppsala or Nyeri benchmark points, all return `UNKNOWN_UNASSESSED` (`allowsFarmSave: true`, `allowsAnalysisAction: false`).

### Gate 3 — FTW 2nd Edition GeoParquet Completeness & Cancellation
- Expanded `querySuggestedFieldBoundaries` (`src/server/ftw-boundary-service.ts`) with `detailedStatus` (`FOUND`, `NO_MATCH_AFTER_COMPLETE_SEARCH`, `SEARCH_INCOMPLETE_LIMIT`, `UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`, `COVERAGE_UNKNOWN`, `INVALID_RESULT`) and rich `queryMeta` (`totalMatchingRowGroups`, `scannedRowGroups`, `candidateBboxHits`, `scannedCandidates`, `searchExhaustive`, `attemptedZones`, `coverageDataExists`, `cacheHit`).
- Added user-triggered cancellation (`data-testid="cancel-ftw-suggestion-btn"`) and automatic abort on `Draw Manually` in `src/components/forms/smart-field-editor.tsx`.
