# BEFORE UX AUDIT — ASTRAGRON V5 Codex Integrated Baseline

**Date:** 2026-11-13  
**Base Commit SHA:** `73073f1019d5ad591f0dd9f41369b14584532ae4` (`main`)  
**Working Branch:** `feat/farmer-first-ux`

## 1. Baseline Verification Status (Pre-Edit)
- `npm run typecheck` (`tsc --noEmit`): PASS (exit `0`)
- `npm run lint` (`eslint src app`): PASS (exit `0`)
- `npm test` (`vitest run`): 7 test files, 71 tests PASS
- `npm run build` (`next build`): PASS (with 3 pre-existing dynamic-path Turbopack trace warnings in `src/server/corpus-integrity.ts`)

---

## 2. Screen-by-Screen Friction & Button Inventory (`KEEP` / `MERGE` / `MOVE-TO-ADVANCED`)

### A. Global Header & Mobile Navigation (`src/components/navigation/app-chrome.tsx`)
Current primary header shows:
- `Explore Earth` (`/explore`) -> **KEEP** (rename in Farmer mode to `Explore Map`)
- `How It Works` (`/methodology`) -> **MOVE-TO-ADVANCED** (inside `Help / More`)
- `Synthetic Demo` (`/farm/uppsala-demo/results`) -> **MOVE-TO-ADVANCED** (accessible cleanly from `My Farms -> Research Examples` + `Help / More` + hero secondary link)
- Missing `My Farms` (`/farms`) top-level destination -> **ADD** (1 of 3 max global header links)
- `ComplexityModeSwitch` (`Simple View` / `Scientific View`) directly on top bar -> **MERGE / MOVE-TO-ADVANCED** (accessible via `Help / More` menu and `/settings`, while keeping `data-complexity-mode` & switch on scientific surfaces so keyboard/regression checks continue seamlessly)
- `Help & Qualification` (`/help`) + `Settings` (`/settings`) icon links -> **MERGE** into `Help / More` menu
- `Set Up Farm Draft` (`/farm/new`) primary CTA button -> **KEEP** as contextual `+ Add Farm`

### B. Landing Page (`src/components/hero/cinematic-landing.tsx` & `app/page.tsx`)
- Preserves bespoke Earth horizon hero (`orbital-earth-horizon-wide.jpg` / `orbital-earth-horizon-mobile.jpg`), subtle orbital visuals, telemetry/editorial contrast.
- **Change:** Keep 1 clear primary CTA (`Add a Farm` -> `/farm/new` or `Open My Farms` -> `/farms` when saved farms exist) + `Explore Map` (`/explore`) and subordinate `Explore sample research` link (`/farm/uppsala-demo/results`). Preserve scientific disclosures & section layout integrity.

### C. Missing First-Class Farm Hub (`/farms` — "My Farms")
- **Gap:** Currently users only have `farmDrafts` inside `localStorage` (`astragron_demo_farm_drafts_v2`) surfaced implicitly in dropdown site-switchers without a management hub, backup/restore JSON UI, rename, duplicate, archive, or clear separation between user-saved farms and built-in research examples.
- **Target:** Dedicated `/farms` dashboard separating `Your Farms` (`Saved on this device`) vs `Research Examples` (`Uppsala`, `Nyeri`, `Wagga Wagga`), clean empty state, storage status & quota error surfacing, and JSON backup import/export with validation.

### D. Farm Workspace Shell (`FarmWorkspaceShell` in `src/components/navigation/app-chrome.tsx`)
Current desktop sidebar (`hidden lg:block`) exposes 4 nav groups & 10 links:
1. `Site & Setup`: `Farm Overview` (`/farm/[id]`), `Set Up Farm Draft` (`/farm/new`)
2. `Evidence & Coverage`: `Evidence Readiness` (`/farm/[id]/coverage`), `Provenance Center` (`/farm/[id]/evidence`)
3. `Scenario Analysis`: `Analysis Setup` (`/farm/[id]/analysis`), `Four Research Views` (inline? routes via results/decisions)
4. `Research Outcomes`: `Decision Overview` (`/farm/[id]/results`), `Five-Year Plan` (`/farm/[id]/plans`), `Climate & Water` (`/farm/[id]/climate`), `Decision Explorer` (`/farm/[id]/decisions`), `Reports & Export` (`/farm/[id]/reports`)
+ Inline `DatasetModeSwitch` (`Synthetic UI Fixture` vs `Recorded M14 Corpus`) + desktop site switcher `<select>`.

**Classification for Farmer Mode (Default):**
- Primary visible workspace tabs (4 concise destinations):
  - `My Farm` (`/farm/[id]`) — **KEEP**
  - `Analysis` (`/farm/[id]/analysis`) — **KEEP**
  - `Report` (`/farm/[id]/results`) — **MERGE** (`results` + farmer-friendly `Report` summary + `Download PDF` + snapshot history)
  - `Ask ASTRAGRON` (`/farm/[id]/chat` or drawer/tab) — **ADD**
- **MOVE-TO-ADVANCED** (housed cleanly under a single `More / Scientific Details` collapsible section/menu, expanded automatically when `Scientific View` is toggled):
  - `Evidence Readiness` (`/farm/[id]/coverage`)
  - `Provenance Center` (`/farm/[id]/evidence`)
  - `Five-Year Plan Matrix` (`/farm/[id]/plans`)
  - `Climate & Water Series` (`/farm/[id]/climate`)
  - `Pareto & Regret Explorer` (`/farm/[id]/decisions`)
  - `Reports & Data Export (CSV / JSON)` (`/farm/[id]/reports`)
  - `DatasetModeSwitch` (`Synthetic UI Fixture` vs `Recorded M14 Corpus`) — keep visible on scientific surfaces & inside `More / Scientific Details`.

### E. Farm Setup Wizard (`src/components/forms/farm-setup-wizard.tsx`)
Currently 5 steps (`1. Location & Precision`, `2. Fields & Boundaries`, `3. Soil, Water & Crops`, `4. Evidence Readiness`, `5. Analysis Path`):
- Steps 1 & 2 -> **MERGE / SIMPLIFY** into `1. Where is your farm?` (pin/search/GeoJSON/coords) & `2. Mark your fields` (draw/edit field boundaries, geodesic area check, crop/irrigation status).
- Step 3 (`Soil, Water & Crops`) -> **MOVE-TO-ADVANCED / COLLAPSE** inside Stage 3 `Review & save` as optional expandable section `"Add soil, water, and crop information (optional)"` (retaining `#wizard-sowing-date`, `#wizard-harvest-date`, N/P/K nulls, zero synthetic fill).
- Step 4 & Step 5 (`Evidence Readiness`, `Analysis Path`) -> **MERGE** into Stage 3 (`Review & save`) + immediate post-save `/farm/[id]/analysis` runner!

### F. Processing, Capabilities & Honest Status (`app/farm/[id]/analysis/page.tsx`)
- **Gap:** Currently `/farm/[id]/analysis` is static informational text explaining why live M14 backend isn't running, with no `/api/capabilities` handshake, no typed `AnalysisJobRecord` state (`QUEUED`, `RUNNING`, `COMPLETED_VERIFIED`, `COMPLETED_LIMITED`, `ABSTAINED`, `FAILED`, `CANCELLED`, `UNAVAILABLE`), and no visual analysis card showing indeterminate orbital pass over the user's selected polygon.
- **Target:** Add `/api/capabilities`, `/api/farms/[farmId]/analyses`, `/api/analyses/[jobId]`, interactive truthful analysis runner with honest indeterminate spinner/satellite scan (`prefers-reduced-motion` fallback) — zero fake `0–100%` timers.

### G. Reports, Charts, PDF & History (`app/farm/[id]/results/page.tsx` & `/reports/page.tsx`)
- **Gap:** Only CSV and JSON exports plus `window.print()` exist; zero binary `%PDF-` file generation, zero multi-report snapshot history (`ReportStorageAdapter`), zero stale-report warning when farm inputs are modified (`inputRevision` mismatch).
- **Target:** Pure-TS valid multi-page `%PDF` downloadable generator (`Download PDF`), snapshot history list per farm marking older runs `Previous analysis: inputs have changed`, farmer-friendly first-fold summary on `/results` with up to 2 clear ECharts figures (hiding scientific dense tables in collapsible `Scientific Details` / `Scientific View`).

### H. Contextual Q&A (`Ask ASTRAGRON`)
- **Gap:** No report-grounded contextual Q&A interface or `/api/reports/[reportId]/chat` endpoint exists yet.
- **Target:** Prominent contextual `Ask ASTRAGRON` side panel / mobile drawer + `/farm/[id]/chat` view with typed `ChatStorageAdapter`, `POST /api/reports/[reportId]/chat` returning `503 CHAT_NOT_CONNECTED` (or `OK` if upstream configured), strictly scoped by `(farmId, reportId, inputRevision)`, honest disabled state `Unavailable until analysis assistant is connected`, and non-AI `Report Guide` fallback.
