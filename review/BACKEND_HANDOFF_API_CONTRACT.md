# ASTRAGRON Backend & Assistant Handoff API Contract

**Frontend Release:** ASTRAGRON Smart Fields & Globe Coverage (`feat/smart-fields-coverage`)  
**Baseline Commit:** `6d9285e` (`feat/farmer-first-ux`)  
**Typed Contracts:** [src/domain/farmer-ux-contracts.ts](../src/domain/farmer-ux-contracts.ts), [src/domain/capability-overlay.ts](../src/domain/capability-overlay.ts), [src/domain/contracts.ts](../src/domain/contracts.ts)  
**Server Services:** [src/server/capabilities-service.ts](../src/server/capabilities-service.ts), [src/server/geocode-service.ts](../src/server/geocode-service.ts), [src/server/ftw-boundary-service.ts](../src/server/ftw-boundary-service.ts), [src/server/capability-overlay-service.ts](../src/server/capability-overlay-service.ts), [src/server/analysis-job-store.ts](../src/server/analysis-job-store.ts), [src/server/ssrf-guard.ts](../src/server/ssrf-guard.ts)

All backend integrations route strictly through Next.js App Router API routes (`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`). No secret API key is ever exposed via `NEXT_PUBLIC_*` environment variables, and all unconfigured or unreachable upstream services fail closed with explicit machine status codes.

---

## 1. Environment Variables Summary (`.env.example`)

| Variable | Effect When Set (Paired with HTTPS + Host Allowlist) | Default Unset Behavior |
|---|---|---|
| `ASTRAGRON_GEOCODER_PROVIDER` | `auto`, `geoapify`, `maptiler`, or `generic` | `auto` (infers from hostname) |
| `ASTRAGRON_GEOCODER_ENDPOINT` | Enables server-side worldwide search on `GET /api/geocode` | Returns `200 OK` with `status: "GEOCODER_NOT_CONFIGURED"` and empty `results: []` |
| `ASTRAGRON_GEOCODER_ALLOWED_HOSTS` | Mandatory comma-separated hostname allowlist (SSRF guard) | Empty allowlist fails closed (`403 FORBIDDEN_ENDPOINT`) |
| `ASTRAGRON_GEOCODER_API_KEY` | Injected server-side as `apiKey` / `key` / Bearer token | Omitted cleanly; key never reaches browser bundle |
| `ASTRAGRON_FTW_SUGGEST_ENDPOINT` | Enables FTW parcel polygon suggestions on `GET /api/field-boundaries/suggest` | Returns `200 OK` with `status: "UNAVAILABLE"`, `providerConfigured: false`, `suggestions: []` |
| `ASTRAGRON_FTW_ALLOWED_HOSTS` | Mandatory comma-separated hostname allowlist (SSRF guard) | Empty allowlist fails closed (`403 ERROR`) |
| `ASTRAGRON_FTW_API_KEY` | Bearer authorization header for FTW endpoint | Optional |
| `ASTRAGRON_FTW_DATASET_NAME`, `ASTRAGRON_FTW_DATASET_YEAR` | Attribution metadata overrides (`Fields of The World (FTW)`, `2025`) | Defaults to `Fields of The World (FTW)`, `2025` |
| `ASTRAGRON_BACKEND_URL` | Verified asynchronously via `/health` in `resolveServerCapabilities()` before marking `liveFarmAnalysis.enabled = true`; required for `createAndDispatchAnalysisJob()` | `liveFarmAnalysis.enabled = false` (`RECORDED_OR_DEMO_ONLY` / `BACKEND_UNREACHABLE`); custom farms get `COMPLETED_LIMITED` or fail closed |
| `ASTRAGRON_CAPABILITY_FOOTPRINTS_ENDPOINT` | Appends validated GeoJSON Polygon/MultiPolygon capability zones to `GET /api/capabilities/footprints` | Falls back cleanly to `LOCAL_SCIENTIFIC_REGISTRY` |
| `ASTRAGRON_CAPABILITY_ALLOWED_HOSTS` | Hostname allowlist for remote capability footprint feed | Unverified URLs fail closed to local registry |
| `ASTRAGRON_CHAT_ENDPOINT` | Enables scoped `POST /api/reports/[reportId]/chat` forwarding | Returns HTTP `503 CHAT_NOT_CONNECTED` with `answer: null`; UI composer locked |
| `ASTRAGRON_CLOUD_STORAGE_URL` | Enables `cloudFarmStorage` capability metadata | `LOCAL_DEVICE_ONLY` browser persistence + checksum JSON backup |

---

## 2. Worldwide Geocoder Proxy (`GET /api/geocode?q=<query>`)

- **Handler:** [app/api/geocode/route.ts](../app/api/geocode/route.ts) -> `performServerGeocodeSearch()` ([src/server/geocode-service.ts](../src/server/geocode-service.ts))
- **Security Controls (`src/server/ssrf-guard.ts`):**
  - Requires `https:` scheme; rejects embedded credentials, loopback/RFC1918/link-local IPs (`127.0.0.1`, `169.254.169.254`, etc.), and public OpenStreetMap Nominatim (`nominatim.openstreetmap.org`).
  - Uses `redirect: 'error'`, `5000 ms` AbortController timeout, per-IP sliding window rate limiter (`20` requests per `60,000 ms`), HTML/control-character sanitization (`sanitizeRemoteText()`), and strict output validation (`StrictPlaceOutputSchema`).
- **Statuses Returned:** `'OK' | 'GEOCODER_NOT_CONFIGURED' | 'INVALID_QUERY' | 'FORBIDDEN_ENDPOINT' | 'RATE_LIMITED' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_ERROR' | 'INVALID_PROVIDER_RESPONSE'`
- **Normalized Result Shape:** `{ id, label, shortName, country, countryCode?, region, placeType?, bbox?, lon, lat, source: 'CONFIGURED_GEOCODER_API' }` (at most 8 results).

---

## 3. Intelligent Field Boundary Suggestion (`GET /api/field-boundaries/suggest?lon=<num>&lat=<num>&year=<yyyy>`)

- **Handler:** [app/api/field-boundaries/suggest/route.ts](../app/api/field-boundaries/suggest/route.ts) -> `querySuggestedFieldBoundaries()` ([src/server/ftw-boundary-service.ts](../src/server/ftw-boundary-service.ts))
- **Validation & Anti-Fragment Safeguards:**
  - Parses finite WGS84 `lon` / `lat` (and optional integer `year` `2015..2035`), returning `400 ERROR` on malformed coordinates.
  - If `ASTRAGRON_FTW_SUGGEST_ENDPOINT` is unset, returns `200 OK` with `status: 'UNAVAILABLE'`, `providerConfigured: false`, `suggestions: []` (UI never invents fake AI outlines).
  - Upstream GeoJSON polygons are verified via `validatePolygonGeometry()`, checked for point containment (`polygonContainsPoint()`), and screened against `tileBbox` edge clipping (`detectClippedTileEdgeGeometry()`) before returning. Rejected fragments increment `rejectedFragmentsCount`.
- **Attribution & Disclaimer Returned on Every Payload:**
  - `attribution`: `"Fields of The World (FTW) / Source Cooperative · Licensed under CC BY 4.0"`
  - `disclaimer`: `"Satellite-estimated boundary · inspect against imagery and adjust corners before saving."`

---

## 4. Scientifically Grounded Capability Overlay & Site Check

### `GET /api/capabilities/footprints`
- **Handler:** [app/api/capabilities/footprints/route.ts](../app/api/capabilities/footprints/route.ts) -> `getVerifiedCapabilityFootprints()`
- **Statuses (`AnalysisCapabilityStatus`):** `SUPPORTED_VERIFIED | PARTIAL_OR_CONDITIONAL | CONFIRMED_UNSUPPORTED | UNKNOWN_UNASSESSED | TEMPORARILY_UNAVAILABLE | RESEARCH_ONLY`
- **Guarantees:** Never paints unassessed global croplands or M14 `RESEARCH_ONLY` regions with a blanket red globe overlay. Local verified footprints cover only documented M4/M14 registries (`ZONE_UPPSALA_M14_ARCHIVE` as `RESEARCH_ONLY`, `ZONE_NYERI_BENCHMARK_UNQUALIFIED`, `ZONE_WAGGA_BENCHMARK_UNQUALIFIED`, `ZONE_HIGH_ARCTIC_PERMAFROST` `>= 74° N`, `ZONE_ANTARCTIC_ICE_CAP` `<= -66° S`, `ZONE_NORTH_ATLANTIC_MARINE_REF`).

### `POST /api/capabilities/site-check`
- **Handler:** [app/api/capabilities/site-check/route.ts](../app/api/capabilities/site-check/route.ts) -> `evaluateSiteCapabilityCheck()`
- **Request Schema:** `{ coordinates: [lon, lat], geometry?: Polygon | MultiPolygon | null, farmId?: string, isUserModifiedDraft?: boolean }` (`400` on invalid JSON/coordinates).
- **Guarantees:**
  - Uncovered terrestrial locations return `status: 'UNKNOWN_UNASSESSED'`, `allowsFarmSave: true`.
  - Polygons straddling `CONFIRMED_UNSUPPORTED` / `RESEARCH_ONLY` edges or user-modified drafts in Uppsala return `status: 'PARTIAL_OR_CONDITIONAL'` (`overlapsBoundary` accurately evaluated via `@turf/boolean-intersects` + `@turf/boolean-within`).
  - `allowsFarmSave` is unconditionally `true` (saving fields is never blocked even in red zones).

---

## 5. System Capabilities, Analysis Jobs, Binary PDF & Scoped Assistant

- **`GET /api/capabilities` ([app/api/capabilities/route.ts](../app/api/capabilities/route.ts)):** Runs `resolveServerCapabilities()`, asynchronously verifying upstream `/health` when `ASTRAGRON_BACKEND_URL` is set so unreachable endpoints report `liveFarmAnalysis.enabled = false` (`mode: 'BACKEND_UNREACHABLE'`) instead of falsely reporting connected.
- **`POST /api/farms/[farmId]/analyses` & `GET / DELETE /api/analyses/[jobId]`:** Validated against `AnalysisJobTriggerRequestSchema` (`409` on `farmId` mismatch). Without live backend HTTP transport, custom drafts return `COMPLETED_LIMITED` (`ANALYSIS_NOT_RUN_FOR_INPUT_REVISION`); failed live dispatch transitions immediately to `FAILED` (`BACKEND_NOT_CONNECTED`) instead of leaving a dangling `QUEUED` job.
- **`POST /api/reports/pdf` ([app/api/reports/pdf/route.ts](../app/api/reports/pdf/route.ts)):** Validates `ReportEnvelopeSchema` and returns deterministic `%PDF-1.4` bytes via `buildReportPdfBytes()`, now embedding scaled vector field outlines (`re B` / `h B` operators) traced directly from `fieldGeometries`.
- **`POST /api/reports/[reportId]/chat` ([app/api/reports/[reportId]/chat/route.ts](../app/api/reports/[reportId]/chat/route.ts)):** Enforces `ChatProxyRequestSchema`, `409 REPORT_CONTEXT_MISMATCH` on `reportId` discrepancy, and `503 CHAT_NOT_CONNECTED` (`answer: null`) when `ASTRAGRON_CHAT_ENDPOINT` is unset.
