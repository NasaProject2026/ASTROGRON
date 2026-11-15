# Cinematic Orbital Art Direction & UX Improvements (V3 Before vs V4 After)

## 1. Visual Inspection Methodology
Every visual change was verified by side-by-side comparison of `review/screenshots_v3_before/*.png` against fresh V4 production browser captures (`review/screenshots/*.png`) rendered via `next start`, plus three full-session `.webm` recordings in `review/videos/`.

## 2. Landing Hero Upgrades (`G6` / `V01`, `V02`, `V06`)
- **Desktop & Mobile Captures:** `01_landing_desktop_1440.png` (vs `screenshots_v3_before/01_landing_desktop_1440.png`) and `12_landing_mobile_390.png`.
- **Upgrades Applied:**
  - Retained V3's bespoke Low Earth Orbit horizon + foreground satellite composition (full-bleed edge-to-edge frame without boxed borders), adding an atmospheric cyan limb halo wash, starlight depth layer, and a crisp SVG orbital trajectory arc above Earth's horizon.
  - Added eager hero image loading attributes and `IntersectionObserver` + `prefers-reduced-motion` animation suspension (`cinematic-landing.tsx`, `globals.css`) so motion pauses completely off-screen or under reduced-motion settings.
  - Explicit caption disclosures at bottom-right/mobile caption (`Illustrative Low Earth Orbit scene · Proprietary editorial visual, not a NASA photo or live telemetry`), non-endorsement notice, clear primary CTA **`Explore Earth`**, and secondary CTA **`View a Research Demo`**.
  - **Honest Visual Note:** V4 enhanced the atmospheric/orbital optical framing around V3's commissioned artwork base rather than commissioning a separate 3D spacecraft model; motion in production Chrome desktop and mobile sessions is captured in `review/videos/01_desktop_earth_to_field_journey.webm` and `02_mobile_390_earth_to_results.webm`.

## 3. Explorer, Results & Five-Year Mobile Experience (`V03`, `V04`, `V05`, `V07`)
- **Explorer (`screenshots_v3_before/02b_...png` -> `screenshots/02b_...png`):**
  - Replaced misleading `"Live Satellite Earth (NASA GIBS + Sentinel-2 2017)"` telemetry text with **`Historical Satellite Mosaic · EOX S2Cloudless 2016 (CC BY 4.0) + NASA GIBS`**.
  - Replaced misleading green `AVAILABLE` pill with amber `CONDITIONAL` pill and separated the 3-axis readiness card (`Satellite & Weather Sources`, `Crop & Water Simulation`, `Real Farm Advice`).
  - Clarified `Preview Box Area: 34.2 ha` alongside `Model parcels F1–F3 = 24.0 ha`.
- **Mobile 390px Globe (`13_explore_globe_mobile_390.png`):** Interactive WebGL 3D Earth, zoom controls, drawing toolbar, and full EOX 2016 / OSM / NASA GIBS / Natural Earth CC0 attribution remain cleanly framed at 390px without horizontal overflow (`scrollWidth === 390`).
- **Simple View Results (`05_uppsala_results_1440.png`, `14_uppsala_results_mobile_390.png`):** Leads directly with plain-language decision framing (`"No tested policy meets the declared water-service criterion across all 9 scenario states in this synthetic demonstration..."`, `0 of 12 plans pass every scenario`) before metrics (`108` evaluations, `99` valid, `66` passes, `33` failures, `9` calendar invalid) and `M14` technical details.
- **Five-Year Plan Matrix (`app/farm/[id]/plans/page.tsx`, `07_uppsala_plans_1440.png`):** Desktop shows the full field × 5-year table, while viewports `< md` hide the wide desktop table in favor of touch-friendly stacked mobile field cards.
- **Token Consistency (`V07`):** Maintained `#050A12` / `#07111F` space slate palette, `#0D2031` surfaces, `#72E4F1` / `#43C9C1` orbital cyan/teal accents, `#F1F7FD` / `#AEC4D3` accessible typography, and 12/16/20px panel radii.
