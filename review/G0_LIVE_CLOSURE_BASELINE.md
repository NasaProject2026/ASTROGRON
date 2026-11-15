# G0 Live Closure Baseline & Protection Report

**Generated:** 2026-11-14  
**Active Workspace:** `C:\Users\HP\.gemini\antigravity\brain\3ac899d3-46e0-4094-ad7f-0b55172ca787\scratch\astragron_farmer_first\FARMER_FIRST_WORK`  
**Reference Comparison Baseline:** `C:\Users\HP\.gemini\antigravity\brain\3ac899d3-46e0-4094-ad7f-0b55172ca787\scratch\astragron_live_closure\BASELINE_REVIEW_ONLY\ASTRAGRON_FARMER_SMART_FIELD_AND_COVERAGE_FINAL_REVIEW.zip`  
**Starting Commit:** `4857077` (`feat(smart-fields): complete P0-P8 smart fields, capability overlay, cross-browser fixes, and evidence`)  
**Recovery Branch:** `feat/smart-fields-live-closure`

## Workspace Reconciliation Decision

The active workspace (`FARMER_FIRST_WORK`) was verified against the package manifest and commit history (`73073f1` -> `6d9285e` -> `4857077`). It is the newer live working repository corresponding to the reference ZIP baseline and preserves all M1–M14 scientific archives, 3D WebGL MapLibre globe, cinematic hero imagery, Farmer-First wizard, PDF export, and conversational Ask ASTRAGRON experience. No files were overwritten by the reference ZIP.

## Protected Assets & Scientific Corpus Verification

Verified SHA-256 digests against `review/SMART_FIELD_PROTECTED_HASHES.json`:
- **Protected M1–M14 & Cinematic Hero Assets:** `28 / 28` exact byte-for-byte matches (`bad: []`).
- Protected files include `src/adapters/repositories.ts`, `src/server/corpus-integrity.ts`, `src/data/generated/verified-m14-m4-snapshot.json`, all M14 recorded artifacts, and hero orbital imagery (`public/assets/*`).

## Host Environment & External Credentials Check

Checked current OS environment before making changes:
- `ASTRAGRON_BACKEND_URL`: **unset**
- `ASTRAGRON_GEOCODER_ENDPOINT` / `ASTRAGRON_GEOCODER_API_KEY`: **unset**
- `ASTRAGRON_FTW_SUGGEST_ENDPOINT`: **unset**
- `ASTRAGRON_CAPABILITY_FOOTPRINTS_URL`: **unset**
- No commercial geocoder keys (Geoapify / MapTiler / OpenCage) exist on the host.

## Scope of G0–G9 Fixes Planned on `feat/smart-fields-live-closure`

1. **G1 Worldwide Geocoding (`geocode-service.ts`, `place-search-box.tsx`, `capabilities-service.ts`, `.env.example`):**
   - Keep commercial `Geoapify` & `MapTiler` server-side adapters first-class when `ASTRAGRON_GEOCODER_ENDPOINT` + API key are set (with SSRF allowlist & `nominatim.openstreetmap.org` strictly blocked).
   - Wire genuine, keyless server-side search adapters so worldwide town/village and address/postal lookup work live out-of-the-box without leaking keys or misrepresenting non-commercial SLA tiers:
     - **Open-Meteo Geocoding API** (`https://geocoding-api.open-meteo.com/v1/search`, CC BY 4.0 non-commercial research tier, settlements/villages).
     - **Photon Community OSM Demo Server** (`https://photon.komoot.io/api/`, ODbL community demo, rate-limited + cached, street/postal support, non-SLA disclosure).
   - Keep the 16-site offline gazetteer openly labeled *"Limited offline examples (16 sites)"* and clearly document `BLOCKED_EXTERNAL` for licensed commercial SLA search when no commercial API key is supplied.
2. **G2 Real Non-Mock Full-Source FTW GeoParquet Query (`ftw-boundary-service.ts`):**
   - Inspect and integrate official **Fields of The World (FTW) 2nd Edition (`global-data-2e`)** GeoParquet files (`https://data.source.coop/ftw/global-data-2e/vector/{year}/zone={NN}/utm{NN}.parquet`, `2025`, `2024`, `2023`, `2018`) via `hyparquet` HTTP Range requests with footer metadata caching, bounded row-group pruning, full WKB -> GeoJSON Polygon/MultiPolygon decoding, `@turf/boolean-point-in-polygon`, geodesic `@turf/area`/`@turf/length` cross-check, strict vertex/ring bounds, and `sourceVerifiedComplete` + license/edition/feature-ID provenance (`ftw-s2-2025`, `CC-BY-4.0`, explicit non-calibrated `score` explanation).
   - Separate `geometryPassedLocalChecks` vs `sourceVerifiedComplete` and remove any unconditional `completenessVerified: true` / hardcoded license assumptions.
3. **G3 & G5 Editor + 390px Farmer UX:**
   - Enable independent click inside an irregular field (`fieldPin`) in `FIELD_EDITOR` mode without overwriting farm centroid `siteCoords`.
   - Clean up Step 1 & Step 2 390px mobile clutter (demote `Save Draft`, `JSON`, `Start Blank`, and secondary boundary tools into `More options`; show Farm Name, Search, Map cleanly above the fold on 390px; keep `Suggest Field` and `Draw Manually` as the two primary actions on Step 2; collapse `Evidence & limitations`).
4. **G4 Scientific Coverage Truth:**
   - Remove `makeCircleHexPolygon` synthetic circles and artificial polar latitude strips from scientific unsupported polygons.
   - Default all unassessed regions to `UNKNOWN_UNASSESSED` (`m4EarthDataCoverage: 'UNKNOWN_UNASSESSED'`, `descriptiveEvidence: 'LIMITED'`, neutral map rendering).
   - Separate M4 Earth Data vs Model Qualification vs Operational Connectivity (`allowsAnalysisAction` / `LIVE_AVAILABLE` strictly requires verified `/health` + `/capabilities` + eligible site, never `Boolean(ASTRAGRON_BACKEND_URL)`).
   - Fix recorded M14 archive note from `12` policies to `16 policies × 9 scenarios (144 cases)`.
