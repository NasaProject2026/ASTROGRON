# ASTRAGRON Smart Fields & Globe Coverage — Test & Build Evidence

This document records the exact, post-final-edit verification results executed on the `feat/smart-fields-coverage` branch after all code edits (`src/components/maps/maplibre-globe-canvas.tsx` and `app/farm/[id]/analysis/page.tsx`) completed.

---

## 1. Protected Baseline Integrity Check (`review/SMART_FIELD_PROTECTED_HASHES.json`)

| Check | Files Audited | Matching SHA-256 | Modified (`BAD`) | Status |
| --- | ---: | ---: | ---: | --- |
| Protected M1–M14 corpus, API adapters, & hero assets | 28 | 28 | 0 | **PASS** |

---

## 2. Static Checks, Unit/Integration Suite & Production Build

All commands below were executed sequentially from the project root after the final code edit, exiting `0` before the Playwright suite ran:

| Gate / Command | Result | Exact Summary / Observed Output |
| --- | --- | --- |
| `npm exec tsc -- --noEmit` | **PASS** (exit `0`) | Zero TypeScript compiler errors across `src/`, `app/`, `tests/`, and `e2e/`. |
| `npm run lint` (`eslint src app`) | **PASS** (exit `0`) | Zero ESLint errors or warnings blocking verification. |
| `node scripts/mobile-ux-offline-gates.mjs` | **PASS** (exit `0`) | `9/9 offline UI source invariants passed. Not a production browser test.` |
| `npx vitest run` | **PASS** (exit `0`) | `Test Files 9 passed (9)` · `Tests 92 passed (92)` in `19.60s`. |
| `npm run build` (`next build` Next.js 16.4.6 Turbopack) | **PASS** (exit `0`) | `12/12` static pages + dynamic/API routes built cleanly (`3` pre-existing dynamic-fs tracing warnings in `src/server/corpus-integrity.ts`). |

### Vitest Breakdown (`92/92` Passing Tests Across `9` Files)

| Test File | Passed | Scope Covered |
| --- | ---: | --- |
| `tests/smart-fields-and-coverage.test.ts` | 15 | Multi-provider Geoapify/MapTiler/Nominatim-block SSRF guard, FTW complete polygon vs clipped fragment rejection, Turf geodesic metrics & self-intersection rejection, KML/GPX/GeoJSON holes & MultiPolygon & XXE rejection, GPS walk filtering, neutral capability overlay & localized confirmed-unsupported footprints, fail-closed backend health & PDF parcel outline rendering |
| `tests/farmer-first-ux.test.ts` | 6 | Offline capabilities truthfulness, scoped Uppsala Recorded vs Nyeri coverage `ReportEnvelope`, `%PDF-1.4` binary generation, protected example integrity & stale revision checks, `(farmId, reportId, inputRevision)` chat isolation (`503` offline), non-fake analysis trigger/status/cancel & PDF export routes |
| `tests/g2-g3-recorded-m14-m4.test.ts` | 7 | `OUTPUT_RECEIPT.json` & `DELIVERY_MANIFEST.json` SHA-256 verification, 1-byte tamper fail-closed (`SOURCE_NOT_PROVIDED`), SE_UPPSALA scientific numbers & Pareto frontier, NASA POWER `2006/2012/2018` climate window, M4 global coverage across SE/KE/AU, `/api/research/m14` & `/api/research/m4-coverage` allowlist |
| `tests/g1-strict-schemas.test.ts` | 5 | Strict Zod validation schemas for recorded & domain contracts |
| `tests/contracts-and-adapters.test.ts` | 33 | Core domain adapters, storage adapters, units, and fail-closed contracts |
| `tests/v4-precision-gates.test.ts` | 6 | V4 baseline precision & layout regressions |
| `tests/remediation-gates.test.ts` | 8 | Historical remediation safety & scientific integrity invariants |
| `tests/p1-scientific-integrity.test.ts` | 5 | `inputRevision` invalidation across parameter/polygon edits, cross-site lookup isolation, `M4` vs `MODEL_UNQUALIFIED` vs `BLOCKED`, signed DMS & coordinate validation, English UI string invariants |
| `tests/g4-geocoder-security.test.ts` | 7 | SSRF non-HTTPS/localhost/RFC1918/IMDS rejection, explicit `nominatim.openstreetmap.org` block, unconfigured `503` fail-closed state, HTML/XSS sanitization, `504` timeout, `429` rate limit, client `AbortController` |

---

## 3. Production Browser Suite (`npx playwright test`)

- **Artifact outputs:** [`review/evidence/playwright-results.json`](file:///C:/Users/HP/.gemini/antigravity/brain/3ac899d3-46e0-4094-ad7f-0b55172ca787/scratch/astragron_farmer_first/FARMER_FIRST_WORK/review/evidence/playwright-results.json) & `review/evidence/playwright-junit.xml`
- **Run timestamp:** `2026-11-14T01:30:55.863Z` (`1,093,053.6 ms` / `18.2m`)
- **Overall outcome:** **`53 passed`, `1 skipped`, `0 unexpected`, `0 flaky`** (`EXIT=0`)

| Project | Passed | Skipped | Failed | Notes / Disclosed Skips |
| --- | ---: | ---: | ---: | --- |
| `desktop-chrome` | 27 | 0 | 0 | All 7 E2E spec files executed against `next start` production build (`127.0.0.1:3005`). |
| `webkit-desktop` | 26 | 1 | 0 | `e2e/orbit-ab-benchmark.spec.ts` is explicitly skipped on `webkit-desktop` by baseline spec configuration. |

### Smart Fields & Coverage Acceptance Suite (`e2e/smart-fields-coverage.spec.ts` — `6/6` Passing)

- **SF-1 (`desktop-chrome` + `webkit-desktop`):** Neutral `/farm/new` start (`No location selected yet`), mocked `/api/geocode` worldwide autocomplete (`Heilbronn`, `Damascus`), direct WGS84 coordinates, and `/explore` optional capability overlay toggle.
- **SF-2 (`desktop-chrome` + `webkit-desktop`):** Mocked `/api/field-boundaries/suggest` preview + accept, manual polygon draw + undo/redo, valid KML import + XXE rejection, and mocked `navigator.geolocation` perimeter walk & finish.
- **SF-3 (`desktop-chrome` + `webkit-desktop`):** Svalbard (`78.22° N, 15.63° E`) `CONFIRMED_UNSUPPORTED` red toast with `[Why?]` explanation, non-blocking save flow onto `/farm/[id]/analysis`, 8-viewport responsive zero-overflow matrix (`320, 360, 390, 768, 820, 1024, 1440, 1920` px width `scrollWidth - innerWidth <= 1`), `390px` capture, and Axe accessibility check (`0` critical/serious).

### Accessibility Audits (`@axe-core/playwright`)

| Evidence JSON | Project | Routes Audited | Critical / Serious Violations | Total Violations | Notes |
| --- | --- | --- | ---: | ---: | --- |
| `review/evidence/axe-audit-desktop-chrome.json` | `desktop-chrome` | `/`, `/explore`, `/methodology`, `/farm/uppsala-demo/results`, `/farm/uppsala-demo/coverage`, `/farm/uppsala-demo/plans`, `/farm/nyeri-kenya/results`, `/settings` | 0 / 0 | 0 | Full WCAG 2.0/2.1 A/AA (with `color-contrast`) |
| `review/evidence/axe-audit-webkit-desktop.json` | `webkit-desktop` | Same 8 core routes | 0 / 0 | 0 | Full WCAG 2.0/2.1 A/AA (with `color-contrast`) |
| `review/evidence/axe-farmer-first-desktop-chrome.json` | `desktop-chrome` | `/`, `/farms`, `/farm/new`, `/farm/uppsala-demo/results`, `/farm/uppsala-demo/chat` | 0 / 0 | 0 | Full WCAG 2.0/2.1 A/AA (with `color-contrast`) |
| `review/evidence/axe-farmer-first-webkit-desktop.json` | `webkit-desktop` | Same 5 farmer routes | 0 / 0 | 0 | Full WCAG 2.0/2.1 A/AA (with `color-contrast`) |
| `review/evidence/axe-recorded-m14-audit.json` | `desktop-chrome` | `/farm/uppsala-demo/{results,decisions,climate,evidence,reports}`, `/farm/nyeri-kenya/coverage` | 0 / 0 | 0 | Full WCAG 2.0/2.1 A/AA |
| `review/evidence/axe-recorded-m14-audit-webkit-desktop.json` | `webkit-desktop` | Same 6 recorded routes | 0 / 0 | 0 | Full WCAG 2.0/2.1 A/AA |

> **Rule Disclosure:** `SF-3` (`e2e/smart-fields-coverage.spec.ts`) invokes `.disableRules(['color-contrast'])` during its toast/overlay check on `/farm/new`, while `farmer-first-ux.spec.ts` runs full WCAG 2.0/2.1 A/AA contrast checks on `/farm/new` (`0` violations on both engines).

### Captured Smart Fields Visual Screenshots (`review/screenshots/smart_after/`)

- `wizard_search.png` (`141,464` bytes)
- `wizard_polygon_draw.png` (`170,888` bytes)
- `wizard_other_ways.png` (`168,071` bytes)
- `unsupported_toast_save.png` (`152,451` bytes)
- `explore_overlay.png` (`327,035` bytes)
- `mobile_390.png` (`58,864` bytes)

---

## 4. Truthful Separation: Live Network vs Mocked Tests vs Unconfigured Services

| Feature / Provider | How Verified Here | Live External State Without Secrets |
| --- | --- | --- |
| **Satellite & Vector Basemaps** (`EOxCloudless 2016`, `NASA GIBS`, `OpenFreeMap`) | Real live HTTP/WebGL tile streaming & outage 403 failover tested in `e2e/astragron-journey.spec.ts` Tests 1 & 5 and `e2e/v4-review-regressions.spec.ts` on Chromium & WebKit; `smart-fields-coverage.spec.ts` stubs raster tiles with `TINY_PNG` for deterministic offline repeatability. | Live public tiles render when online; HTTP 403/offline switches transparently to OpenFreeMap / bundled Natural Earth 1:110m vector fallback. |
| **Worldwide Geocoding** (`/api/geocode`) | SSRF, `nominatim.openstreetmap.org` block, Geoapify & MapTiler normalization tested in `vitest` (`smart-fields-and-coverage.test.ts`, `g4-geocoder-security.test.ts`); `SF-1` mocks `/api/geocode` responses in Playwright; unconfigured HTTP `503` verified live against `next start` in `g6-integration-gates.spec.ts`. | `UNCONFIGURED` (`503 GEOCODER_NOT_CONFIGURED`) until `ASTRAGRON_GEOCODE_PROVIDER` / API keys are supplied. Map click, DMS/WGS84 direct coordinates, and geolocation remain functional. |
| **FTW Boundary Suggest** (`/api/field-boundaries/suggest`) | Complete vs clipped fragment rejection & schema tests in `vitest`; `SF-2` mocks `/api/field-boundaries/suggest` in Playwright; unconfigured `UNAVAILABLE` fail-closed verified in `vitest`. | `UNAVAILABLE` until `ASTRAGRON_FTW_SUGGEST_ENDPOINT` / PMTiles endpoint is configured; falls back cleanly to manual polygon / GPS walk / import / quick rectangle. |
| **Live Farm Analysis / Ask ASTRAGRON / Remote Capabilities Feed** | Health-check fail-closed (`UNREACHABLE` / `503` without fake timers or dangling `QUEUED` jobs) verified in `vitest` and `g6-integration-gates.spec.ts` + `farmer-first-ux.spec.ts`. | `UNCONFIGURED` until `ASTRAGRON_BACKEND_URL`, `ASTRAGRON_AI_CHAT_ENDPOINT`, and `ASTRAGRON_CAPABILITIES_FEED_URL` are deployed. See `review/UNAVAILABLE_FEATURES.md`. |
