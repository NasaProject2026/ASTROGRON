# ASTROGRON V7 — Final Frontend Release-Closure Package (Codex-Ready)

**Package:** `ASTROGRON_FRONTEND_V7_CLOSURE_CODEX_READY.zip`  
**Branch:** `feat/v7-final-release-closure`  
**Protected Baseline Verification:** `28/28 PASS` (`review/SMART_FIELD_PROTECTED_HASHES.json`)

---

## 1. Quick Start (Local Development & Production Verification)

```bash
# 1. Install dependencies
npm install

# 2. Verify TypeScript, ESLint, Offline UX Gates, and Unit Tests (96/96 Vitest)
npx tsc --noEmit
npm run lint
node scripts/mobile-ux-offline-gates.mjs
npx vitest run

# 3. Verify Live Unmocked Providers (Open-Meteo + Photon + FTW 2nd Edition GeoParquet)
npx vitest run --config scripts/vitest.live.config.ts

# 4. Build & Start Production Server
npm run build
npm run start

# 5. Verify Authoritative SHA-256 Release Manifest
node scripts/verify-manifest.mjs
```

---

## 2. What Was Closed in V7 Final Release Closure (Gates G0–G7)

### Gate 0 — Baseline & Protected Scientific Integrity (`28/28 PASS`)
- Verified all 28 protected scientific and visual baseline files in `review/SMART_FIELD_PROTECTED_HASHES.json` remain bit-for-bit identical before and after all changes.
- Recorded initial baseline snapshot in `review/final-closure/BASELINE.json`.

### Gate 1 — All 4 Historical Playwright Failures Closed
1. **`P0-1` (WebKit M14 Recorded State Persistence across Route Navigation):** Fixed a stale React closure race in `src/hooks/use-astrogron-store.tsx` (`persistPrefs`) using a synchronous `prefsRef` so `datasetMode: "RECORDED_M14_RESEARCH"` is never overwritten in `localStorage` when navigating from `/farm/uppsala-demo/results` to `/farm/uppsala-demo/decisions` on WebKit.
2. **`P0-2` (WebKit Autocomplete Option Visibility on `/farm/new`):** Removed the delayed `onFocus` `scrollIntoView({ behavior: 'smooth' })` timer in `src/components/maps/place-search-box.tsx` that interrupted WebKit `fill()`, reduced debounce to `180ms`, ensured `setOpen(true)` fires on remote candidates arrival, and added explicit accessible `aria-label` attributes on each `<button role="option">`.
3. **`P0-3` & `P0-4` (Satellite 403 -> Vector Map Recovery in Chromium & WebKit):** Tracked `openfreemap` vector source loading (`vectorTilesLoadedRef`) and errors (`vectorTileErrorsRef`) independently from satellite raster tiles in `src/components/maps/maplibre-globe-canvas.tsx`. Switching from `SATELLITE_HYBRID` (with 403 blocked raster tiles) to `VECTOR_MAP` immediately transitions to `LIVE_REMOTE_AND_VECTOR` when vector tiles are loaded, or falls back honestly to `VECTOR_LOCAL_OFFLINE` (`FALLBACK_ONLY`) if `tiles.openfreemap.org` is also blocked/offline, while preserving selected field geometry and map center.

### Gate 2 — Strict Scientific Coverage & Zero Radius/Containment Inference
- Removed `BENCHMARK_MATCH_RADIUS_KM = 5.0` and `booleanPointInPolygon` benchmark inheritance from `src/server/capability-overlay-service.ts`.
- Only exact recorded benchmark identity (`farmId === 'uppsala-demo'` with `isUserModifiedDraft === false` at `[17.6389, 59.8586]`), exact benchmark coordinates (`<= 0.0005°`), or schema-validated remote capability polygons (`ASTROGRON_CAPABILITY_FOOTPRINTS_URL`) confer `RESEARCH_ONLY`, `SUPPORTED`, or `CONFIRMED_UNSUPPORTED` status.
- Nearby custom farms (`0.5–4 km` from Uppsala, Nyeri, Wagga Wagga, Svalbard, or Atlantic) and large polygons enclosing a benchmark point fail closed to `UNKNOWN_UNASSESSED` (`allowsFarmSave: true`, `allowsAnalysisAction: false`).

### Gate 3 — FTW 2nd Edition GeoParquet Completeness, Performance & Cancellation
- Distinguished `FOUND`, `NO_MATCH_AFTER_COMPLETE_SEARCH`, `SEARCH_INCOMPLETE_LIMIT`, `UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`, `COVERAGE_UNKNOWN`, and `INVALID_RESULT` in `src/server/ftw-boundary-service.ts`.
- Budget-limited GeoParquet scans (`!searchExhaustive`) return `status: "SEARCH_INCOMPLETE_LIMIT"` with `totalMatchingRowGroups`, `scannedRowGroups`, `candidateBboxHits`, `scannedCandidates`, `attemptedZones`, and `searchExhaustive: false` — never misreporting an incomplete scan as a conclusive no-match.
- Added user cancellation (`Cancel Search` button `data-testid="cancel-ftw-suggestion-btn"` + automatic abort when switching to `Draw Manually`) and indeterminate scan phase messaging in `src/components/forms/smart-field-editor.tsx`.

### Gate 4 — Worldwide Geocoding, Provider Licensing & Farmer Workflow
- Primary keyless geocoding via Open-Meteo (`CC BY 4.0`, non-commercial) with automatic fallback to Photon (`ODbL`, public demo) and configurable enterprise geocoder (`ASTROGRON_GEOCODER_URL`).
- Selecting a place re-centers the map without wiping existing confirmed field geometry, and any geometry or agronomic edit updates `farm.inputRevision` so prior reports are immediately badged `STALE`.

### Gate 5 — Authoritative Release Manifest & Tamper Verification
- Added `scripts/generate-release-manifest.mjs` to generate `review/12_HASHES_AND_DELIVERY_MANIFEST.json`, `review/SMART_FIELDS_SHA256_MANIFEST.json`, and `review/V7_RELEASE_SHA256_MANIFEST.json` at the end of the pipeline.
- Verified `node scripts/verify-manifest.mjs` passes with `0 failed` and documented tamper tests (modified byte, missing file, path traversal `../`) in `review/final-closure/MANIFEST_TAMPER_TESTS.json`.

### Gate 6 — Codex Backend Integration Handoff
- Documented complete request/response schemas, environment variables, 5-state qualification matrix, and canonical site payloads in `review/FINAL_CODEX_FRONTEND_HANDOFF.md`.

---

## Open-Source License (NASA Space Apps Challenge)

This project is Open Source under the **MIT License** for the **NASA Space Apps Challenge**.
See [`LICENSE`](./LICENSE) for the full license text (`Copyright (c) 2026 ASTROGRON Team - NASA Space Apps Challenge`).

