# ASTROGRON — Orbital Intelligence for Agricultural Research & Decision Support

**Standalone Frontend Application (`ASTROGRON-FRONTEND`)**  
**Edition:** 2026-11-12 · **UI Locale:** English (`en`) · **Contracts:** `astrogron.global-evidence.v1` (M4) & `astrogron.m14.response.v1` (M14)

---

> **Independent follow-up review (13 November 2026):** See
> [`review/13_INDEPENDENT_V4_AUDIT_AND_ORBIT_DESIGN_AR.md`](review/13_INDEPENDENT_V4_AUDIT_AND_ORBIT_DESIGN_AR.md).
> The original V4 Chromium/Vitest evidence remains historical. The experimental independently moving
> 2D Canvas prototype is available at `/orbit-lab.html` for direct comparison only. The public landing
> page intentionally retains the original cinematic image until a photorealistic 3D alternative passes
> mobile/desktop visual quality and performance gates. This illustration is not NASA telemetry.


**Mobile-first UX refinement (13 November 2026):** See
[`review/14_MOBILE_FIRST_UX_AND_3D_DECISION_AR.md`](review/14_MOBILE_FIRST_UX_AND_3D_DECISION_AR.md).
Tablet navigation remains available through the `lg` breakpoint, research navigation uses progressive disclosure,
mobile Earth Explorer sites use a single selection control, and the map settings are opened only when needed.
Use `node scripts/mobile-ux-offline-gates.mjs` for additional static source checks; these are **not** a replacement for `npm run test:e2e`.

## 1. Overview & Scientific Integrity Boundaries

`ASTROGRON-FRONTEND` is a standalone, backend-ready Next.js 16 + React 19 + TypeScript application pairing interactive orbital 3D Earth mapping with transparent multi-scenario agricultural research exploration.

### Key Architectural & Scientific Guarantees
- **Strict Separation from Protected Backend:** Built as an isolated standalone frontend workspace (`ASTROGRON-FRONTEND`). Contains zero Python optimization solver code, zero browser-side crop physiology calculation, and zero concealed backend secrets or M1–M14 identifiers.
- **Explicit Research-Conditional & Demo Provenance:** Every screen, data mode switcher, table, chart, and exported JSON/CSV displays explicit `SYNTHETIC INTERFACE DEMONSTRATION — NOT RECORDED SCIENTIFIC RESULTS` and `FIELD_RECOMMENDATION_ELIGIBILITY: BLOCKED` disclosures.
- **Three Strictly Isolated Operating Modes:**
  1. `SYNTHETIC_UI_DEMO` (active default): Evaluates a self-contained **12 synthetic policies (`SYNTH-POL-01`..`SYNTH-POL-12`) × 9 scenario states = 108 state evaluations** (11 comparable policies + 1 calendar-invalid exclusion = 99 numeric-valid evaluations; 66 passes in wet/median analogues, 33 failures in dry analogues; `0 of 12` pass all 9 states because rainfed Fields `F1` [6.0 ha] and `F2` [8.0 ha] breach the assumed 100.0 mm deficit ceiling with `F1` reaching 142.50 mm). `FIELD_RECOMMENDATION_ELIGIBILITY` is strictly `BLOCKED`.
  2. `RECORDED_M14_RESEARCH`: Fails closed with `SOURCE_NOT_PROVIDED` unless an authorized frozen raw M14 corpus is explicitly supplied.
  3. `REAL_SCIENTIFIC_BACKEND`: Fails closed with `BACKEND_NOT_CONNECTED` while the live protected scientific backend is offline.
- **Strict Cross-Site Isolation:** Reference fixtures for Nyeri (Kenya) and Wagga Wagga (Australia) inspect M4 source coverage metadata only (`OK_COVERAGE_ONLY`) and strictly fail closed (`MODEL_UNQUALIFIED`) on decision, five-year plan, and daily climate routes. Custom user drafts never inherit Uppsala coordinates (`[17.64, 59.86]`) or Uppsala crop matrices.
- **No NASA Endorsement Implied:** Uses original illustrative orbital artwork for the hero banner (explicitly labeled as conceptual visual framing) and credits NASA GIBS / NASA POWER / GPM IMERG / SMAP L4 / HLS cleanly without using NASA insignia or implying endorsement.

---

## 2. Runtime & Technical Requirements

- **Node.js:** `>= 20.9.0` (verified on **Node.js v22.14.0 LTS**)
- **Package Manager:** `npm >= 10.x`
- **Framework Stack:**
  - Next.js 16 (App Router) + React 19 + TypeScript 5.7 (`strict: true`)
  - Tailwind CSS 4 (`@tailwindcss/postcss`)
  - MapLibre GL JS v6 (`6.18.0`) 3D WebGL Globe + `@turf/turf` (`7.4.0`) geodesic area/validation
  - OpenFreeMap (`openmaptiles` vector schema) + EOX Sentinel-2 Cloudless 2016 historical mosaic (`CC BY 4.0`, tiles z0–z14; confirmed in both EOX FAQ & WMTSCapabilities, no uptime SLA) + NASA GIBS Blue Marble Next Generation (`z0–z8`) + bundled Natural Earth `1:110m` Countries GeoJSON (`177` sovereign boundaries, Public Domain `CC0`)
  - Apache ECharts 5 (`echarts`) + accessible HTML companion data tables
  - Zod (`zod`) for coordinate, GeoJSON topology, and M4/M14 contract schema validation
  - Vitest (`vitest`) + Playwright (`@playwright/test`)

---

## 3. Setup, Development, Build & Test Commands

```bash
# 1. Install dependencies from lockfile
npm ci

# 2. Start local development server on http://localhost:3000
npm run dev

# 3. Run strict TypeScript typecheck
npm run typecheck

# 4. Run ESLint
npm run lint

# 5. Run Vitest unit, contract, and adversarial suite
npm run test

# 6. Build production application
npm run build

# 7. Start production server on http://localhost:3000
npm run start

# 8. Run Playwright real-browser verification (3D WebGL globe, 2D failure fallback, responsive matrix)
npm run test:e2e
```

---

## 4. Environment Configuration & No-Key Resilient Fallback

Copy `.env.example` to `.env.local` only if wiring server-side geocoding, FTW field boundary suggestions, capability footprint feeds, live agronomic analysis, or the report-grounded assistant (`ASTROGRON_GEOCODER_*`, `ASTROGRON_FTW_*`, `ASTROGRON_BACKEND_URL`, `ASTROGRON_CAPABILITY_*`, `ASTROGRON_CHAT_ENDPOINT`). All `NEXT_PUBLIC_` variables are bundled client-side and MUST NOT hold private credentials:

- **Default Zero-Key Earth Explorer:** When custom keys are unset, `/explore` launches a genuine interactive **MapLibre GL JS v6 3D WebGL globe** (`projection: 'globe'`) pairing **OpenFreeMap** global borders/roads/place names (`© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors`), **EOxCloudless Sentinel-2 2016 historical mosaic** (`CC BY 4.0`, historical cloudless satellite composite down to z14), and **NASA GIBS Blue Marble** (`z0–z8`).
- **Honest Resilience & Fallbacks:** If external tile hosts are blocked/offline (`IMAGERY_PROVIDER_BLOCKED`), the globe switches cleanly to the bundled **Natural Earth 1:110m (`177` countries, CC0)** vector globe with explicit attribution. If WebGL initialization genuinely fails (`?mapFallback=1` or headless software GPU absence), the UI switches explicitly to the 2D Natural Earth SVG Fallback (`FALLBACK_ONLY`).
- **No Unlicensed Scraping & Honest Capability Boundaries:** Public OpenStreetMap Nominatim autocomplete is explicitly blocked by `src/server/ssrf-guard.ts`. When `ASTROGRON_GEOCODER_ENDPOINT` or `ASTROGRON_FTW_SUGGEST_ENDPOINT` are unset, search uses the built-in 16-site reference gazetteer plus instant decimal/DMS coordinate jump and browser GPS, while remote FTW outline suggestion fails closed (`UNAVAILABLE`) without fabricating AI boundaries.

---

## 5. Route Architecture

| Path | Screen | Purpose |
|---|---|---|
| `/` | Cinematic Landing | Full-bleed Low Earth Orbit hero, editorial Earth-to-evidence narrative, coverage & 5-year matrix previews |
| `/explore` | Earth Explorer | Real 3D MapLibre globe, satellite/vector/thematic layers, worldwide search proxy + offline gazetteer, optional Analysis Availability overlay, decimal/DMS entry, vertex editor, GeoJSON validation |
| `/farms` | My Farms Portfolio | Saved local-device farms with polygon outlines, checksum JSON backup export/import, and archive lifecycle |
| `/farm/new` | Farm Setup Wizard | 3-stage farmer-first setup (Location -> Smart Field Boundary via manual draw, FTW suggestion when configured, GPS walk, or GeoJSON/KML/GPX import -> Review & Save) |
| `/farm/[id]` | Farm Overview | Parcel inventory, area provenance (`GEOMETRY_DERIVED_ESTIMATE` vs `USER_DECLARED_NOT_SURVEYED`), KPIs |
| `/farm/[id]/coverage` | Evidence Readiness | M4 per-source & per-capability status matrix (`AVAILABLE`, `CONDITIONAL`, `INSUFFICIENT_EVIDENCE`, `OUT_OF_COVERAGE`) |
| `/farm/[id]/analysis` | Analysis Setup | M14 4-preference selector and fail-closed backend gate |
| `/farm/[id]/results` | Decision Overview | Abstention banner, 12×9=108 feasibility audit, least-worst shortfall vs minimax regret vs Pareto trade-offs |
| `/farm/[id]/plans` | Five-Year Plan | Interactive Field × Year (H1–H5) crop matrix, comparison view, mobile year switcher |
| `/farm/[id]/climate` | Climate & Water | ECharts plots + accessible companion HTML tables for 2018 dry, 2006 median (null gap preserved), and 2012 wet analogues |
| `/farm/[id]/decisions` | Decision Explorer | Pareto frontier (`NO_UNIQUE_WINNER`), full 12-policy synthetic ranking, and 9-state witness audit |
| `/farm/[id]/evidence` | Provenance Center | Site-bound M4/M14 `EvidenceRecord` catalog with provenance disclosures and extraction metadata |
| `/farm/[id]/reports` | Reports & Exports | Watermarked JSON/CSV export and neutral-light printable report |
| `/methodology` | How It Works | Plain-language overview + M4/M14 technical notes |
| `/help` | Help & FAQ | Glossary of agronomic/decision terms, qualification rules, and privacy policy |
| `/settings` | Settings | Simple/Scientific view default, metric/acre units, reduced motion override, local storage reset |
| `/design-system` | Design System | Live orbital design tokens, badges, and accessibility specification |

---

## Open-Source License (NASA Space Apps Challenge)

This project is Open Source under the **MIT License** for the **NASA Space Apps Challenge**.
See [`LICENSE`](./LICENSE) for the full license text (`Copyright (c) 2026 ASTROGRON Team - NASA Space Apps Challenge`).

