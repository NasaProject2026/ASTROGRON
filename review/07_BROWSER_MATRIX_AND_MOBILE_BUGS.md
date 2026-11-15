# 07 — Cross-Browser Matrix, Responsive Verification & Mobile UX

## 1. Engine & Environment Coverage Matrix
| Engine / Device Target | Status in V5 | Scope & Evidence | Notes / Limitations |
| --- | --- | --- | --- |
| **Chromium / MS Edge (`desktop-chrome`)** | **PASSED** (`19/19` tests) | All E2E specs (`astragron-journey`, `v4-review-regressions`, `v5-acceptance-gates`, `orbit-ab-benchmark`), 4x CPU CDP benchmark, `@axe-core/playwright` (`0` violations across 8 routes), WebGL 3D globe + Three.js Landsat `GLB` | Simulated responsive viewports via Chromium |
| **WebKit / Desktop Safari (`webkit-desktop`)** | **PASSED** (`18/19` passed, `1` skipped) | All functional, Scientific Integrity, Simple View, GeoJSON upload, HTTP 403 retry recovery, and `@axe-core/playwright` (`0` violations across 8 routes) | `orbit-ab-benchmark.spec.ts` skipped (`NOT_APPLICABLE_NO_CDP`: Chromium CDP `setCPUThrottlingRate` unavailable in WebKit) |
| **Firefox (`firefox`)** | **NOT_TESTED** | Playwright Firefox browser binary not installed in this environment | Disclosed explicitly in `10_KNOWN_LIMITATIONS_AND_STOP_DECISION.md` |
| **Physical Mobile / Tablet Hardware (iOS Safari / Android Chrome)** | **NOT_TESTED** | Verified via Chromium & WebKit responsive viewport emulation only | Real mobile GPU thermal behavior & cellular latency unmeasured on physical devices |

---

## 2. Multi-Viewport Responsive & Overflow Audit (`0 px` Horizontal Overflow)
Verified across both Chromium and WebKit (`e2e/astragron-journey.spec.ts`, `e2e/v4-review-regressions.spec.ts`, `e2e/orbit-ab-benchmark.spec.ts`):
- **Phone Viewports:** `320x640`, `360x800`, `375x812`, `390x844`, `430x932`, and landscape `844x390` (`0 px` overflow; screenshots: `v42_reports_320.png`, `ab_07_mobile_320_*`, `ab_06_mobile_360_*`, `12_landing_mobile_390.png`, `13_explore_globe_mobile_390.png`, `14_uppsala_results_mobile_390.png`, `v42_plans_compare_mobile_390.png`, `15_explore_landscape_844x390.png`).
- **Tablet & Laptop Viewports:** `768x1024`, `820x1180` (portrait), `1024x768`, `1180x820` (landscape) (`0 px` overflow; `v42_header_1024.png`, `ab_03_tablet_portrait_820_*`, `ab_04_tablet_landscape_1180_*`).
- **Desktop Viewports:** `1280x800`, `1440x900`, `1920x1080` (`0 px` overflow; `01_landing_desktop_1440.png` through `ab_02_desktop_1920_*`).

---

## 3. Mobile & Accessibility Fixes Delivered in V5
1. **WCAG 2.1 Level A `label-content-name-mismatch` Fixed (`src/components/maps/earth-explorer-client.tsx`):**
   - Removed mismatched `aria-label` attributes on `preset-btn-${preset.id}` quick-jump buttons where accessible name failed to contain visible text. Re-verified across all 8 routes in BOTH Chromium and WebKit with `0` critical/serious/moderate Axe violations.
2. **Simple View Progressive Disclosure (`app/farm/[id]/results/page.tsx`, `app/farm/[id]/plans/page.tsx`):**
   - Plain-language summary leads at top of Results (`0 of 12`) and Plans (`Five-Year Crop Plan & Water-Deficit Check`) while full 5-card KPI grids, 6-row candidate matrices, and First Failure Witness tables collapse cleanly into semantic `<details>` spoilers when `complexityMode === 'SIMPLE'`, expanding automatically in `Scientific View` (`v5_simple_view_results_1440.png`, `v5_simple_view_plans_1440.png`).
3. **390px Explorer Globe Priority & Attribution Parity:**
   - Top-of-fold 3D globe with single search/location header, bottom `Map view · Adjust` sheet, and explicit historical mosaic disclosure (`Historical Imagery: EOxCloudless 2016 (CC BY 4.0 mosaic) ... — not live today's pixels`, verified in `13_explore_globe_mobile_390.png`).
