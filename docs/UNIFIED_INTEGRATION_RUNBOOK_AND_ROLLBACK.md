# ASTRAGRON — Unified End-to-End Scientific Integration Runbook & Rollback Guide

**Integration Branch:** `feat/v7-unified-e2e-scientific-integration`  
**Pre-Integration Commit:** `0d3193f` (`feat(v7-codex-safe-integration)`)  
**Scope:** Connects the Next.js 16 V7 frontend (`app/`, `src/`) to the Python Adaptive Evidence scientific engine (`adaptive_evidence/`, `SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release/water_core`) without altering M1–M14 research receipts or bypassing abstention safeguards.

---

## 1. Unified System Architecture

1. **Python Scientific Engine & HTTP Adapter (`adaptive_evidence/unified_server.py`)**
   - Exposes `GET /health` and analysis endpoints backed by `adaptive_evidence.farmer_report_adapter` (`C1–C10` capability evaluation, NASA POWER / SoilGrids v2.0 evidence checks, land/ocean mask via `adaptive_evidence.land_mask`, and JSON persistence to `ASTRAGRON_PYTHON_STORE_PATH` / `data/runtime/astragron-python-store.json`).
   - Enforces `field_validated: false` and preserves unmodified `uppsala-demo` M14 recorded abstention while returning `COMPLETED_LIMITED` (`OK_COVERAGE_ONLY` / `REGIONAL_SCREENING_ONLY`), `ABSTAINED`, or fail-closed `UNAVAILABLE` / `FAILED` states according to scientific gates.
2. **Next.js API Adapter & Persistent Runtime Store (`app/api/**`, `src/server/**`)**
   - `src/server/ssrf-guard.ts` (`resolveAnalysisBackendUrl`): blocks unsafe/loopback HTTP targets unless `ASTRAGRON_ALLOW_LOCAL_PYTHON_BACKEND=1` and `ASTRAGRON_BACKEND_ALLOWED_HOSTS` explicitly allow `127.0.0.1,localhost`.
   - `src/server/capabilities-service.ts` (`/api/capabilities`): verifies live `/health` connectivity and reports `liveFarmAnalysis.mode = 'BACKEND_CONNECTED'` when reachable, vs fail-closed `NOT_CONNECTED` for unconfigured external AI chat (`reportGroundedChat.mode = 'NOT_CONNECTED'`).
   - `src/server/persisted-runtime-store.ts`: persists farms (`GET`/`POST` `/api/farms`), analysis jobs + report envelopes (`/api/farms/[farmId]/analyses`, `/api/analyses/[jobId]`), and reports (`/api/reports`), plus HMAC-SHA256 owner tokens (`x-astragron-owner-token`) verifying report ownership before `/api/reports/[reportId]/chat` evaluation.
   - `src/hooks/use-astragron-store.tsx` & `app/farm/[id]/{analysis,reports}/page.tsx`: write through farm/report drafts to Next.js API routes, hydrate server-persisted custom farms cleanly when entering `/farm/[id]/*`, display server `adaptiveSummary` on `/analysis`, and export server-backed `ReportEnvelope` PDF reports on `/reports`.

---

## 2. Local Startup Instructions (Not Publicly Deployed)

### Step A — Start Python Scientific Backend

Use the helper script [`docs/adaptive_evidence/START_ASTRAGRON_UNIFIED.ps1`](./adaptive_evidence/START_ASTRAGRON_UNIFIED.ps1) or run directly:

```powershell
# Optional: set ASTRAGRON_OFFLINE_ONLY=1 when running strictly offline without NASA POWER / SoilGrids network fetches
$env:ASTRAGRON_OFFLINE_ONLY = "0"
.\.venv\Scripts\python.exe -B -X utf8 -m adaptive_evidence.unified_server --host 127.0.0.1 --port 8080
```

Verify health:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8080/health"
```

### Step B — Start Next.js Frontend Connected to Local Python Backend

```powershell
npm ci
npm run build
$env:ASTRAGRON_BACKEND_URL = "http://127.0.0.1:8080"
$env:ASTRAGRON_BACKEND_ALLOWED_HOSTS = "127.0.0.1,localhost"
$env:ASTRAGRON_ALLOW_LOCAL_PYTHON_BACKEND = "1"
npm run start
```

Open `http://127.0.0.1:3000` in a browser (no public deployment is active or authorized).

---

## 3. Verified Live Integrations vs Offline / Blocked Boundaries

| Capability | Verified Status | Notes |
| --- | --- | --- |
| Protected files integrity (`verify-protected-files.mjs`) | **PASS (28/28)** | Zero changes to frozen M1–M14 corpus, hero media, or protected UI files. |
| Python Adaptive Evidence test suite (`tests/adaptive_evidence`) | **PASS (83/83)** | Verified under `ASTRAGRON_OFFLINE_ONLY=1`. |
| Next.js <-> Python bridge + SSRF + HMAC chat tests (`npx vitest run`) | **PASS (107/107 across 11 files)** | Spawns live loopback `adaptive_evidence.unified_server`; tests Heilbronn `COMPLETED_LIMITED`, Uppsala `ABSTAINED`, ocean `UNAVAILABLE`, geometry mismatch `FAILED`, server restart persistence, and signed chat fail-closed `403`/`503`. |
| Playwright E2E (`desktop-chrome` & `webkit-desktop` with live server) | **55 passed, 1 skipped, 0 failed** | Includes `e2e/unified-live-integration.spec.ts` (live C1–C10 analysis, storage wipe reload persistence, binary PDF download). Skipped item (`[webkit-desktop] e2e/orbit-ab-benchmark.spec.ts:298`) is Chromium-only CDP throttle benchmark. |
| Accessibility (`@axe-core/playwright`) | **0 critical/serious violations** | Verified across core routes (8), farmer-first routes (5), and recorded M14 routes (6) on both `desktop-chrome` and `webkit-desktop`. |
| Report-grounded AI Chat (`/api/reports/[reportId]/chat`) | **NOT_CONNECTED (Fail-Closed HTTP `503 CHAT_NOT_CONNECTED`)** | Token HMAC verification and anti-spoofing (`403`) are live and tested; external LLM chat generation remains disabled because no authenticated external chat endpoint (`ASTRAGRON_CHAT_ENDPOINT`) is configured. |
| Field-level validated farming recommendations (`field_validated`) | **BLOCKED (`false`)** | Outputs remain conditional / regional screening (`OK_COVERAGE_ONLY`, `REGIONAL_SCREENING_ONLY`, `OFFICIAL_VERIFICATION_REQUIRED` for C10 legal clearance); `marketable_yield` and `profit` remain `null`. |
| FAO GAEZ v4/v5 restricted/licensed layers & commercial geocoders | **Fail-Closed / Keyless Fallback Only** | Commercial geocoder API keys are not bundled; licensed FAO GAEZ layers remain gated unless supplied with explicit clearance (`docs/adaptive_evidence/SCIENTIFIC_LIMITATIONS.md`). |

---

## 4. Known Limitations

1. `npm run build` (`Next.js 16.4.6` Turbopack) prints 6 dynamic-filesystem tracing warnings on `src/server/corpus-integrity.ts` and `src/server/persisted-runtime-store.ts` while building cleanly (`exitCode: 0`).
2. `e2e/orbit-ab-benchmark.spec.ts:298` runs only on `desktop-chrome` and skips cleanly on `webkit-desktop`.
3. Runtime persistence uses JSON files under `data/runtime/` (`astragron-persisted-store.json` and `astragron-python-store.json`) suitable for single-node local verification; multi-worker horizontal deployment would require a shared database.
4. AI Chat answers are intentionally disabled (`503 CHAT_NOT_CONNECTED`) until an operator configures an allowlisted, verified grounded gateway (`ASTRAGRON_CHAT_ENDPOINT` + gateway allowlist/verification env settings).

---

## 5. Safe Rollback Procedure

To revert back to the pre-integration V7 baseline without touching protected M1–M14 files:

```bash
# 1. Preserve current unified integration work
git tag v7-unified-e2e-checkpoint HEAD

# 2. Check out a rollback branch at the verified pre-integration commit
git checkout -b rollback/v7-pre-unified-integration 0d3193f

# 3. Verify baseline integrity and frontend build
node scripts/verify-protected-files.mjs
npm run typecheck
npm run lint
npx vitest run
```
