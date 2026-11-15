# ASTRAGRON — Accessibility & Performance Audit (`ACCESSIBILITY_PERFORMANCE.md`)

See also [ACCESSIBILITY_AND_PERFORMANCE.md](./ACCESSIBILITY_AND_PERFORMANCE.md) for the complete accessibility and performance breakdown.

## Summary Checklist

- **WCAG 2.2 AA Contrast:** Verified across `#050A12`, `#07111F`, `#0D2031`, and `#72E4F1` CTA surfaces.
- **Non-Color-Only Qualification:** All M4 coverage statuses and evidence classifications render explicit text labels + icons.
- **No-WebGL Fallback:** Automatic interactive 2D equirectangular SVG fallback on `/explore`.
- **Accessible Chart Companion Tables:** Full HTML `<table>` companion with explicit units and `NULL (Gap)` preservation on `/farm/[id]/climate`.
- **Reduced Motion:** Honors OS `prefers-reduced-motion: reduce` and manual toggle in `/settings`.
- **Dynamic Code Splitting:** `maplibre-gl` and `echarts` are dynamically imported on client mount to keep initial LCP fast.
