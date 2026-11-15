# Known Defects, Honest Limitations & Unresolved Blockers (`V4`)

In compliance with V4 honesty rules (`P05` and Section G9), this document lists every remaining partial item, UI minor imperfection, and environmental limitation observed directly during verification.

## 1. Automated Verification Gaps (`PARTIAL` on P1 Gates)
1. **`M03` (HTTP `403` / `429` / `5xx` explicit Playwright mock):**
   - `maplibre-globe-canvas.tsx` implements explicit status handling for HTTP `401 / 403 / 429` (`setProviderStatus('PERMISSION_BLOCKED')` + `IMAGERY_PROVIDER_BLOCKED`), and Playwright Test 5 proved connection abort (`route.abort('failed')`) transitions cleanly into `IMAGERY_PROVIDER_BLOCKED` with Natural Earth 1:110m coastlines. However, an explicit Playwright route mock returning HTTP `403` / `429` / `503` headers was not separately added as a standalone test case.
2. **`M06` (Throttled Slow-Network Fly-To Video):**
   - Progressive `Streaming tiles…` feedback and live orbital-to-Uppsala (`z1.4 -> z11.4`) tile streaming (`37` EOX 2016 HTTP 200 responses) are proven cleanly on standard broadband. A dedicated Chrome DevTools Protocol (CDP) `3G` throttled fly-to capture was not separately executed.
3. **`M08` (Browser Geolocation Permission Denial Mock):**
   - Network `offline`/`online` listeners, outage handling, and primary coordinate search / Decimal / signed DMS / GeoJSON text entry work cleanly without geolocation permission. Browser `context.setPermissions([])` geolocation denial prompt mocking was not separately automated in Playwright.

## 2. Visual & UX Observations
1. **390px Mobile Sidebar Label Clip (`14_uppsala_results_mobile_390.png`):**
   - Inside the compact 2-column farm navigation grid at `390px` viewport width, the button text `Provenance Center` clips slightly on the right inside its card as `Provenance Cen`. Document width stays exact (`scrollWidth: 390 === innerWidth: 390`), and navigation remains clickable cleanly.
2. **Hero Artwork Continuity (`01_landing_desktop_1440.png`):**
   - V4 upgraded the hero visually via atmospheric cyan limb glow, SVG orbital sweep trajectory, eager loading, and `IntersectionObserver` / `prefers-reduced-motion` animation suspension around the bespoke V3 Earth/spacecraft artwork rather than introducing a separate Three.js interactive spacecraft mesh (avoiding WebGL double-context weight on mobile landing).

## 3. Runtime Environment, Device & Accessibility Boundaries
- **No Physical Apple iOS / Safari Verification:** All browser E2E runs (`1440x900`, `1024x768`, `844x390` landscape, `390x844` mobile, and `320`–`1920` matrix) ran in Playwright Chromium on `Windows_NT 10.0.19045 x64`. Real iPhone/iPad Safari WebGL & touch pinch behavior was not hardware-tested here.
- **Manual Screen-Reader / Full Axe Sweep:** Keyboard `Escape` closing and trigger focus return were automated and verified cleanly in Playwright Test 4; full assistive-technology screen-reader traversal (VoiceOver/NVDA) and automated axe-core audits were not separately executed.
- **Commercial Transferability of Commissioned JPEG Assets:** While EOX 2016 (`CC BY 4.0`), Natural Earth (`CC0 1.0`), MapLibre (`BSD-3-Clause`), and Google Fonts (`SIL OFL 1.1`) hold open licenses, the three custom JPEG editorial scenes under `public/assets/` are proprietary project visuals requiring owner sign-off before redistribution outside review.

## 4. Scientific Backend Separation (Intentional Research Boundary)
- **Live Scientific Backend Unconnected (`BACKEND_NOT_CONNECTED`):** `REAL_SCIENTIFIC_BACKEND` and `RECORDED_M14_RESEARCH` fail closed by architectural design (`SOURCE_NOT_PROVIDED`). Custom farmer domains (`custom-uppsala-*`, `nyeri-kenya`, `wagga-australia`, unknown IDs) remain strictly blocked from displaying M14 synthetic decision rankings.
