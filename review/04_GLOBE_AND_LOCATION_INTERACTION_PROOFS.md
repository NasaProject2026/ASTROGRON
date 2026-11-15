# 04 — Interactive 3D Globe & Location Workflow Proofs

## 1. Real Map Engine & Multi-Provider Layer Architecture
The `/explore` workspace uses real **MapLibre GL JS `6.18.0`** (`projection: 'globe'`) inside `src/components/maps/maplibre-globe-canvas.tsx` paired with explicit provider provenance (`src/components/maps/map-providers.ts`):
- **Satellite Historical Mosaic (`eox-s2cloudless-2016`):** Sentinel-2 cloudless `2016` global mosaic (`CC BY 4.0`, `maxNativeZoom: 14`). Explicitly labeled `"Historical Imagery: EOxCloudless 2016 (CC BY 4.0 mosaic) ... — not live today's pixels"` so users never mistake a 2016 reference mosaic for today's satellite overpass.
- **Planetary Context (`nasa-gibs-blue-marble`):** NASA EOSDIS GIBS Blue Marble Next Generation (`maxNativeZoom: 8`, Public Domain, non-endorsement notice).
- **Vector Borders & Labels (`openfreemap-vector`):** OpenFreeMap Planet vector tiles (`© OpenFreeMap · OpenStreetMap contributors ODbL`, zero API keys required).
- **Offline / Fail-Closed Vector Layer (`natural-earth-world.geojson` & `ne_110m_admin_0_countries.geojson`):** `CC0 1.0` local GeoJSON enabling both **3D WebGL offline globe** (during external tile outages) and **2D SVG Natural Earth fallback** (when WebGL is unavailable, Save-Data is active, or `?mapFallback=1` is requested).

---

## 2. Production Tile Network Verification (`review/screenshots/tile-network-proof.json`)
Captured live during the final `task` production Playwright run (`2026-11-13T12:31:58.684Z`):
- **Total HTTP 200 Tile / Vector Responses Captured:** `84`
- **Breakdown by Provider:**
  - `nasaGibsBlueMarble`: `44` HTTP 200 responses
  - `openfreemap`: `25` HTTP 200 responses
  - `eoxS2Cloudless2016`: `15` HTTP 200 responses

---

## 3. Verified Real-Browser Location & Polygon Interactions
All capabilities below passed in BOTH **Chromium (`desktop-chrome`)** and **WebKit (`webkit-desktop`)** in `e2e/astragron-journey.spec.ts`, `e2e/v4-review-regressions.spec.ts`, and `e2e/v5-acceptance-gates.spec.ts`:
1. **Pointer Drag & Zoom Manipulation:** Mouse drag across the globe canvas and zoom-in/out controls mutate live camera center/zoom state (`z1.45` -> basin/local/field scales).
2. **Presets, Fly-To & Text Search:** Selecting `Uppsala`, `Nyeri (KE)`, `Wagga (AU)`, or typing text queries in the local labeled 16-site gazetteer (`Search site or lon, lat...`) smoothly flies the 3D globe and synchronizes site context (`review/screenshots/02_explore_globe_orbital_1440.png` -> `02b_explore_satellite_uppsala_1440.png`).
3. **Decimal Lon/Lat & Signed DMS Input (`G05`):** Entering negative/southern/western DMS strings (`36°56'51.4"E`, `0°25'12.4"S` or West/South cases) accurately updates `[lon, lat]` within EPSG:4326 bounds without losing sign.
4. **Browser Geolocation Consent:** Mocking browser `navigator.geolocation` permission + coordinates and clicking `Use My Location` centers the globe on the granted coordinate while cleanly keeping `FIELD_RECOMMENDATION_ELIGIBILITY: BLOCKED`.
5. **GeoJSON File Upload (`input[type="file"]`) & Polygon Editing (`G15`):**
   - Uploading a real `.geojson` polygon fixture computes valid geodesic area in hectares via `@turf/turf` and preserves vertex geometry.
   - Interactive vertex click drawing (`Draw Field Boundary` -> `Close`), undo, clear, and wizard roundtrip (`Edit 5-Step Field Setup` -> `/farm/new`) preserve active boundary state (`review/screenshots/03_explore_boundary_layers_1440.png`).
6. **Provider Failure Recovery (`G14` — HTTP 403/429/503 & Tile Outage):**
   - Intercepting external tile requests with HTTP `403` / network abort transitions seamlessly to the local Natural Earth 3D/vector fallback without blank canvas, preserving selected site & boundary (`review/screenshots/v42_explore_403_recovery_1280.png`, `17_webgl_tile_outage_natural_earth_3d_1440.png`), and clicking **Retry Online Map Imagery** restores `LIVE_REMOTE_AND_VECTOR`.
7. **WebGL Context Failure (`?mapFallback=1`):** Renders crisp interactive 2D SVG Natural Earth map with explicit reason (`review/screenshots/02c_explore_webgl_fallback_2d.png`).
8. **Mobile Explorer Priority (`G16`):** At `390x844` (`review/screenshots/13_explore_globe_mobile_390.png`), the globe sits cleanly at top-of-fold beneath a compact search/selector card with `Map view · Adjust` bottom controls and full attribution, with `0 px` horizontal overflow.
