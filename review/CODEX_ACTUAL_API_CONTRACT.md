# ASTRAGRON V7 — Actual Source-Verified API Contract (`CODEX_ACTUAL_API_CONTRACT.md`)

**Verification Date:** 2026-11-14  
**Source Branch:** `feat/v7-codex-safe-integration` (branched from `feat/v7-final-release-closure` `21b8bfa`)  
**Derivation Method:** Reconstructed directly from Next.js App Router route handlers (`app/api/**/route.ts`), server services (`src/server/*.ts`), and Zod schemas (`src/domain/farmer-ux-contracts.ts`, `src/domain/schemas.ts`).

---

## 1. Explicit Corrections to Prior Handoff Documentation (`G1`)

The prior `review/FINAL_CODEX_FRONTEND_HANDOFF.md` contained documentation drift that conflicted with the actual source code. Every item below has been corrected and verified against the codebase:

| Drift Item in Prior Doc | Actual Source-Verified Implementation | Source File Reference |
| :--- | :--- | :--- |
| Claimed `POST /api/farms/[farmId]/jobs` | **`POST /api/farms/[farmId]/analyses`** (`GET`/`POST /api/analyses/[jobId]` for status/cancel) | `app/api/farms/[farmId]/analyses/route.ts`, `app/api/analyses/[jobId]/route.ts` |
| Claimed upstream `POST ${ASTRAGRON_SCIENTIFIC_BACKEND_URL}/v1/evaluations` | **`POST ${ASTRAGRON_BACKEND_URL}/analyses`** (`targetUrl.pathname = .../analyses`) | `src/server/analysis-job-store.ts` |
| Claimed `ASTRAGRON_GEOCODING_PROVIDER_URL`, `ASTRAGRON_FTW_PROVIDER_URL`, `ASTRAGRON_CAPABILITY_FOOTPRINTS_URL`, `ASTRAGRON_REPORT_CHAT_URL` | Actual env vars: **`ASTRAGRON_GEOCODER_ENDPOINT`**, **`ASTRAGRON_FTW_SUGGEST_ENDPOINT`**, **`ASTRAGRON_FTW_PARQUET_BASE_URL`**, **`ASTRAGRON_CAPABILITY_FOOTPRINTS_ENDPOINT`**, **`ASTRAGRON_CHAT_ENDPOINT`**, **`ASTRAGRON_BACKEND_URL`** | `src/server/geocode-service.ts`, `src/server/ftw-boundary-service.ts`, `src/server/capability-overlay-service.ts`, `src/server/chat-gateway-service.ts`, `src/server/analysis-job-store.ts` |
| Claimed `PUT /api/farms/[farmId]` & `src/server/sqlite-store.ts` / `src/server/job-service.ts` | **Do not exist in V7.** Farm/field/report state persists in browser `localStorage` (`LOCAL_DEVICE_ONLY`) with JSON backup export/import (`FarmBackupBundleSchema`). Analysis jobs are tracked in `src/server/analysis-job-store.ts`. | `src/hooks/use-astragron-store.tsx`, `src/server/analysis-job-store.ts` |
| Claimed live FTW proof in Uppsala (`17.6389, 59.8586`) | **Actual verified live FTW 2e Parquet proof is Neckarsulm / Heilbronn, Germany (`lon = 9.14156`, `lat = 48.98443`)**, returning feature `32UNV_0_0-139038` (`0.544 ha`, `collection_year: 2024`) from `https://data.source.coop/ftw/global-data-2e/vector/year=2024/32U/NV/32UNV_0_0.parquet`. Uppsala (`33VWX`) returns `PROVIDER_OUTSIDE_COVERAGE` (`404` on Source Cooperative FTW 2e). | `src/server/ftw-boundary-service.ts`, `review/LIVE_PROVIDER_VERIFICATION.json` |

---

## 2. Environment Variables (Exact Source Names & Defaults)

### 2.1 Scientific Compute Backend (`src/server/analysis-job-store.ts`, `src/server/capabilities-service.ts`)
- `ASTRAGRON_BACKEND_URL`: HTTPS base URL for live multi-year scientific evaluation (dispatches `POST ${ASTRAGRON_BACKEND_URL}/analyses` and probes `GET ${ASTRAGRON_BACKEND_URL}/health`). Default: unset (fail-closed `BACKEND_NOT_CONNECTED`).
- `ASTRAGRON_BACKEND_ALLOWED_HOSTS`: Comma-separated hostname allowlist for `ASTRAGRON_BACKEND_URL`.

### 2.2 Geocoding (`src/server/geocode-service.ts`)
- `ASTRAGRON_GEOCODER_ENDPOINT`: Optional custom HTTPS geocoding endpoint.
- `ASTRAGRON_GEOCODER_ALLOWED_HOSTS`: Comma-separated hostname allowlist for custom geocoder endpoint.
- `ASTRAGRON_GEOCODER_API_KEY`: Optional API key (`Bearer` header or `?api_key=` for MapTiler/Geocode Earth).
- `ASTRAGRON_GEOCODER_PROVIDER`: `'NOMINATIM' | 'PHOTON' | 'MAPTILER' | 'GEOCODE_EARTH' | 'PELIAS' | 'CUSTOM'`.
- `ASTRAGRON_GEOCODER_DISABLE_KEYLESS`: Set to `'1'` to disable the default keyless OpenStreetMap Nominatim (`nominatim.openstreetmap.org`) and Photon (`photon.komoot.io`) fallback chain.

### 2.3 FTW Field-Boundary Suggestions (`src/server/ftw-boundary-service.ts`)
- `ASTRAGRON_FTW_SUGGEST_ENDPOINT`: Optional custom HTTPS GeoJSON suggestion endpoint.
- `ASTRAGRON_FTW_ALLOWED_HOSTS`: Comma-separated hostname allowlist for `ASTRAGRON_FTW_SUGGEST_ENDPOINT`.
- `ASTRAGRON_FTW_PARQUET_BASE_URL`: Base URL for live Cloud-Native GeoParquet HTTP Range reader. Default: `https://data.source.coop/ftw/global-data-2e/vector`.
- `ASTRAGRON_FTW_PARQUET_ALLOWED_HOSTS`: Comma-separated hostname allowlist for GeoParquet host. Default: `data.source.coop`.
- `ASTRAGRON_FTW_DISABLE_LIVE_PARQUET`: Set to `'1'` to disable live GeoParquet HTTP Range reads.

### 2.4 Capability Footprints (`src/server/capability-overlay-service.ts`)
- `ASTRAGRON_CAPABILITY_FOOTPRINTS_ENDPOINT`: Optional HTTPS endpoint returning verified regional capability polygons (`CapabilityFootprintsResponse`).
- `ASTRAGRON_CAPABILITY_ALLOWED_HOSTS`: Comma-separated hostname allowlist for capability footprints endpoint.

### 2.5 Report-Grounded AI Chat Gateway (`src/server/chat-gateway-service.ts`)
- `ASTRAGRON_CHAT_ENDPOINT`: HTTPS endpoint for report-grounded Q&A assistant.
- `ASTRAGRON_CHAT_ALLOWED_HOSTS`: Comma-separated hostname allowlist (required before any outbound chat call is permitted).
- `ASTRAGRON_CHAT_ENABLE_VERIFIED_GATEWAY`: Must be `'1'` (along with valid HTTPS endpoint + allowlist) before `reportGroundedChat.enabled` reports `true`. Default: unset (`false`, fail-closed `503 CHAT_NOT_CONNECTED`).
- `ASTRAGRON_CHAT_TIMEOUT_MS`: Bounded upstream request timeout in milliseconds (default `6000`).

### 2.6 Optional Cloud Farm Storage (`src/server/capabilities-service.ts`)
- `ASTRAGRON_CLOUD_STORAGE_URL`: Optional indicator for cloud storage capability status (default unset; V7 uses `LOCAL_DEVICE_ONLY` browser `localStorage`).

---

## 3. Route-by-Route API Specifications

### 3.1 `GET /api/capabilities`
- **Route File:** `app/api/capabilities/route.ts` -> `src/server/capabilities-service.ts`
- **Schema:** `SystemCapabilitiesResponseSchema` (`src/domain/farmer-ux-contracts.ts`)
- **Behavior:** Probes configured backend health (`GET ${ASTRAGRON_BACKEND_URL}/health` with SSRF guard & 2500 ms timeout), verifies staged M14 corpus SHA-256 hashes, checks geocoder configuration, and checks `evaluateChatGatewayReadiness()`.

### 3.2 `GET /api/capabilities/footprints`
- **Route File:** `app/api/capabilities/footprints/route.ts` -> `src/server/capability-overlay-service.ts`
- **Response Type:** `CapabilityFootprintsResponse`
- **Behavior:** Returns `benchmarkPoints` (5 verified M4/M14 reference point markers) and `polygonCollection` (empty `FeatureCollection` by default unless `ASTRAGRON_CAPABILITY_FOOTPRINTS_ENDPOINT` returns verified multi-vertex polygons). Never fabricates circular buffers or country bounding boxes.

### 3.3 `POST /api/capabilities/site-check`
- **Route File:** `app/api/capabilities/site-check/route.ts` -> `src/server/capability-overlay-service.ts`
- **Request Schema (`SiteCheckRequestSchema`):**
  ```json
  {
    "coordinates": [17.6389, 59.8586],
    "geometry": null,
    "farmId": "uppsala-demo",
    "inputRevision": "rev-1f85cc78",
    "isUserModifiedDraft": false,
    "isUserCreatedDraft": false
  }
  ```
- **G2 Strict Benchmark Eligibility Rules:**
  - Zero coordinate tolerance (`BENCHMARK_EXACT_COORD_TOLERANCE_DEG` removed).
  - Benchmark status is returned **only** when:
    1. `!isUserModifiedDraft && !isUserCreatedDraft && !hasPolygonInput`
    2. `farmId` is an explicit registered benchmark ID (`uppsala-demo`, `uppsala-m14`, `SE_UPPSALA`, `nyeri-kenya`, `KE_NYERI_REGION`, `wagga-australia`, `AU_WAGGA_REGION`, `polar-svalbard`, `SJ_SVALBARD_POLAR`, `ocean-atlantic`, `INT_NORTH_ATLANTIC`) and not a `custom-*` farm.
    3. `coordinates[0] === b.coordinates[0] && coordinates[1] === b.coordinates[1]` (exact equality).
    4. For Uppsala (`uppsala-demo`), `inputRevision === UPPSALA_REFERENCE_INPUT_REVISION`.
  - Any custom farm (`farmId` omitted or `custom-*`), modified draft, polygon input enclosing a benchmark point, or coordinate offset (`0.0001°`, `0.0005°`, `0.5 km`) returns `UNKNOWN_UNASSESSED` unless intersected by a verified remote capability polygon.

### 3.4 `POST /api/farms/[farmId]/analyses`
- **Route File:** `app/api/farms/[farmId]/analyses/route.ts` -> `src/server/analysis-job-store.ts`
- **Request Schema (`AnalysisJobTriggerRequestSchema`):**
  ```json
  {
    "farmId": "uppsala-demo",
    "inputRevision": "rev-1f85cc78",
    "datasetMode": "RECORDED_M14_RESEARCH",
    "coordinates": [17.6389, 59.8586],
    "fieldCount": 3,
    "inputsModified": false,
    "isUserCreatedDraft": false
  }
  ```
- **G3 Hardened Dispatch & Provenance Rules:**
  - URL `farmId` must equal body `farmId` (`400 FARM_ID_MISMATCH` otherwise).
  - Active-job idempotency: if a `QUEUED` or `RUNNING` job already exists for `(farmId, inputRevision, datasetMode)`, returns the existing job record.
  - Offline / Recorded M14 path (`ASTRAGRON_BACKEND_URL` unset):
    - `uppsala-demo` / `uppsala-m14` only unlocks `OK_RECORDED_RESEARCH` or `OK_SYNTHETIC_DEMO` (`status: 'ABSTAINED'`) when `!inputsModified && !isUserCreatedDraft && inputRevision === UPPSALA_REFERENCE_INPUT_REVISION && coordinates === [17.6389, 59.8586] && fieldCount === 3`.
    - Any spoofed `farmId: "uppsala-demo"` with a mismatched `inputRevision`, modified inputs, or altered coordinates/field count is blocked with `status: 'COMPLETED_LIMITED'` and `failClosedStatus: 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'`.
  - Live Upstream Backend path (`ASTRAGRON_BACKEND_URL` set):
    - Validates URL via `validateAllowlistedHttpsUrl`, dispatches `POST ${ASTRAGRON_BACKEND_URL}/analyses` with `redirect: 'error'` and bounded timeout (`5000 ms`).
    - Validates upstream JSON status against `AnalysisStatusSchema`.
    - If upstream returns `status: 'COMPLETED_VERIFIED'`, requires matching `body.farmId === farmId`, `body.inputRevision === req.inputRevision`, non-empty `body.reportId`, and `body.evidenceVerified === true`. Otherwise rejects fail-closed with `status: 'FAILED'` and `failClosedStatus: 'SOURCE_NOT_PROVIDED'`.

### 3.5 `GET /api/analyses/[jobId]` & `POST /api/analyses/[jobId]`
- **Route File:** `app/api/analyses/[jobId]/route.ts` -> `src/server/analysis-job-store.ts`
- **Behavior:** `GET` returns `{ ok: true, job: AnalysisJobRecord }` (or `404 JOB_NOT_FOUND`). `POST` with `{ "action": "cancel" }` transitions active jobs to `CANCELLED`.

### 3.6 `POST /api/reports/[reportId]/chat`
- **Route File:** `app/api/reports/[reportId]/chat/route.ts` -> `src/server/chat-gateway-service.ts`
- **Request Schema (`ChatProxyRequestSchema`):**
  ```json
  {
    "farmId": "uppsala-demo",
    "reportId": "report-uppsala-m14-baseline",
    "inputRevision": "rev-1f85cc78",
    "evidenceVersion": "1.0.0-m14-uppsala-baseline",
    "conversationId": "conv-uppsala-1",
    "question": "Why did zero plans qualify universally in Uppsala?"
  }
  ```
- **G4 Security & Grounding Controls:**
  - Sliding-window rate limiting per client/owner/conversation (`429 INVALID_REQUEST` when exceeded).
  - Server-side report context resolution (`resolveVerifiedReportContext`):
    - Rejects URL vs body `reportId` mismatch (`409 REPORT_CONTEXT_MISMATCH`).
    - For server-registered custom reports, requires matching `x-astragron-owner-id` (`403` on missing/cross-user owner), matching `farmId`, matching `inputRevision` (`409` on stale report after field/crop edits), and matching `evidenceVersion`.
    - For `uppsala-demo`, requires `inputRevision === UPPSALA_REFERENCE_INPUT_REVISION` and verified staged M14 corpus hashes, resolving canonical server citation IDs (`M14_CORPUS_SE_UPPSALA`, `STAGE1_BARLEY_083`, `STAGE1_OATS_083`, `STAGE1_WHEAT_067`, `SMHI_GRID_P1D`, `S2_L2A_10M`, `ERA5_LAND_HOURLY`, `SOILGRIDS_250M`, `LPIS_SE_2025`).
    - For unpersisted browser-local custom farm reports (`LOCAL_DEVICE_ONLY`), fails closed with `503 CHAT_NOT_CONNECTED`.
  - Conversation binding: prevents a `conversationId` from switching `reportId`, `farmId`, `inputRevision`, or `ownerId` mid-thread (`409 REPORT_CONTEXT_MISMATCH`).
  - Upstream transport: requires `ASTRAGRON_CHAT_ENABLE_VERIFIED_GATEWAY=1`, `ASTRAGRON_CHAT_ENDPOINT` (HTTPS), and `ASTRAGRON_CHAT_ALLOWED_HOSTS` via `validateAllowlistedHttpsUrl`, with `redirect: 'error'` and bounded timeout.
  - Upstream response & citation validation: validates response with `UpstreamChatResponseSchema` and verifies every returned citation ID is in the server-resolved `allowedCitationIds` set.

### 3.7 `GET /api/geocode?q=<query>`
- **Route File:** `app/api/geocode/route.ts` -> `src/server/geocode-service.ts`
- **Behavior:** Validates query (`2..160` chars), enforces rate-limit/cache, blocks SSRF/private IPs/redirects, and queries configured HTTPS geocoder or keyless Nominatim/Photon fallback.

### 3.8 `GET /api/field-boundaries/suggest?lon=<lon>&lat=<lat>&year=<year>`
- **Route File:** `app/api/field-boundaries/suggest/route.ts` -> `src/server/ftw-boundary-service.ts`
- **Behavior:** Computes MGRS 100 km grid ID (`lonLatToMgrs100k`), performs HTTP Range requests against `https://data.source.coop/ftw/global-data-2e/vector/year=<year>/<MGRS>.parquet` using `hyparquet` + `hyparquet-compressors`, parses WKB geometries, and filters by spatial bbox without fabricating rectangles.

### 3.9 `GET /api/research/m14`
- **Route File:** `app/api/research/m14/route.ts` -> `src/server/corpus-integrity.ts`
- **Behavior:** Verifies SHA-256 hashes of all 5 staged M4/M14 JSON corpora before returning the frozen Uppsala M14 baseline (`universallyQualifiedPlansCount = 0`, Barley `0.8333`, Oats `0.8333`, Wheat `0.6667`).
