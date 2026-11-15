# V4 Baseline Snapshot & Changed Paths Inventory

## 1. Baseline Preservation (`G0`)
- **Frontend Root:** `d:\NASA space app\ASTRAGRON-FRONTEND`
- **V3 Pre-Repair Snapshot:** `review/V3_BASELINE_MANIFEST_SNAPSHOT.json` (`117` tracked entries using V3 Windows separators, preserved unmodified as the historical audit anchor).
- **V3 Pre-Repair Visual Baseline:** `review/screenshots_v3_before/` (`17` PNG captures captured prior to V4 edits for visual diff inspection).
- **Protected M1–M14 Scientific Backend:** Zero files read, modified, or bundled. Protected reference corpus hashes (`a27063ce2eca13f02e03`, `fa0e548ed3a7ccbcad4e`) are absent from `src/`, `app/`, `scripts/`, and `public/`, appearing solely inside negative assertions in `tests/`.

## 2. File Change Classification (Diff vs `V3_BASELINE_MANIFEST_SNAPSHOT.json`)
Comparing current project non-review source/test/config files (`77` files excluding `tsconfig.tsbuildinfo`, `.next`, `node_modules`, and `review/`):
- **Unchanged files:** `46`
- **Added files (`2` permanent):**
  - `scripts/verify-manifest.d.mts` — TypeScript declaration module exporting typed verifier APIs for unit tests.
  - `tests/v4-precision-gates.test.ts` — 6 targeted adversarial test suites (`S01–S08`, `E01–E06`, `G01–G08`, `Q05–Q06`, `P01`).
- **Modified files (`29`):**
  - **Domain & Fixture Contracts:** `src/domain/contracts.ts`, `src/domain/schemas.ts`, `src/fixtures/sites-and-coverage.ts`, `src/adapters/repositories.ts`, `src/messages/en/index.ts`
  - **Application State & Shared UI:** `src/hooks/use-astragron-store.tsx`, `src/components/design-system/primitives.tsx`, `src/components/evidence/provenance-drawer.tsx`, `src/components/forms/farm-setup-wizard.tsx`, `src/components/hero/cinematic-landing.tsx`, `src/styles/globals.css`
  - **3D Globe, Providers & Explorer:** `src/components/maps/map-providers.ts`, `src/components/maps/maplibre-globe-canvas.tsx`, `src/components/maps/earth-explorer-client.tsx`
  - **Routes (`app/`):** `app/methodology/page.tsx`, `app/farm/[id]/page.tsx`, `app/farm/[id]/analysis/page.tsx`, `app/farm/[id]/climate/page.tsx`, `app/farm/[id]/coverage/page.tsx`, `app/farm/[id]/decisions/page.tsx`, `app/farm/[id]/evidence/page.tsx`, `app/farm/[id]/plans/page.tsx`, `app/farm/[id]/reports/page.tsx`, `app/farm/[id]/results/page.tsx`
  - **Verification, Manifest Security & Documentation:** `scripts/verify-manifest.mjs`, `tests/remediation-gates.test.ts`, `e2e/astragron-journey.spec.ts`, `assets-manifest.json`, `README.md`

## 3. Superseded V3 Report Cleanup
Previously generated V3 markdown reports and V2 `screenshots_before/` inside `review/` were replaced by the standardized V4 deliverable set (`00_...` through `12_...`), while retaining `review/V3_BASELINE_MANIFEST_SNAPSHOT.json` and `review/screenshots_v3_before/` for provenance comparison.
