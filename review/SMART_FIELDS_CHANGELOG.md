# ASTRAGRON Smart Fields & Globe Coverage — Engineering & UX Changelog

**Branch:** `feat/smart-fields-coverage`  
**Base Commit:** `6d9285e` (`feat/farmer-first-ux`)  
**Protected Corpus Integrity:** `28/28` SHA-256 protected M1–M14 / hero files verified unchanged ([review/SMART_FIELD_PROTECTED_HASHES.json](SMART_FIELD_PROTECTED_HASHES.json))

---

## P1 — Worldwide Multi-Provider Geocoder Proxy & Neutral World Start

- **Server-Only Geocoder Proxy ([app/api/geocode/route.ts](../app/api/geocode/route.ts), [src/server/geocode-service.ts](../src/server/geocode-service.ts)):** Added `performServerGeocodeSearch()` normalizing `geoapify`, `maptiler`, and generic GeoJSON backends (`auto` provider inference via `resolveGeocoderProviderKind()`), `5000 ms` request timeout, `redirect: 'error'`, per-client sliding-window rate limiter (`20` requests / `60,000 ms`), strict Zod schema output (`StrictPlaceOutputSchema`), and `GEOCODER_NOT_CONFIGURED` fail-closed state when unconfigured.
- **SSRF & OSM Policy Guard ([src/server/ssrf-guard.ts](../src/server/ssrf-guard.ts)):** Added `validateAllowlistedHttpsUrl()` and `isPrivateOrForbiddenHost()`, requiring HTTPS, explicit host allowlists, non-private/non-loopback IPs, stripped control/HTML characters (`sanitizeRemoteText()`), and explicit blocking of public `nominatim.openstreetmap.org` autocomplete (`PUBLIC_OSM_NOMINATIM_BLOCKED`).
- **Farmer Search UX ([src/components/maps/place-search-box.tsx](../src/components/maps/place-search-box.tsx), [src/adapters/geocoding-provider.ts](../src/adapters/geocoding-provider.ts)):** Implemented `PlaceSearchBox` + `ServerBackedGeocodingProvider` combining `/api/geocode`, offline 16-site reference gazetteer fallback, direct decimal/DMS coordinate jump (`tryParseCoordinatePair()`), browser GPS pin, and `AbortController` stale-request cancellation.
- **Neutral World Setup Start ([src/components/forms/farm-setup-wizard.tsx](../src/components/forms/farm-setup-wizard.tsx)):** Updated `createFreshCustomFarmDraft()` to initialize at neutral coordinates `[0, 15]` (`No location chosen yet — search a place or tap the globe`) rather than inheriting Uppsala defaults.

---

## P2 — Intelligent FTW Field Boundary Suggestion Proxy

- **FTW Endpoint & Fragment Screener ([app/api/field-boundaries/suggest/route.ts](../app/api/field-boundaries/suggest/route.ts), [src/server/ftw-boundary-service.ts](../src/server/ftw-boundary-service.ts)):** Implemented `querySuggestedFieldBoundaries()` querying `ASTRAGRON_FTW_SUGGEST_ENDPOINT` through `validateAllowlistedHttpsUrl()`. When unset, returns `status: 'UNAVAILABLE'` (`providerConfigured: false`, `suggestions: []`) rather than synthesizing AI geometries.
- **Verification & CC BY 4.0 Provenance:** Filters returned GeoJSON polygons via `validatePolygonGeometry()`, `polygonContainsPoint()`, and `detectClippedTileEdgeGeometry()` (`rejectedFragmentsCount`), attaching `"Fields of The World (FTW) / Source Cooperative · Licensed under CC BY 4.0"` attribution and non-cadastral verification disclaimer before explicit `userConfirmed` acceptance.

---

## P3 — Smart Field Editor, Manual Polygons, GPS Walk & Safe Importers

- **Geodesic Geometry & Defensive Parsing ([src/lib/geometry-validation.ts](../src/lib/geometry-validation.ts)):**
  - Computes geodesic area (hectares & acres), perimeter (meters), centroid, and bounding boxes using `@turf/area`, `@turf/length`, `@turf/kinks`, and `@turf/boolean-point-in-polygon` (`computeGeodesicMetrics()`, `validatePolygonGeometry()`, `ensureClosedRing()`).
  - Supports GeoJSON (`Polygon`, `MultiPolygon` with holes, `Feature`, `FeatureCollection`), KML (`parseKmlToFieldGeometry()`), GPX (`parseGpxToFieldGeometry()`), and raw WGS84 coordinate lists (`importFieldBoundaryText()`) capped at `262,144` bytes and `2,048` vertices with `<!DOCTYPE`/`<!ENTITY>` XML XXE rejection (`rejectUnsafeXml()`).
  - Implements real GPS perimeter sample hygiene (`evaluateGpsPerimeterSample()`) rejecting coarse signals (`> 80 m`), stationary jitter (`< 2.5 m`), and extreme teleport jumps (`> 80 m/s` across `> 200 m`).
- **Interactive Polygon Studio ([src/components/forms/smart-field-editor.tsx](../src/components/forms/smart-field-editor.tsx), [src/components/maps/maplibre-globe-canvas.tsx](../src/components/maps/maplibre-globe-canvas.tsx)):**
  - Added corner-tapping draw mode, vertex dragging, midpoint insertion, vertex deletion (`Del #N (Delete selected corner vertex)` matching WCAG 2.1 SC 2.5.3), undo/redo history, quick approximate rectangle generator, live GPS walk pause/finish/edit controls, and progressive disclosure (`Other boundary ways`) preserving a uncluttered Stage 2 UI.

---

## P4 & P5 — Grounded Capability Overlay, Partial-Border Detection & Non-Blocking UX

- **Capability Status Taxonomy & Spatial Evaluation ([src/domain/capability-overlay.ts](../src/domain/capability-overlay.ts), [src/server/capability-overlay-service.ts](../src/server/capability-overlay-service.ts)):**
  - Exposed `GET /api/capabilities/footprints` and `POST /api/capabilities/site-check`.
  - Distinguishes `SUPPORTED_VERIFIED`, `PARTIAL_OR_CONDITIONAL`, `CONFIRMED_UNSUPPORTED`, `UNKNOWN_UNASSESSED`, `TEMPORARILY_UNAVAILABLE`, and `RESEARCH_ONLY`.
  - Keeps unassessed global farmland neutral (`UNKNOWN_UNASSESSED`), marks `ZONE_UPPSALA_M14_ARCHIVE` as `RESEARCH_ONLY` (turning `PARTIAL_OR_CONDITIONAL` on modified custom drafts), limits verified `CONFIRMED_UNSUPPORTED` shading strictly to documented M4/M14 benchmark & cryosphere exclusions (`ZONE_HIGH_ARCTIC_PERMAFROST >= 74° N`, `ZONE_ANTARCTIC_ICE_CAP <= -66° S`, `ZONE_NYERI_BENCHMARK_UNQUALIFIED`, `ZONE_WAGGA_BENCHMARK_UNQUALIFIED`, `ZONE_NORTH_ATLANTIC_MARINE_REF`), and detects straddling polygons via `@turf/boolean-intersects` / `@turf/boolean-within`.
- **Non-Blocking Farmer Workflow ([src/components/maps/maplibre-globe-canvas.tsx](../src/components/maps/maplibre-globe-canvas.tsx)):**
  - Positioned compact expandable toast (`data-testid="capability-unsupported-toast"`) at the bottom-left with `[Why?]` details (`max-h-[168px] overflow-y-auto`), keeping top-right overlay toggle (`toggle-capability-overlay-btn`), globe panning, and `allowsFarmSave: true` unblocked everywhere.

---

## P6 & P7 — Backend Health Truthfulness, Vector PDF Outlines & Cross-Browser Stability

- **Verified Health & Non-Dangling Jobs ([src/server/capabilities-service.ts](../src/server/capabilities-service.ts), [src/server/analysis-job-store.ts](../src/server/analysis-job-store.ts)):** `resolveServerCapabilities()` verifies `/health` asynchronously before advertising `liveFarmAnalysis.enabled = true`, and `createAndDispatchAnalysisJob()` returns `FAILED` (`BACKEND_NOT_CONNECTED`) instead of orphaned `QUEUED` jobs if HTTP dispatch fails.
- **Vector Parcel Sketch in PDF Reports & Cards ([src/lib/pdf-report.ts](../src/lib/pdf-report.ts), [src/components/farms/farm-polygon-preview.tsx](../src/components/farms/farm-polygon-preview.tsx)):** `buildFieldGeometryVectorOps()` renders WGS84 field outlines (`re B` / `h B`) inside deterministic `%PDF-1.4` exports alongside Extent labels, mirrored by `FarmPolygonPreview` SVG thumbnails on farm cards.
- **WebKit & MapLibre Robustness:** Added `AbortController` + `pagehide` fetch cancellation in [src/lib/capabilities-client.ts](../src/lib/capabilities-client.ts), [src/components/maps/earth-explorer-client.tsx](../src/components/maps/earth-explorer-client.tsx), and [src/components/forms/farm-setup-wizard.tsx](../src/components/forms/farm-setup-wizard.tsx); guarded `queryRenderedFeatures` against unloaded layers and `isDrawingMode` in [src/components/maps/maplibre-globe-canvas.tsx](../src/components/maps/maplibre-globe-canvas.tsx); added `prefsHydrated` loading guard in [app/farm/[id]/reports/page.tsx](../app/farm/[id]/reports/page.tsx).
