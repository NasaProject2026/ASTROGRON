# ASTRAGRON — Orbital Intelligence Design System (`DESIGN_SYSTEM.md`)

## 1. Creative Thesis & Explored Variations

**Art Direction Title:** `ORBITAL INTELLIGENCE / ASTRAGRON`

During Phase 1 creative exploration, three distinct visual compositions were evaluated:
1. **Variation A — Nadir Telemetry HUD:** Top-down satellite viewfinder with heavy sci-fi corner brackets and dense overlay telemetry. *Rejected* because ornamental HUD chrome competed with serious numerical tables and degraded small-screen legibility.
2. **Variation B (Selected) — Asymmetric Orbital Limb + Calm Mission Control:** Deep space (`#050A12`) occupying the left ~42% of the hero frame for high-contrast editorial typography (`Space Grotesk`), paired with a photorealistic curved Earth horizon and scientific Earth-observing spacecraft on the right ~58%, transitioning into restrained deep-navy (`#07111F`, `#0D2031`, `#132B3F`) utilitarian surfaces inside the application. *Selected* for superior legibility, emotional impact, and scientific credibility.
3. **Variation C — Split Globe Workbench on `/`:** Immediate 50/50 split between narrative text and WebGL map on the root route. *Rejected* because visitors benefit from a clear 5-second proposition and instant static LCP before hydrating the full geospatial workbench on `/explore`.

---

## 2. Exact Centralized CSS Color Tokens

Defined in `src/styles/globals.css`:

| Token | Hex | Semantic Role |
|---|---|---|
| `--space-void` | `#050A12` | Opening hero & deep space background |
| `--bg-main` | `#07111F` | Primary application workspace background |
| `--bg-nav` | `#081728` | Navigation bar & elevated dark chrome |
| `--surface-1` | `#0D2031` | Primary card and context panel surface |
| `--surface-2` | `#132B3F` | Selected/secondary surface elevation |
| `--surface-hover` | `#17374A` | Interactive row/button hover surface |
| `--border-subtle` | `#29455A` | Standard 1px structural border |
| `--border-highlight` | `#548299` | Highlighted interactive border |
| `--cyan-primary` | `#72E4F1` | Primary action CTA & active focus signal |
| `--cyan-technical` | `#43C9C1` | Secondary technical accent & CTA hover |
| `--green-agri` | `#57D9A7` | Scenario pass criterion & agricultural context (never a field recommendation) |
| `--green-deep` | `#258E83` | Deep agricultural gradient partner |
| `--gold-soft` | `#DCC08A` | Restrained orbital arc / demo watermark / research assumption accent |
| `--gold-shadow` | `#AA875A` | Muted gold shadow partner |
| `--blue-evidence` | `#91B8FF` | Observed & regional model evidence signal |
| `--amber-warning` | `#FFCE7B` | Uncertainty, missing requirements, or dry-state deficit breach |
| `--coral-critical` | `#FF9299` | Blocked eligibility, calendar-invalid exclusion, or validation error |
| `--text-primary` | `#F1F7FD` | Primary reading text (WCAG AAA on `#050A12` and `#07111F`) |
| `--text-secondary` | `#AEC4D3` | Secondary explanatory body text |
| `--text-tertiary` | `#90A8BA` | Captions, axis labels, and metadata |
| `--text-on-cyan` | `#081521` | High-contrast near-black text on `#72E4F1` primary buttons |

---

## 3. Typography & Hierarchy

- **Display / Headlines (`--font-display`):** `Space Grotesk` (weights 500, 600, 700), fluid hero H1 `clamp(34px, 8.5vw, 48px)` on mobile and `clamp(44px, 5.2vw, 82px)` on desktop.
- **Body / UI (`--font-sans`):** `Inter` (weights 400, 500, 600, 700), 14–18px with 1.55 line height and 55–75ch reading measure.
- **Technical IDs, Coordinates & Hashes (`--font-mono`):** `IBM Plex Mono` (weights 400, 500, 600) for schema identifiers (`astragron.global-evidence.v1`), policy IDs (`a27063ce2eca13f02e03`), coordinates (`[17.6389, 59.8586]`), and SHA-256 digests.

---

## 4. Non-Color-Only Status & Evidence Primitives

Implemented in `src/components/design-system/primitives.tsx`:
- `CoverageStatusBadge`: Always renders a distinct vector icon (`CheckCircle2`, `AlertTriangle`, `HelpCircle`, `XOctagon`, `Clock`) + explicit status code (`AVAILABLE`, `CONDITIONAL`, `INSUFFICIENT_EVIDENCE`, `OUT_OF_COVERAGE`, `TEMPORARILY_UNAVAILABLE`) so qualification is never communicated by color alone.
- `EvidenceClassBadge`: Pairs distinct icons with `OBSERVED`, `DERIVED`, `REGIONAL_MODEL_EVIDENCE`, `RESEARCH_ASSUMPTION`, and `MISSING_OR_UNQUALIFIED`.
- `ComplexityModeSwitch`: Persistent toggle between **Simple View** (default) and **Scientific View** (opt-in).

---

## 5. Motion, Print & Responsive Rules

- **Motion:** Subtle 28-second orbital drift (`animate-orbital-drift`) on the hero background, automatically disabled when `prefers-reduced-motion: reduce` is active or when toggled off in `/settings`.
- **Print Stylesheet:** `@media print` rules in `src/styles/globals.css` switch `.print-surface` and `.print-text-dark` to high-contrast black-on-white (`#0F172A` on `#FFFFFF`) and hide navigation chrome (`.no-print`).
