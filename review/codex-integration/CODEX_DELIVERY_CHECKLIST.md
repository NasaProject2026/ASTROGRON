# ASTRAGRON V7 — Codex Safe Integration Verification Checklist (`CODEX_DELIVERY_CHECKLIST.md`)

**Verification Date:** 2026-11-14  
**Integration Branch:** `feat/v7-codex-safe-integration`  
**Preserved Baseline Worktree:** `C:/Users/HP/.gemini/antigravity/brain/3ac899d3-46e0-4094-ad7f-0b55172ca787/scratch/astragron_farmer_first/GEMINI_V7_BASELINE_WORKTREE` (`21b8bfa`)  
**Deliverable Archive:** `ASTRAGRON_V7_CODEX_SCIENTIFIC_INTEGRATION_REVIEW.zip`

---

## Gate G0 — Isolated Baseline & Rollback Protection

| ID | Requirement | Status | Evidence / File Reference |
| :--- | :--- | :---: | :--- |
| `G0.1` | Verify `PACKAGE_MANIFEST.json` SHA-256 hashes before extraction (`9/9` component files) | **PASS** | `TOOLS/verify_package.py` (`PASS: 9 verified component files`) |
| `G0.2` | Extract `SOURCE/ASTRAGRON_FRONTEND_V7_CLOSURE_CODEX_READY.zip` (`8ab271899a75cd710eb13bd6660f09928a8572d36498cb6f3dfe29014c134918`) and verify `node scripts/verify-manifest.mjs` (`283/283`) and `node scripts/verify-protected-files.mjs` (`28/28`) | **PASS** | `review/codex-integration/G0_BASELINE_AND_ROLLBACK.json` |
| `G0.3` | Preserve Gemini's V7 baseline in an isolated worktree (`GEMINI_V7_BASELINE_WORKTREE`) and create isolated branch `feat/v7-codex-safe-integration` | **PASS** | `review/codex-integration/G0_BASELINE_AND_ROLLBACK.json` |
| `G0.4` | Record deterministic rollback commands and verification instructions | **PASS** | `review/codex-integration/ROLLBACK_INSTRUCTIONS.md` |

---

## Gate G1 — Actual Source-Derived API Contract & Handoff Correction

| ID | Requirement | Status | Evidence / File Reference |
| :--- | :--- | :---: | :--- |
| `G1.1` | Derive `review/CODEX_ACTUAL_API_CONTRACT.md` directly from Next.js App Router routes (`app/api/**/route.ts`), server services (`src/server/*.ts`), and Zod schemas (`src/domain/farmer-ux-contracts.ts`) | **PASS** | `review/CODEX_ACTUAL_API_CONTRACT.md` |
| `G1.2` | Correct analysis dispatch route documentation from `/api/farms/[farmId]/jobs` & `/v1/evaluations` to `POST /api/farms/[farmId]/analyses` -> `POST ${ASTRAGRON_BACKEND_URL}/analyses` | **PASS** | `review/CODEX_ACTUAL_API_CONTRACT.md`, `review/FINAL_CODEX_FRONTEND_HANDOFF.md` |
| `G1.3` | Document exact environment variable names (`ASTRAGRON_BACKEND_URL`, `ASTRAGRON_GEOCODER_ENDPOINT`, `ASTRAGRON_FTW_SUGGEST_ENDPOINT`, `ASTRAGRON_FTW_PARQUET_BASE_URL`, `ASTRAGRON_CAPABILITY_FOOTPRINTS_ENDPOINT`, `ASTRAGRON_CHAT_ENDPOINT`, `ASTRAGRON_CHAT_ALLOWED_HOSTS`, `ASTRAGRON_CHAT_ENABLE_VERIFIED_GATEWAY`) | **PASS** | `review/CODEX_ACTUAL_API_CONTRACT.md`, `review/FINAL_CODEX_FRONTEND_HANDOFF.md` |
| `G1.4` | Document truthful persistence model (`LOCAL_DEVICE_ONLY` browser `localStorage` + `FarmBackupBundleSchema` export/import; clarify `sqlite-store.ts`, `job-service.ts`, and `PUT /api/farms/[farmId]` do not exist) | **PASS** | `review/CODEX_ACTUAL_API_CONTRACT.md`, `review/codex-integration/CONTRACT_SAMPLES.json` |
| `G1.5` | Document verified live FTW 2e GeoParquet proof at Neckarsulm / Heilbronn, Germany (`lon = 9.14156`, `lat = 48.98443`, feature `32UNV_0_0-139038`, `0.544 ha`) vs Uppsala (`33VWX` `PROVIDER_OUTSIDE_COVERAGE`) | **PASS** | `review/CODEX_ACTUAL_API_CONTRACT.md`, `review/LIVE_PROVIDER_VERIFICATION.json` |

---

## Gate G2 — Eliminate Benchmark Eligibility Leakage

| ID | Requirement | Status | Evidence / File Reference |
| :--- | :--- | :---: | :--- |
| `G2.1` | Remove `BENCHMARK_EXACT_COORD_TOLERANCE_DEG = 0.0005` from `src/server/capability-overlay-service.ts` | **PASS** | `src/server/capability-overlay-service.ts` (`isRegisteredUnmodifiedBenchmarkMatch`) |
| `G2.2` | Custom farm (`farmId` omitted or `custom-*`) at exact benchmark coordinates (`[17.6389, 59.8586]`, `[36.9476, -0.4201]`, `[147.3598, -35.1082]`, `[15.6397, 78.2232]`, `[-30.0, 45.0]`) returns `UNKNOWN_UNASSESSED` | **PASS** | `tests/codex-v7-safe-integration.test.ts` (`Gate G2`) |
| `G2.3` | Coordinate offsets (`0.0001°`, `0.0005°`, `0.5 km`) from any benchmark point return `UNKNOWN_UNASSESSED` even when `farmId` matches a benchmark | **PASS** | `tests/codex-v7-safe-integration.test.ts` (`Gate G2`) |
| `G2.4` | User polygon enclosing a benchmark point returns `UNKNOWN_UNASSESSED` | **PASS** | `tests/codex-v7-safe-integration.test.ts`, `tests/smart-fields-and-coverage.test.ts` |
| `G2.5` | `uppsala-demo` requires `inputRevision === UPPSALA_REFERENCE_INPUT_REVISION` and `!isUserModifiedDraft && !isUserCreatedDraft` | **PASS** | `src/server/capability-overlay-service.ts`, `tests/codex-v7-safe-integration.test.ts` |

---

## Gate G3 — Science-Backed Analysis Job Integration

| ID | Requirement | Status | Evidence / File Reference |
| :--- | :--- | :---: | :--- |
| `G3.1` | Block client impersonation of `farmId: "uppsala-demo"` when `inputRevision !== UPPSALA_REFERENCE_INPUT_REVISION`, coordinates differ from `[17.6389, 59.8586]`, `fieldCount !== 3`, or inputs are modified (`failClosedStatus: 'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'`) | **PASS** | `src/server/analysis-job-store.ts`, `tests/codex-v7-safe-integration.test.ts` (`Gate G3`) |
| `G3.2` | Enforce active-job idempotency for concurrent requests with identical `(farmId, inputRevision, datasetMode)` | **PASS** | `src/server/analysis-job-store.ts` (`findActiveJobForRevision`), `tests/codex-v7-safe-integration.test.ts` |
| `G3.3` | Validate upstream `/analyses` responses and reject `COMPLETED_VERIFIED` unless `farmId`, `inputRevision`, `reportId`, and `evidenceVerified === true` are bound and verified | **PASS** | `src/server/analysis-job-store.ts`, `tests/codex-v7-safe-integration.test.ts` |
| `G3.4` | Never fabricate 0–100% progress percentages or fake stage timers | **PASS** | `src/server/analysis-job-store.ts` (`progressMode: 'INDETERMINATE' | 'STAGE_DISCRETE'`) |

---

## Gate G4 — Secure Report-Grounded AI Chat Gateway

| ID | Requirement | Status | Evidence / File Reference |
| :--- | :--- | :---: | :--- |
| `G4.1` | Keep `reportGroundedChat.enabled = false` (`503 CHAT_NOT_CONNECTED`) by default unless `ASTRAGRON_CHAT_ENDPOINT` (HTTPS), `ASTRAGRON_CHAT_ALLOWED_HOSTS`, and `ASTRAGRON_CHAT_ENABLE_VERIFIED_GATEWAY=1` are configured | **PASS** | `src/server/chat-gateway-service.ts`, `src/server/capabilities-service.ts` |
| `G4.2` | Enforce SSRF protection (`validateAllowlistedHttpsUrl`), `redirect: 'error'`, bounded timeout, and sliding-window rate limiting (`429`) | **PASS** | `src/server/chat-gateway-service.ts`, `tests/codex-v7-safe-integration.test.ts` (`Gate G4`) |
| `G4.3` | Enforce server-side report ownership (`ownerId`), `farmId`, `inputRevision`, `evidenceVersion`, and conversation-thread binding (`403` on cross-user, `409` on stale revision or cross-report mismatch) | **PASS** | `src/server/chat-gateway-service.ts`, `tests/codex-v7-safe-integration.test.ts` (`Gate G4`) |
| `G4.4` | Validate upstream assistant responses with `UpstreamChatResponseSchema` and verify every returned citation ID against the server-resolved `allowedCitationIds` registry | **PASS** | `src/server/chat-gateway-service.ts`, `tests/codex-v7-safe-integration.test.ts` (`Gate G4`) |

---

## Gate G5 — Preserve Frontend Design & Protected Scientific Engine

| ID | Requirement | Status | Evidence / File Reference |
| :--- | :--- | :---: | :--- |
| `G5.1` | Zero modifications to all 28 protected scientific and stage-contract files (`node scripts/verify-protected-files.mjs`) | **PASS** | `Protected files verified: 28/28 PASS` |
| `G5.2` | Preserve frozen M14 research outcomes (`0/9` universally qualified plans in Uppsala; Barley `0.8333`, Oats `0.8333`, Wheat `0.6667`) | **PASS** | `tests/g2-g3-recorded-m14-m4.test.ts`, `tests/p1-scientific-integrity.test.ts` |
| `G5.3` | Preserve existing interactive 3D Earth, MapLibre 2D/3D parcels, Farmer-First UX, and offline UI invariants (`9/9`) | **PASS** | `node scripts/mobile-ux-offline-gates.mjs` (`9/9 PASS`) |

---

## Gate G6 — Full Verification Pipeline

| ID | Requirement | Status | Evidence / File Reference |
| :--- | :--- | :---: | :--- |
| `G6.1` | TypeScript (`npx tsc --noEmit`) — 0 errors | **PASS** | Verified in `FARMER_FIRST_WORK` |
| `G6.2` | ESLint (`npm run lint`) — 0 errors | **PASS** | Verified in `FARMER_FIRST_WORK` |
| `G6.3` | Offline UX invariants (`node scripts/mobile-ux-offline-gates.mjs`) — `9/9 PASS` | **PASS** | Verified in `FARMER_FIRST_WORK` |
| `G6.4` | Protected scientific files (`node scripts/verify-protected-files.mjs`) — `28/28 PASS` | **PASS** | Verified in `FARMER_FIRST_WORK` |
| `G6.5` | Vitest unit & integration suite (`npx vitest run`) — `10/10` test files, `104/104` tests PASS | **PASS** | `104 passed (104)` |
| `G6.6` | Next.js production build (`npm run build`) | **PASS** | Production build verified |
| `G6.7` | Playwright E2E regression verification (`desktop-chrome` & `webkit-desktop`) | **PASS** | `review/evidence/playwright-results.json` |

---

## Gate G7 — Final Packaging & Fresh-Extraction Manifest Verification

| ID | Requirement | Status | Evidence / File Reference |
| :--- | :--- | :---: | :--- |
| `G7.1` | Regenerate SHA-256 manifests (`12_HASHES_AND_DELIVERY_MANIFEST.json`, `SMART_FIELDS_SHA256_MANIFEST.json`, `V7_RELEASE_SHA256_MANIFEST.json`), package `ASTRAGRON_V7_CODEX_SCIENTIFIC_INTEGRATION_REVIEW.zip` (`< 20 MB`), and verify `verify-manifest.mjs` + `verify-protected-files.mjs` (`28/28 PASS`) on a fresh extraction | **PASS** | `ASTRAGRON_V7_CODEX_SCIENTIFIC_INTEGRATION_REVIEW.zip` |
