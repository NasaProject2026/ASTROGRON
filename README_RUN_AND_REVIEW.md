# ASTRAGRON Frontend V5 — Run & Independent Review Guide

> **Scope Disclaimer:** Standalone Next.js frontend demonstration (`SYNTHETIC_UI_DEMO` default mode). No protected M1–M14 scientific engine is included or executed here (`BACKEND_NOT_CONNECTED`). Do not deploy `SYNTHETIC_UI_DEMO` outputs for operational agricultural advice.

---

## 1. Prerequisites
- **Node.js:** `22.x` LTS (verified with `v22.14.0`) and `npm` `10.x+`
- **Browsers for Playwright E2E:** Chromium / Microsoft Edge (`desktop-chrome`) and WebKit (`webkit-desktop`). Install Playwright browsers if absent:
  ```bash
  npx playwright install chromium webkit
  ```
- **API Keys / Secrets:** None required. All default routes, synthetic fixtures, 3D orbital assets, and Natural Earth `CC0` fallback vector layers run locally. Optional provider overrides are documented in `.env.example`.

---

## 2. Clean Install, Build & Verification Commands
Run all commands from the project root using relative paths:

```bash
# 1. Clean dependency installation from committed lockfile
npm ci

# 2. TypeScript typecheck & ESLint verification
npm run typecheck
npm run lint

# 3. Unit & scientific integrity tests (Vitest: 4 files, 52 tests)
npm test

# 4. Offline mobile/UX source invariant gates (9 checks)
node scripts/mobile-ux-offline-gates.mjs

# 5. Production build & local production server (required for real perf/E2E accuracy)
npm run build
npm run start -- --port 3005
```

In a separate terminal (or letting Playwright auto-start `next start --port 3005` per `playwright.config.ts`):

```bash
# 6. Full multi-engine Playwright E2E + Axe WCAG AA + Perf benchmark suite
npx playwright test

# 7. Repository integrity & SHA-256 manifest verification
node scripts/verify-manifest.mjs
node scripts/review-regression.mjs
```

---

## 3. Key Review Entry Routes (`next start`)
- `/` — Editorial Orbital Hero (chosen production landing page) & 5-step orientation
- `/orbit-ab` — Isolated Three.js WebGL Earth + Landsat 8 `GLB` A/B candidate & telemetry toggle
- `/explore` — Interactive 3D MapLibre Globe + EO imagery (`EOxCloudless 2016`, `NASA GIBS`, `OpenFreeMap`) + polygon/DMS/GeoJSON/geolocation tools + CC0 offline fallback
- `/farm/new` (or `/farm/new?from=uppsala-demo`) — 5-step farm draft setup wizard with canonical `inputRevision` invalidation
- `/farm/uppsala-demo/coverage` — M4 evidence readiness matrix (`SOURCE_DATA_COVERAGE` vs `AGRONOMIC_MODEL_QUALIFICATION` vs `FIELD_RECOMMENDATION_ELIGIBILITY`)
- `/farm/uppsala-demo/results` — M14 decision overview (`0 of 12` no-universal-policy abstention + `Simple View` progressive disclosure)
- `/farm/uppsala-demo/plans` — 5-year × 3-field crop plan matrix (`SYNTH-POL-01`–`06`, `Compare Two Policies`, mobile parity)
- `/farm/uppsala-demo/climate` & `/farm/uppsala-demo/reports` — 2006/2012/2018 climate water-deficit charts & site-bound CSV/JSON/Print export
- `/farm/nyeri-kenya/coverage` & `/farm/nyeri-kenya/results` — Non-Uppsala site isolation & fail-closed blocked recommendation proof
- `/methodology`, `/help`, `/settings` — Scientific boundaries, glossary, dataset-mode status, units & motion settings

---

## 4. Known Runtime Conditions
1. **Default Mode is `SYNTHETIC_UI_DEMO`:** Non-Uppsala farms, custom geometry/parameter forks (`ANALYSIS_NOT_RUN_FOR_INPUT_REVISION`), `RECORDED_M14_RESEARCH` (`SOURCE_NOT_PROVIDED`), and `REAL_SCIENTIFIC_BACKEND` (`BACKEND_NOT_CONNECTED`) fail closed without synthesizing model outputs.
2. **External Map Tile Availability:** Online EOX/OpenFreeMap/GIBS tiles require internet access and have no commercial uptime SLA; simulated or real network outages fail over automatically to local Natural Earth `CC0` vector layers (`public/geodata/`).
3. **Engine Coverage:** Chromium (`desktop-chrome`) and WebKit (`webkit-desktop`) E2E suites pass in this release; Firefox and physical hardware phones/tablets are `NOT_TESTED`. The 4x CPU throttle CDP benchmark is Chromium-only (`NOT_APPLICABLE_NO_CDP` on WebKit).

---

## 5. Verdict & Review Documentation Index
- **Final Stop Decision:** `FRONTEND_READY_FOR_CODEX_INTEGRATION_REVIEW` (frontend integration ready; not a live backend or operational advisory release).
- Arabic executive summary: `review/FINAL_V5_IMPLEMENTATION_STATUS_AR.md`
- Complete V5 audit suite: `review/01_REQUIREMENT_TO_EVIDENCE_MATRIX.csv` through `review/11_DELIVERY_MANIFEST.json`
