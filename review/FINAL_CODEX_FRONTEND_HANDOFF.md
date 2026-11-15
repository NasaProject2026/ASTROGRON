# ASTRAGRON V7 — Final Codex Backend & Frontend Integration Handoff (`FINAL_CODEX_FRONTEND_HANDOFF.md`)

**Release Baseline:** `ASTRAGRON_V7_CODEX_SCIENTIFIC_INTEGRATION_REVIEW`  
**Contract Authority:** Synchronized with `review/CODEX_ACTUAL_API_CONTRACT.md` and `review/codex-integration/CONTRACT_SAMPLES.json`  
**Protected Engine Status:** `28/28` protected scientific files (`review/SMART_FIELD_PROTECTED_HASHES.json`) verified bit-for-bit unmodified.

---

## 1. Architecture & Persistence Model (Truthful V7 State)

1. **Client-Side Persistence (`LOCAL_DEVICE_ONLY`):**
   - Farm drafts, drawn/imported/suggested field polygons, and generated report envelopes are persisted in browser `localStorage` (`src/hooks/use-astragron-store.tsx`) and can be exported/imported as checksummed JSON bundles (`FarmBackupBundleSchema`).
   - There is **no** `PUT /api/farms/[farmId]`, `src/server/sqlite-store.ts`, or `src/server/job-service.ts` in V7.
2. **Server-Side Analysis Job Store (`src/server/analysis-job-store.ts`):**
   - Handles `POST /api/farms/[farmId]/analyses` and `GET`/`POST /api/analyses/[jobId]`.
   - Enforces active-job idempotency by `(farmId, inputRevision, datasetMode)`.
   - Protects the frozen Uppsala M14 archive (`uppsala-demo` / `uppsala-m14`) by requiring `inputRevision === UPPSALA_REFERENCE_INPUT_REVISION`, exact coordinates `[17.6389, 59.8586]`, `fieldCount === 3`, `!inputsModified`, and `!isUserCreatedDraft`.
   - When `ASTRAGRON_BACKEND_URL` is configured, validates HTTPS + `ASTRAGRON_BACKEND_ALLOWED_HOSTS` via `validateAllowlistedHttpsUrl`, dispatches `POST ${ASTRAGRON_BACKEND_URL}/analyses` (`redirect: 'error'`), and requires bound `farmId`, `inputRevision`, `reportId`, and `evidenceVerified === true` before accepting `COMPLETED_VERIFIED`.
3. **Strict Benchmark Eligibility (`src/server/capability-overlay-service.ts`):**
   - `POST /api/capabilities/site-check` has **zero coordinate tolerance** (`BENCHMARK_EXACT_COORD_TOLERANCE_DEG` removed).
   - Benchmark status is restricted to registered, unmodified reference benchmark records with exact coordinate equality and verified `inputRevision`.
   - All custom farms (`custom-*` or omitted `farmId`), modified drafts, coordinate offsets (`0.0001°`, `0.0005°`, `0.5 km`), and polygons enclosing a benchmark point return `UNKNOWN_UNASSESSED` unless covered by a verified remote capability polygon.
4. **Secure Report-Grounded AI Chat Gateway (`src/server/chat-gateway-service.ts`):**
   - `POST /api/reports/[reportId]/chat` is fail-closed by default (`503 CHAT_NOT_CONNECTED`, `reportGroundedChat.enabled = false`).
   - Enforces sliding-window rate limiting, server-side report ownership and `inputRevision` verification, conversation-thread binding, HTTPS + `ASTRAGRON_CHAT_ALLOWED_HOSTS` SSRF protection, `redirect: 'error'`, bounded timeout, and strict Zod validation of upstream responses and server-verified citation IDs.

---

## 2. Exact Environment Variables

| Variable | Purpose | Default / Fail-Closed Behavior |
| :--- | :--- | :--- |
| `ASTRAGRON_BACKEND_URL` | Upstream scientific engine base URL (`POST .../analyses`, `GET .../health`) | Unset -> `BACKEND_NOT_CONNECTED` |
| `ASTRAGRON_BACKEND_ALLOWED_HOSTS` | Comma-separated allowlist for `ASTRAGRON_BACKEND_URL` | Required when allowlist mode active |
| `ASTRAGRON_GEOCODER_ENDPOINT` | Custom HTTPS geocoding endpoint | Falls back to Nominatim -> Photon unless disabled |
| `ASTRAGRON_GEOCODER_ALLOWED_HOSTS` | Comma-separated allowlist for custom geocoder | Required for custom geocoder endpoint |
| `ASTRAGRON_GEOCODER_API_KEY` | Optional geocoder API key | Unset |
| `ASTRAGRON_GEOCODER_PROVIDER` | `NOMINATIM` \| `PHOTON` \| `MAPTILER` \| `GEOCODE_EARTH` \| `PELIAS` \| `CUSTOM` | Auto-detected |
| `ASTRAGRON_GEOCODER_DISABLE_KEYLESS` | Set `'1'` to disable keyless Nominatim/Photon fallback | Unset (`'0'`) |
| `ASTRAGRON_FTW_SUGGEST_ENDPOINT` | Optional custom HTTPS FTW boundary endpoint | Uses live Source Cooperative GeoParquet |
| `ASTRAGRON_FTW_ALLOWED_HOSTS` | Comma-separated allowlist for `ASTRAGRON_FTW_SUGGEST_ENDPOINT` | Required for custom FTW endpoint |
| `ASTRAGRON_FTW_PARQUET_BASE_URL` | FTW 2e GeoParquet base URL | `https://data.source.coop/ftw/global-data-2e/vector` |
| `ASTRAGRON_FTW_PARQUET_ALLOWED_HOSTS` | Allowlist for FTW GeoParquet host | `data.source.coop` |
| `ASTRAGRON_FTW_DISABLE_LIVE_PARQUET` | Set `'1'` to disable live GeoParquet HTTP Range reads | Unset (`'0'`) |
| `ASTRAGRON_CAPABILITY_FOOTPRINTS_ENDPOINT` | Optional HTTPS endpoint for regional capability polygons | Unset -> empty polygon `FeatureCollection` |
| `ASTRAGRON_CAPABILITY_ALLOWED_HOSTS` | Allowlist for capability footprints endpoint | Required when endpoint set |
| `ASTRAGRON_CHAT_ENDPOINT` | HTTPS endpoint for report-grounded AI chat assistant | Unset -> `503 CHAT_NOT_CONNECTED` |
| `ASTRAGRON_CHAT_ALLOWED_HOSTS` | Allowlist for `ASTRAGRON_CHAT_ENDPOINT` | Required before any outbound chat call |
| `ASTRAGRON_CHAT_ENABLE_VERIFIED_GATEWAY` | Set `'1'` to enable verified chat gateway | Unset -> `reportGroundedChat.enabled = false` |
| `ASTRAGRON_CHAT_TIMEOUT_MS` | Upstream chat timeout in ms | `6000` |
| `ASTRAGRON_CLOUD_STORAGE_URL` | Optional cloud storage indicator | Unset (`LOCAL_DEVICE_ONLY`) |

---

## 3. Verified Live External Provider Proofs vs Mocked/Offline Capabilities

1. **Live Keyless Geocoding (`GET /api/geocode?q=Uppsala`):**
   - Verified live against `nominatim.openstreetmap.org` (`HTTP 200`, `status: "OK"`, returns `Uppsala, Uppsala kommun, Uppsala län, Sverige` at `[17.6387436, 59.8586126]`).
2. **Live FTW 2e Cloud-Native GeoParquet (`GET /api/field-boundaries/suggest`):**
   - **Coverage Hit (`lon=9.14156&lat=48.98443&year=2024`, Neckarsulm / Heilbronn, Germany, MGRS `32UNV`):** Verified live HTTP 206 Partial Content against `https://data.source.coop/ftw/global-data-2e/vector/year=2024/32U/NV/32UNV_0_0.parquet`, returning real agricultural polygon `32UNV_0_0-139038` (`0.544 ha`).
   - **Outside Coverage (`lon=17.6389&lat=59.8586&year=2024`, Uppsala, Sweden, MGRS `33VWX`):** Verified live HTTP 404 on Source Cooperative (`status: "PROVIDER_OUTSIDE_COVERAGE"`, 0 fabricated polygons).
3. **Live Scientific Compute Backend & Live LLM Chat Service:**
   - Not provisioned in this local environment; verified via deterministic unit, integration, and E2E tests and kept strictly fail-closed (`BACKEND_NOT_CONNECTED` and `CHAT_NOT_CONNECTED`) by default.
