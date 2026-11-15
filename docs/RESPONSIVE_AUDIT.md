# ASTRAGRON — Responsive & Multi-Viewport Audit (`RESPONSIVE_AUDIT.md`)

## 1. Responsive Breakpoint & Viewport Strategy

Designed using fluid CSS grids (`max-w-[1440px]`, 12-column desktop layout) and verified across mobile, tablet, and desktop widths:

| Viewport Class | Tested Widths | Layout Adaptation |
|---|---|---|
| Small & Standard Mobile | `360px`, `375px`, `390px`, `430px` | Fluid hero headline (`clamp(34px, 8.5vw, 48px)`), collapsible mobile navigation drawer, stacked context & M4 coverage cards below globe on `/explore`, and dedicated **Mobile Year Viewer (H1–H5)** on `/farm/[id]/plans` so users never squint at 15 microscopic columns. |
| Tablet (Portrait & Landscape) | `768px`, `820px`, `1024px` | 2-column capability and policy grids, horizontal scroll stage stepper for `/farm/[id]/*` sub-routes, touch-friendly `>= 42px` buttons. |
| Desktop & Wide Mission Control | `1280px`, `1440px`, `1920px` | Asymmetric 7/5 hero composition on `/`, 8/4 globe + context panel split on `/explore`, sticky 3-column stage sidebar + 9-column workspace on `/farm/[id]/*`. |

---

## 2. Mobile-Specific Ergonomics Verified

1. **Five-Year Plan Matrix (`/farm/[id]/plans`):**
   - Includes a dedicated mobile H1–H5 year selector card stack on `< 768px` screens in addition to a sticky-first-column horizontal scroll table.
2. **Navigation (`/farm/[id]/*`):**
   - Replaces a cluttered 14-link bottom bar with an accessible top menu drawer + grouped stage navigation (`1 · Site & Setup`, `2 · Evidence & Coverage`, `3 · Analysis Setup`, `4 · Research Outcomes`).
3. **Touch Targets:**
   - Primary buttons (`h-11` to `h-13`, `44px–52px`), map zoom/drawing controls (`40px × 40px`), and wizard step tabs meet touch ergonomics.
