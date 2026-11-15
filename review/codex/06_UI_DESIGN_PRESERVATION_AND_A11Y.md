# 06 — Preserved V5 Design, Progressive Disclosure & Accessibility (WCAG AA)

## 1. Visual Preservation of V5
- Preserved V5 orbital artwork (`public/assets/*.jpg`), landing hero composition (`/`), MapLibre 3D globe experience (`/explore`), `/orbit-ab` comparison view, design tokens, and all workspace routes without downgrading or overwriting V5 artwork.
- Verified across captured `review/screenshots/after/` PNGs (`1920`, `1440`, `820`, `390`, `360`).

## 2. Progressive Disclosure, Mode Clarity & Hydration Correctness
- **Complexity Mode (`Simple View` / `Scientific View`):** Simplifies landing & dashboard noise while keeping scientific disclosures and limitations unmistakable (`e2e/v5-acceptance-gates.spec.ts`).
- **Dataset Mode (`SYNTHETIC_UI_DEMO` vs `RECORDED_M14_RESEARCH`):** Switches disclosure banners, footer badges (`RECORDED SCIENTIFIC ARCHIVE (READ-ONLY)`), provenance citations, and CSV export headers without ever mixing rows across modes.
- **Root-Cause Fixes Applied in Integration:**
  1. `src/components/design-system/primitives.tsx` (`ComplexityModeSwitch`, `DatasetModeSwitch`): Replaced `transition` with `transition-none` so `localStorage` client hydration switching active pills never creates mid-transition low-contrast frames caught by `@axe-core/playwright` in WebKit.
  2. `src/hooks/use-astragron-store.tsx` & `app/farm/[id]/reports/page.tsx`: Added `prefsHydrated` flag (`data-prefs-hydrated`) to gate CSV/JSON export controls until client preferences finish hydrating.

## 3. Centralized UI Copy
- English UI copy remains centralized in `src/messages/en/index.ts` and `src/lib/i18n.ts` to support future localization cleanly.
