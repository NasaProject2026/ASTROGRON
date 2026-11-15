# ASTRAGRON Smart Fields & Globe Coverage — Geodata Licenses, Attribution & Usage Compliance

**Branch:** `feat/smart-fields-coverage`  
**Verified Baseline Commit:** `6d9285e` (`feat/farmer-first-ux`)  
**Scope:** Strictly frontend visualization, offline geometry checks, and server-proxied adapters; **no publication, SaaS hosting, or endorsement claim is made or implied**.

---

## 1. Active Runtime Basemap, Satellite Imagery & Elevation/Mask Sources

| Provider / Dataset | Identifier (`map-providers.ts`) | License / Usage Terms | Key Required | Native Zoom | Integrity & Honest Scope Notes |
|---|---|---|---|---|---|
| **NASA GIBS Blue Marble Next Generation** | `nasa-gibs-blue-marble` | NASA Earthdata Open Data (Public Domain) | No | `z0–z8` | Used exclusively at orbital zoom for Earth globe continuity. Credited without NASA insignia or endorsement (`README.md`). |
| **EOxCloudless Sentinel-2 2016 Global Mosaic** | `eox-s2cloudless-2016` | **CC BY 4.0** (EOX IT Services GmbH) | No | `z0–z14` | Historical 2016 cloudless composite confirmed in EOX FAQ & WMTSCapabilities; **not** real-time imagery and carries **no uptime SLA**. |
| **OpenFreeMap / OpenMapTiles / OpenStreetMap** | `openfreemap-vector` | OpenFreeMap / OpenMapTiles / **ODbL** (`© OpenStreetMap contributors`) | No | `z0–z14` | Vector borders, roads, glyphs, sprites, and failover vector layer when raster satellite requests hit HTTP 403/429 or timeout. |
| **Natural Earth `1:110m` Admin 0 Countries** | `natural-earth-110m` (`/geodata/ne_110m_admin_0_countries.geojson`) | **CC0 1.0 Public Domain** | No | `z0–z6` | Bundled (`177` sovereign boundaries) locally so globe and 2D fallback map remain operational when external internet is offline or blocked. |
| **NASA POWER / GPM IMERG / SMAP L4 (M4 Reference)** | `NASA_POWER_CLIMATE` (and M4 catalog in `src/data/m4-global/`) | NASA Earthdata Open Data (Public Domain) | No (frozen M4 receipts bundled) | Grid (`~0.5° × 0.625°` / satellite granules) | Protected SHA-256 verified M4 coverage receipts only; regional EO coverage metadata never implies field-level agronomic qualification. |

---

## 2. Optional Server-Only Geocoding & Field Boundary Providers

All optional third-party endpoints are executed **strictly server-side** via Next.js Route Handlers and guarded by `src/server/ssrf-guard.ts` (`validateAllowlistedHttpsUrl()` + `isPrivateOrForbiddenHost()`):

1. **Public OpenStreetMap Nominatim (`nominatim.openstreetmap.org`) — Explicitly Blocked for Autocomplete**
   - `src/server/ssrf-guard.ts` (`BLOCKED_OSM_HOSTS`, `blockPublicOsmNominatim: true`) permanently blocks `nominatim.openstreetmap.org`, `openstreetmap.org`, `www.openstreetmap.org`, and subdomains in `validateGeocoderEndpointUrl()` and `validateAllowlistedHttpsUrl()`.
   - Reason: OpenStreetMap Nominatim's acceptable use policy explicitly prohibits interactive search-as-you-type autocomplete on the shared public instance (`PUBLIC_OSM_NOMINATIM_BLOCKED`).
2. **Commercial / Self-Hosted Geocoding Proxy (`GET /api/geocode`)**
   - Supports `ASTRAGRON_GEOCODER_PROVIDER=auto|geoapify|maptiler|generic` (`src/server/geocode-service.ts`).
   - Normalized providers: **Geoapify** (`api.geoapify.com`) and **MapTiler** (`api.maptiler.com`), plus generic GeoJSON FeatureCollection proxies.
   - Operator must configure HTTPS endpoint, explicit hostname allowlist (`ASTRAGRON_GEOCODER_ALLOWED_HOSTS`), and server secret (`ASTRAGRON_GEOCODER_API_KEY`). Credentials never leave the server process (`next.config` client bundle contains zero secrets).
3. **Fields of The World (FTW) / Source Cooperative (`GET /api/field-boundaries/suggest`)**
   - Optional external inference/vector parcel endpoint (`ASTRAGRON_FTW_SUGGEST_ENDPOINT`, default unset/unavailable).
   - **License:** **CC BY 4.0** (`"Fields of The World (FTW) / Source Cooperative · Licensed under CC BY 4.0"`).
   - **Non-Cadastral Safeguard:** Responses carry explicit metadata (`sourceDataset`, `sourceYear`, `license: "CC BY 4.0"`, `completenessVerified: true`, `modelConfidence`) and mandatory user-facing disclaimer:  
     `"Satellite-estimated boundary · inspect against imagery and adjust corners before saving."`
   - Clipped rectangular tile fragments (matching `tileBbox` / `clippedTile` checks via `detectClippedTileEdgeGeometry()`) and polygons not containing the clicked point (`polygonContainsPoint()`) are dropped automatically before display.

---

## 3. Proprietary User Data, Local Boundaries & Security Controls

- **Zero Server Telemetry Leakage:** Drawn boundaries (`USER_DRAWN`), rectangle approximations (`USER_RECTANGLE_APPROX`), GPS walks (`USER_GPS_TRACE`), and uploaded KML/GPX/GeoJSON boundaries (`USER_IMPORT`) remain local to the user's browser storage (`Saved on this device`) unless a farmer explicitly triggers an export or future connected backend analysis.
- **XXE & Script Sanitization:** XML/KML/GPX imports are parsed defensively by `importFieldBoundaryText()`, `parseKmlToFieldGeometry()`, and `parseGpxToFieldGeometry()` in `src/lib/geometry-validation.ts`, rejecting `<!DOCTYPE>`, `<!ENTITY>` declarations, oversized payloads (`> 262,144` bytes), self-intersecting rings (`@turf/kinks`), and excessive vertex counts (`> 2,048`). Remote text fields pass through `sanitizeRemoteText()` (`src/server/ssrf-guard.ts`).
- **Research Publication Hold:** The bundled M14 Uppsala corpus (`src/data/m14-recorded/*`) and M4 Global Coverage corpus (`src/data/m4-global/*`) remain read-only (`28/28` protected files SHA-256 unchanged from baseline `6d9285e`).
