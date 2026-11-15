# 05 — Fail-Closed Server Geocoder Security, Globe & Coordinate Precision

## 1. Server Geocoder Bridge (`src/server/geocode-service.ts`, `/api/geocode`)
- **Default Fail-Closed State:** Unconfigured server returns HTTP `503` with `{ "status": "GEOCODER_NOT_CONFIGURED" }`; Explorer stays fully functional via local presets, decimal coordinates, DMS input, GeoJSON polygon upload, and browser geolocation.
- **No Public Nominatim Autocomplete:** Playwright request monitoring verified `externalNominatimRequests = []` across `/explore` (`e2e/g6-integration-gates.spec.ts`).
- **Security Controls (`tests/g4-geocoder-security.test.ts`, `7/7` PASS):**
  - SSRF protection restricts upstream requests to explicit fixed HTTPS provider hosts (`OPENCAGE`, `LOCATIONIQ`, `PHOTON_SELF_HOSTED`), rejecting private IPs, file/http schemes, and arbitrary redirects.
  - Enforces bounded timeouts, explicit `User-Agent`, query length/rate limits, and strips sensitive precision telemetry.
  - *Gap noted cleanly:* Live upstream third-party HTTP calls were tested via mocked `fetch` in Vitest, not against a billed external API key (`GEOCODER_NOT_CONFIGURED`).

## 2. 3D Globe, Imagery Resiliency & Geospatial Precision
- **Live 3D Globe (`maplibre-globe-canvas.tsx`):** Preserves MapLibre 3D globe orbital view, multi-scale zoom presets (`Orbit`, `Basin`, `Local`, `Field`), polygon vertex editing (`zoom >= 8.0`), and offline CC0 Natural Earth vector fallback.
- **Outage & WebGL Fallback:** Simulated HTTP `403` imagery block recovers cleanly to `VECTOR_MAP` (OpenFreeMap / offline fallback); WebGL failure `?mapFallback=1` renders fail-closed 2D Natural Earth view cleanly (`e2e/v4-review-regressions.spec.ts`, `e2e/astragron-journey.spec.ts`).
- **Coordinate Integrity:** Signed negative DMS parsing (`-17° 30' 00"` -> `-17.5°`), GeoJSON winding/Polygon upload, antimeridian handling (`Taveuni`), and longitude-first coordinate order pass `tests/v4-precision-gates.test.ts` (`6/6`) and `e2e/v5-acceptance-gates.spec.ts`.
