# ASTRAGRON Farmer-First UX Changelog

**Base Commit (`main`):** `73073f1019d5ad591f0dd9f41369b14584532ae4`  
**Feature Branch:** `feat/farmer-first-ux`

## 1. Summary of UX Simplification & Capabilities Added

1. **Minimal Global Header & Workspace Navigation (`src/components/navigation/app-chrome.tsx`)**
   - Default Farmer view consolidates global header navigation into **3 primary destinations** (`My Farms` `/farms`, `Explore Map` `/explore`, `Help / More` menu with `Methodology`, `View Research Demo`, `Settings`, and `View Mode` switcher) plus a single `+ Add Farm` button (`/farm/new`).
   - Farm workspace simplifies default tabs to **4 core stages** (`My Farm` `/farm/[id]`, `Analysis` `/farm/[id]/analysis`, `Report` `/farm/[id]/results`, `Ask ASTRAGRON` `/farm/[id]/chat`) plus `Edit Fields & Info`.
   - Deep scientific views (`/coverage`, `/evidence`, `/plans`, `/climate`, `/decisions`, `/reports`) and the `DatasetModeSwitch` remain preserved and accessible under a collapsed `Scientific Details & Exports` disclosure (automatically expanded when switching to `Scientific View`).
   - Added `prefetch={false}` on chrome, footer, and hero links to prevent WebKit speculative RSC fetch aborts during transitions.

2. **First-Class `My Farms` Library (`/farms`, `src/components/farms/*`, `src/adapters/storage-adapters.ts`)**
   - Strictly separates `Your Farms` (`Saved on this device`) from immutable `Research Examples` (`Uppsala`, `Nyeri`, `Wagga Wagga`).
   - Supports **Rename**, **Duplicate** (keeps user on `/farms` for user farms; opens editable fork from Research Examples), **Archive / Unarchive**, and two-step confirmed **Delete**.
   - Adds deterministic checksum-verified **JSON Backup Export & Import** (`FarmBackupBundle`) plus explicit `StorageWriteOutcome` error banner surfacing.

3. **3-Stage Farmer Land Setup Wizard (`src/components/forms/farm-setup-wizard.tsx`)**
   - Restructured 5 technical steps into 3 farmer-facing stages:
     - `1. Where is your farm?` (name, offline 16-locality search, coordinates, browser GPS geolocation, GeoJSON boundary upload)
     - `2. Mark your fields` (SVG plot preview, vertex/GeoJSON polygon editing, geodesic area computation, rainfall/irrigation selection)
     - `3. Review & save` (clean summary + collapsed `wizard-optional-agronomy` disclosure for sowing/harvest dates and optional N/P/K/soil fields while keeping unknown metrics `null`)
   - Fixed React key stability (`key={initialFarmId || 'fresh'}`) and waited for `prefsHydrated` before mounting inputs so user edits never reset across wizard transitions or WebKit hydration.

4. **Truthful Capability Handshake & Indeterminate Orbital Analysis (`app/api/capabilities`, `app/api/farms/[farmId]/analyses`, `app/api/analyses/[jobId]`, `app/farm/[id]/analysis/page.tsx`)**
   - Added typed `SystemCapabilitiesResponse` and `AnalysisJobRecord` contracts (`src/domain/farmer-ux-contracts.ts`).
   - Uses an indeterminate orbital scan animation (with `prefers-reduced-motion` static fallback) and never displays fake `0-100%` timers offline.
   - Persists active `jobId` per farm in `sessionStorage` (`data-job-id`) across page reloads.

5. **Canonical Farmer Report, Multi-Page Binary PDF & Snapshot History (`src/lib/pdf-report.ts`, `app/api/reports/pdf/route.ts`, `src/components/report/*`, `app/farm/[id]/results/page.tsx`, `app/farm/[id]/reports/page.tsx`)**
   - Pure TypeScript deterministic multi-page `%PDF-1.4` binary generator with valid `xref` byte-offset table, WinAnsi sanitization, mode banners, field tables, input revision stamp, and explicit `"EVIDENCE AVAILABILITY REPORT -- NO CROP RECOMMENDATION AVAILABLE"` disclosure on unqualified runs.
   - Added persistent `ReportStorageAdapter` history list (`Saved Report History`) per farm and stale-report detection banner (`Previous analysis: inputs have changed`) whenever `inputRevision` changes after snapshot creation.
   - Preserved original scientific tables, CSV/JSON downloads, `FailClosedStatusCard`, and Recorded M14 Zones 1–3 alongside simple charts (`FarmerReportCharts`).

6. **Contextual Scoped `Ask ASTRAGRON` (`app/api/reports/[reportId]/chat/route.ts`, `src/components/chat/ask-astragron-panel.tsx`, `app/farm/[id]/chat/page.tsx`)**
   - Scoped strictly by `(farmId, reportId, inputRevision)`.
   - When `ASTRAGRON_CHAT_ENDPOINT` is unset, `POST /api/reports/[reportId]/chat` fails closed with HTTP `503 CHAT_NOT_CONNECTED`, composer remains visibly disabled (`Unavailable until analysis assistant is connected`), and deterministic prompt chips show a zero-hallucination **Non-AI Report Guide** sourced only from the active `ReportEnvelope`.

---

## 2. Complete Inventory of Changed & Added Code Files

### Protected Baseline Verified Unmodified (`git diff 73073f1019d5ad591f0dd9f41369b14584532ae4` = empty)
- `src/data/*` (M14 Recorded SE_UPPSALA & M4 Global Coverage fixtures and SHA-256 receipts)
- `src/adapters/repositories.ts`
- `src/server/corpus-integrity.ts`
- `public/assets/*` (`orbital-earth-horizon-wide.jpg`, `orbital-earth-horizon-mobile.jpg`, `agricultural-watershed-swath.jpg`)
- `src/components/maps/earth-explorer-client.tsx`

### Modified Existing Files (12 code & E2E files)
| File | Role |
|---|---|
| `src/components/navigation/app-chrome.tsx` | Minimal farmer nav chrome, collapsed scientific disclosure, `prefetch={false}` |
| `src/components/hero/cinematic-landing.tsx` | Returning-user dynamic CTA (`Add a Farm` / `Open My Farms (N)`), `prefetch={false}` |
| `src/components/forms/farm-setup-wizard.tsx` | 3-stage wizard, optional agronomy disclosure, stable key & `prefsHydrated` guard |
| `src/hooks/use-astragron-store.tsx` | Typed adapters integration (`UserFarmDraft`, `ReportSnapshot`, backup/restore, storage error state) |
| `app/farm/new/page.tsx` | Support `?from=` editing without mutating protected fixtures |
| `app/farm/[id]/page.tsx` | Farmer-first `My Farm` overview + polygon preview + clear coverage CTA |
| `app/farm/[id]/analysis/page.tsx` | Live capabilities check, server job trigger/poll/cancel, session `jobId` reload persistence, snapshot saving |
| `app/farm/[id]/results/page.tsx` | Canonical farmer summary + saved report history + PDF download + Ask ASTRAGRON sidebar alongside preserved M14 Zones |
| `app/farm/[id]/reports/page.tsx` | Added binary `%PDF-1.4` download buttons across M14 and coverage-only views |
| `e2e/astragron-journey.spec.ts` | Updated line 165 wizard heading matcher for 3-stage heading |
| `e2e/v4-review-regressions.spec.ts` | Updated selectors for intentional farmer navigation & Help menu consolidation |
| `e2e/v5-acceptance-gates.spec.ts` | Updated selectors for Simple View disclosure & farmer wizard headings |

### Added Files (21 code & test files + 8 review deliverables)
- **Domain, Hashing & PDF:** `src/domain/farmer-ux-contracts.ts`, `src/lib/deterministic-hash.ts`, `src/lib/pdf-report.ts`, `src/lib/capabilities-client.ts`
- **Adapters & Server Services:** `src/adapters/storage-adapters.ts`, `src/server/capabilities-service.ts`, `src/server/analysis-job-store.ts`
- **Next.js API Routes:** `app/api/capabilities/route.ts`, `app/api/farms/[farmId]/analyses/route.ts`, `app/api/analyses/[jobId]/route.ts`, `app/api/reports/[reportId]/chat/route.ts`, `app/api/reports/pdf/route.ts`
- **Pages & UI Components:** `app/farms/page.tsx`, `app/farm/[id]/chat/page.tsx`, `src/components/farms/farm-polygon-preview.tsx`, `src/components/farms/my-farms-dashboard.tsx`, `src/components/report/farmer-report-panel.tsx`, `src/components/report/farmer-report-charts.tsx`, `src/components/chat/ask-astragron-panel.tsx`
- **Automated Tests:** `tests/farmer-first-ux.test.ts`, `e2e/farmer-first-ux.spec.ts`
- **Review Documentation & Manifest:** `review/BEFORE_UX_AUDIT.md`, `review/FARMER_UX_CHANGELOG.md`, `review/BACKEND_HANDOFF_API_CONTRACT.md`, `review/UNAVAILABLE_FEATURES.md`, `review/ROLLBACK_GUIDE.md`, `review/TEST_AND_BUILD_EVIDENCE.md`, `review/04_ACCEPTANCE_MATRIX.csv`, `review/FARMER_FIRST_SHA256_MANIFEST.json`
