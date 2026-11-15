# ASTRAGRON — Accessibility & Performance Audit (`ACCESSIBILITY_AND_PERFORMANCE.md`)

## 1. Accessibility Architecture (WCAG 2.2 AA Alignment)

1. **Contrast & Color Independence:**
   - Primary text `#F1F7FD` on `#050A12` (`18.4:1`) and `#07111F` (`16.9:1`) exceeds WCAG AAA (`7:1`).
   - Primary action buttons use near-black `#081521` text on `#72E4F1` cyan (`11.2:1` contrast).
   - Every `CoverageStatusBadge` and `EvidenceClassBadge` pairs a distinct vector icon with the explicit uppercase text status (`AVAILABLE`, `CONDITIONAL`, `INSUFFICIENT_EVIDENCE`, `OUT_OF_COVERAGE`, `TEMPORARILY_UNAVAILABLE`) so color is never the sole indicator of scientific qualification.

2. **Keyboard, Screen Reader & Non-WebGL Alternatives:**
   - Global focus ring (`2px solid #72E4F1`, `outline-offset: 2px`) on `:focus-visible`.
   - The `/explore` globe provides full non-map keyboard/form alternatives: Search & Presets, Decimal `[Lon, Lat]` inputs, DMS converter, GeoJSON text validator, and manual hectare declaration.
   - If WebGL is disabled or unavailable, `MapLibreGlobeCanvas` automatically renders an accessible 2D equirectangular SVG coordinate/polygon selector.
   - On `/farm/[id]/climate`, Apache ECharts plots are accompanied by an accessible HTML companion data table with explicit units and `NULL (Gap)` indicators.
   - `ScientificProvenanceDrawer` uses `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and supports `Escape` key dismissal.

3. **Motion Sensitivity:**
   - `@media (prefers-reduced-motion: reduce)` and the in-app Reduced Motion toggle (`/settings`) disable the orbital drift animation and use instant `duration: 0` camera transitions on the map.

---

## 2. Performance & Core Web Vitals Engineering

- **Zero-Hydration-Block Hero:** The `/` hero renders an instant static orbital image (`/assets/hero-earth-orbital.jpg`) and typography without waiting for heavy 3D WebGL scene initialization.
- **Route-Level Code Splitting:** Heavy geospatial (`maplibre-gl`, `@turf/turf`) and analytical charting (`echarts`) libraries are dynamically imported inside client effects only on the routes that need them (`/explore` and `/farm/[id]/climate`).
- **Demand-Driven Rendering:** No perpetual 60fps background canvas loop is executed offscreen.
