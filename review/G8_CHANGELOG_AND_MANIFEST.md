# G8 — Changelog, Integrity Verification & Rollback Manifest

## 1. Git Branch & Checkpoint Commits
- **Workspace:** `C:\Users\HP\.gemini\antigravity\brain\3ac899d3-46e0-4094-ad7f-0b55172ca787\scratch\astragron_farmer_first\FARMER_FIRST_WORK`
- **Branch:** `feat/smart-fields-live-closure`
- **Parent Baseline Commit:** `4857077` (`feat(smart-fields): complete P0-P8 smart fields, capability overlay, cross-browser fixes, and evidence`)

## 2. Protected Scientific & Hero Files Verification (`28/28 PASS`)
All 28 protected files listed in `review/SMART_FIELD_PROTECTED_HASHES.json` were verified byte-for-byte via SHA-256 in `review/evidence/protected-hashes-verification.json`:
- `verifiedCount`: `28 / 28`
- `failedCount`: `0`

## 3. Summary of Key Files Added / Updated in `feat/smart-fields-live-closure`
1. `src/server/ftw-boundary-service.ts` & `app/api/field-boundaries/suggest/route.ts`:
   - Implemented real HTTP Range GeoParquet point-in-field discovery (`FTW_2E_HTTP_RANGE_PARQUET`) against `https://data.source.coop/ftw/global-data-2e/vector/2025/zone={zz}/utm{zz}.parquet` using `hyparquet` and `hyparquet-compressors`.
   - Added bounded Range fetch guard (allowing `HEAD` content-length discovery while capping `GET` range slices at 24 MB), 2-concurrency request queue with retry, row-group bbox pruning, single-row candidate decoding, and 24 MB slice caching.
   - Separated `geometryPassedLocalChecks` from `sourceVerifiedComplete` and exposed uncalibrated `rawModelScore` (`0–100`) with `scoreSemantics: 'UNRECALIBRATED_MEAN_MODEL_FIELD_PROBABILITY_X100'`.
2. `src/server/geocode-service.ts`, `src/adapters/geocoding-provider.ts`, `app/api/geocode/route.ts`, `src/components/maps/place-search-box.tsx`:
   - Added multi-provider geocoding proxy supporting commercial SLA endpoints (`Geoapify`, `MapTiler`, generic) plus live keyless fallback (`Open-Meteo` `CC BY 4.0` + `Photon` `ODbL`), token-level fallback for street/postcode queries, coordinate jump detection, SSRF guard, Nominatim block, rate limiting, and LRU cache.
3. `src/domain/capability-overlay.ts`, `src/server/capability-overlay-service.ts`, `app/api/capabilities/site-check/route.ts`, `src/components/maps/maplibre-globe-canvas.tsx`:
   - Removed all synthetic hexagonal circles and polar strip overlays; rendered the 19 M4/M14 benchmark sites strictly as `Point` markers; kept unassessed global land neutral (`UNKNOWN_UNASSESSED`); validated remote red polygons with `RemoteFootprintSchema` and Turf topology checks.
4. `src/components/forms/farm-setup-wizard.tsx` & `src/components/forms/smart-field-editor.tsx`:
   - Simplified Step 1 mobile layout (`390x844`) so `Farm name`, `PlaceSearchBox`, and the `MapLibre` 3D Earth canvas appear immediately above the fold.
   - Simplified Step 2 primary actions to `Suggest Field` and `Draw Manually`, moving secondary tools (`Editable Rectangle`, `Walk Boundary (GPS)`, `Import Boundary`) into `More options`.
   - Decoupled `fieldInteriorPin` from farm center pin so clicking inside a crop parcel updates the FTW query pin independently.
5. `src/lib/geometry-validation.ts`:
   - Scoped the heuristic `clampedEdges >= 2` tile-clipping check in `detectClippedTileEdgeGeometry` to cases where a `tileOrRequestBbox` is supplied so uncut raster-stepped FTW 2nd Edition GeoParquet polygons (`32UNV_0_0-139038`) are not falsely rejected.
6. `scripts/live-providers-verification.test.ts`, `scripts/verify-live-browser.mjs`, `scripts/populate-acceptance-matrix.mjs`:
   - Added unmocked live verification scripts and generated `review/evidence/live-geocode-proof.json`, `review/evidence/live-ftw-geoparquet-proof.json`, `review/evidence/live-browser-network-log.json`, `review/screenshots/live_after/01..06_*.png`, `review/screenshots/live_after/LIVE_CONTACT_SHEET.jpg`, and `review/recordings/live_smart_fields_flow.webm`.

## 4. Rollback Instructions
To revert to the pre-closure Farmer-First Smart Fields baseline at any time without losing history:
```bash
git checkout 4857077
```
Or to inspect the full diff between the baseline and the live closure branch:
```bash
git diff 4857077..feat/smart-fields-live-closure
```
