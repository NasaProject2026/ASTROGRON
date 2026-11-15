# Changelog Since V5 Slim Baseline (`UNPACKED_FRONTEND_V5_SLIM`)

**Verdict:** `RESEARCH_INTEGRATION_PASS` (`FIELD_VALIDATED = false`, `FIELD_RECOMMENDATION_ELIGIBILITY = BLOCKED`, `PUBLIC_RELEASE_ON_HOLD`, `SPACE_APPS_ELIGIBILITY_UNRESOLVED`)

All edits are isolated inside the integration working copy (`INTEGRATION_V5_WORK_20261113`), preserving all V5 hero/satellite artwork (`public/assets/*.jpg`, `/` hero, `/orbit-ab`, MapLibre 3D globe) and leaving protected baselines untouched (`0` files modified in `UNPACKED_*`). Exact file-level SHA-256 hashes (`22` modified files, `38` added files including `README_REPLAY.md`, `0` deleted files excluding `review/` artifacts) are recorded in `review/DIFF_MANIFEST.json`.

## Gate G1 — Strict Schema Validation & Integrity
- Added `src/domain/native-schemas.ts` with strict Zod validation (eliminating `z.any`, rejecting `NaN`/`Infinity`/negative physical quantities, distinguishing `null`/unmodeled ET0 from `0 mm`, preserving calendar-ineligible status for `10e4f587b144b38bae9d`).
- Extended `src/domain/contracts.ts` and `src/domain/schemas.ts` for explicit dataset mode (`SYNTHETIC_UI_DEMO` vs `RECORDED_M14_RESEARCH` vs fail-closed `REAL_SCIENTIFIC_BACKEND`) and M4 coverage separation.
- Added `tests/g1-strict-schemas.test.ts` (portable fallback from `../UNPACKED_*` to staged `src/data/*`).

## Gate G2 & G3 — Staged M14/M4 SHA-256 Verification & Read-Only Bridges
- Staged byte-identical recorded M14 research files (`src/data/m14-recorded/*`) and M4 global coverage corpus (`src/data/m4-global/*`).
- Implemented `src/server/corpus-integrity.ts` (runtime SHA-256 check against `OUTPUT_RECEIPT.json` and `DELIVERY_MANIFEST.json`; fails closed with `SOURCE_NOT_PROVIDED` on 1-byte tamper).
- Implemented `src/adapters/m14-recorded-translator.ts` and `src/adapters/m4-coverage-adapter.ts` preserving all 16 M14 policy IDs, 144 cases (`90 PASS / 45 FAIL / 9 CALENDAR_INELIGIBLE`), Pareto winners (`a27063ce2eca13f02e03` at `52,102.45 m³ eq`, `fa0e548ed3a7ccbcad4e` at `814.77 m³ eq`, `NO_UNIQUE_WINNER`), sensitivity bracket `[165.473239, 165.473240] mm`, and unit separation.
- Exposed read-only Next.js Route Handlers `app/api/research/m14/route.ts` and `app/api/research/m4-coverage/route.ts` with strict site allowlists (`SE_UPPSALA`, `KE_NYERI_REGION`, etc.) rejecting path traversal (`../etc/passwd` -> `400`).
- Added `scripts/build-verified-snapshot.mjs` generating `src/data/generated/verified-m14-m4-snapshot.json`.

## Gate G4 — Fail-Closed Server Geocoder Bridge
- Added `src/server/geocode-service.ts`, `src/adapters/geocoding-provider.ts`, and `app/api/geocode/route.ts` (SSRF fixed host allowlist, header/timeout bounds, no public Nominatim autocomplete; returns HTTP `503 GEOCODER_NOT_CONFIGURED` when unconfigured).
- Added `tests/g4-geocoder-security.test.ts` (`7/7` pass).

## Gate G5 & G6 — UI Integration, Hydration/Accessibility Fixes & E2E Proofs
- Integrated `DatasetModeSwitch`, mode-aware watermarks/footer badges, Recorded M14/M4 views, and hydration-safe export readiness across `app/farm/[id]/{results,decisions,coverage,climate,plans,evidence,reports,analysis}/page.tsx`, `app/methodology/page.tsx`, `src/components/charts/climate-echarts.tsx`, `src/components/navigation/app-chrome.tsx`, `src/components/maps/earth-explorer-client.tsx`, `src/hooks/use-astragron-store.tsx`, and `src/messages/en/index.ts`.
- Fixed WebKit `axe-core` WCAG AA transition contrast glitch (`src/components/design-system/primitives.tsx`: removed CSS `transition` on `ComplexityModeSwitch` & `DatasetModeSwitch` active color toggles), `prefsHydrated` export-button gating on `/farm/[id]/reports`, `_rsc` abort wait in `e2e/astragron-journey.spec.ts`, and `/explore` hydration race in `e2e/g6-integration-gates.spec.ts`.
- Added `e2e/g6-integration-gates.spec.ts`; verified `71/71` Vitest, `9/9` offline gates, clean production build, and `41 passed, 1 skipped, 0 failed` Playwright across `desktop-chrome` + `webkit-desktop` with `0` Axe critical/serious/moderate violations on all checked Chromium & WebKit routes.
