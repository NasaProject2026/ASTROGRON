# Cross-Device Responsiveness, Accessibility, Security & i18n Audit (`G7` / `Q03–Q06`)

## 1. Responsive Matrix Across 11 Widths + Landscape (`Q03`)
Executed automatically in Playwright Test 3 against the production `next start` server (`review/evidence/responsive-overflow-matrix.json`):
- **Widths tested:** `320, 360, 375, 390, 430, 768, 820, 1024, 1280, 1440, 1920` px
- **Routes tested at every width:** `/`, `/explore`, `/farm/uppsala-demo/results`
- **Result:** **`33 / 33` combinations returned `ok: true` (`scrollWidth === innerWidth`)** — zero horizontal body overflow at any breakpoint.
- **Landscape mobile (`844x390`):** Verified cleanly in `15_explore_landscape_844x390.png` with interactive WebGL 3D Earth and accessible right sidebar controls.
- **1024px bottom toolbar collision check (`1024x768`, Playwright Test 5):** Bounding-box assertion verified `horizontalOverlap && verticalOverlap === false` between `globe-attribution-pill` and `map-draw-toggle-btn`.
- **Minor visual observation (`14_uppsala_results_mobile_390.png`):** Inside the 2-column compact mobile nav card at `390px`, `Provenance Center` clips right edge as `Provenance Cen` without overflowing the page or card bounds.
- **Device Scope Limitation:** All browser checks ran on Chromium under `Windows_NT 10.0.19045 x64`; **physical Apple Safari / iOS hardware was not tested** due to OS availability constraints.

## 2. Accessibility & Reduced Motion (`Q04`, `V06`)
- **Dialog focus return & Escape dismissal:** Proven in Playwright Test 4—opening `provenance-drawer` via button click, pressing `Escape` closes the dialog and restores `document.activeElement` to the triggering `inspect-evidence-btn`.
- **Non-color-only state cues:** Readiness and M4/M14 badges pair semantic icons (`CheckCircle2`, `AlertTriangle`, `ShieldAlert`, etc.) with uppercase text labels and `role="status"` announcements on blocked/outage panels.
- **Reduced motion (`V06`):** Playwright Test 3 emulates `reducedMotion: 'reduce'` across landing and explore routes without runtime errors or clipped static hero layout; CSS media query + store toggle suppress orbital sweep/pulse animations.
- **Limitation note:** Automated WCAG audits (e.g., axe-core full-tree sweep) and physical screen reader (NVDA/VoiceOver) sessions were not separately executed; keyboard focus and Escape return were verified directly.

## 3. Security, Privacy & No M14 Leakage (`Q05`, `P03`)
- `isSafeExternalUrl()` in `src/domain/contracts.ts` blocks unsafe URL protocols (`javascript:`, `data:`, non-HTTP/HTTPS external links), covered by `tests/v4-precision-gates.test.ts`.
- Persisted `localStorage` drafts are parsed/sanitized on hydration in `use-astragron-store.tsx` so tampered or modified `uppsala-demo` entries fork away cleanly rather than overwriting the immutable baseline.
- No `.env` secrets, telemetry beacons, or hidden GPS polling exist.
- Protected M14 corpus hash scan (`a27063ce2eca13f02e03`, `fa0e548ed3a7ccbcad4e`) confirmed **0 occurrences** across `src/`, `app/`, `scripts/`, and `public/`.

## 4. i18n Readiness (`Q06`)
- Active UI stays strictly English (`en`), with reusable status card messages (`statusCards` across all 8 codes) centralized inside `src/messages/en/index.ts`, locale helpers verified in `tests/remediation-gates.test.ts` and `tests/v4-precision-gates.test.ts`, and RTL/logical readiness groundwork preserved without spending scope on translations.
