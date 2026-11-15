# Real Build, Unit, Network & Production Browser Verification Proofs (`G7`)

All commands listed below were re-executed after the final source edit in `d:\NASA space app\ASTRAGRON-FRONTEND` on **`Windows_NT 10.0.19045 x64`**, **`Node v22.14.0`**, **`Next.js 16.4.6`**, **`MapLibre GL 6.18.0`**, **`Vitest 3.2.7`**, and **`Playwright 1.65.0`**.

## 1. Exact Build & Static Verification Commands
| Step | Command | Exit Code | Observed Result |
| --- | --- | --- | --- |
| TypeScript | `npm run typecheck` (`tsc --noEmit`) | `0` | Zero TypeScript errors |
| ESLint | `npm run lint` (`eslint src app`) | `0` | Zero lint errors |
| Vitest | `npm test` (`vitest run`) | `0` | **3 files, 47/47 tests passed** (0 failed, 0 skipped) |
| Production Build | `npm run build` (`next build`) | `0` | Compiled & generated all static/dynamic App Router routes cleanly |

## 2. Vitest Breakdown (`47/47` Passed)
- `tests/contracts-and-adapters.test.ts`: **33/33 passed** — schema contracts, synthetic arithmetic (`12 policies × 9 states`), cross-site isolation (`nyeri-kenya`, `wagga-australia`, unknown sites), WGS84 geodesic spherical area, GeoJSON validation, DMS bounds.
- `tests/remediation-gates.test.ts`: **8/8 passed** — deduplicated presets, legacy aliases, fail-closed coverage context, MapLibre 3D globe style & offline filtering, `assets-manifest.json` integrity, i18n formatting helpers, Uppsala climate series label.
- `tests/v4-precision-gates.test.ts`: **6/6 passed** — `S01–S04` immutable revision & blocked downstream routes/exports, `S05–S08` hash absence & isolation, `E01–E06` site/mode-scoped evidence without Uppsala fallback, `G01–G08` signed negative/zero DMS + conflict/range rejection, `Q05–Q06` safe URL filter + complete 8-code `statusCards` i18n coverage, `P01` manifest path traversal/normalization/symlink guardrails.

## 3. Production Playwright Browser E2E (`5/5` Passed against `next start --port 3000`)
Command: `npx playwright test --reporter=list` (Exit `0`, duration `1.5m`)
1. **Desktop `1440x900` Earth-to-Field Journey (33.6s):** Verified hero -> WebGL 3D globe -> live remote EOX 2016 / OpenFreeMap / NASA GIBS tiles -> Uppsala synthetic results -> scoped provenance drawer -> five-year matrix -> climate chart -> exports -> Kenya `MODEL_UNQUALIFIED` isolation -> unknown site `SITE_NOT_FOUND`.
2. **Simulated WebGL Failure (`?mapFallback=1`, 2.5s):** Verified 2D Natural Earth SVG fallback renders cleanly without crashing.
3. **Mobile `390x844`, Landscape `844x390`, Reduced Motion & 11-Width Matrix (28.3s):** Verified `33/33` width×route combinations (`320`..`1920`) have zero horizontal overflow (`review/evidence/responsive-overflow-matrix.json`).
4. **Immutable Uppsala Fork, Signed DMS Sync, Multi-Route Fail-Closed & Escape Focus Return (14.6s):** Verified Explorer geometry/area edits fork to unique `custom-uppsala-*` ID, `/results` blocks under `ANALYSIS_NOT_RUN_FOR_INPUT_REVISION` (`16_custom_uppsala_fork_blocked_1440.png`), untouched `uppsala-demo` recovers original results cleanly, and `Escape` closes provenance drawer restoring trigger focus.
5. **Real WebGL 3D Tile Outage Fallback & 1024px Collision Check (7.9s):** Aborted `tiles.maps.eox.at`, `tiles.openfreemap.org`, and `gibs.earthdata.nasa.gov`, zoomed to Uppsala -> Basin (`z6.5`), confirmed persistent `IMAGERY_PROVIDER_BLOCKED` + visible amber banner + Natural Earth 1:110m coastlines (`17_webgl_tile_outage_natural_earth_3d_1440.png`), then verified zero overlap between attribution pill and Draw button at `1024x768`.

## 4. Network Tile Proof (`review/evidence/tile-network-proof.json`)
- **Total HTTP 200 tile/style responses captured in live Chromium run:** **`94 / 94`**
  - OpenFreeMap Planet Vector (`tiles.openfreemap.org`): **`13`**
  - EOX S2Cloudless 2016 (`tiles.maps.eox.at/.../s2cloudless_3857/...`): **`37`**
  - NASA GIBS Blue Marble (`gibs.earthdata.nasa.gov/...`): **`44`**
- Direct EOX probe (`review/evidence/eox-license-check.json`): HTTP `200`, `15,002` bytes JPEG + `WMTSCapabilities.xml` HTTP `200` confirming CC BY 4.0.
