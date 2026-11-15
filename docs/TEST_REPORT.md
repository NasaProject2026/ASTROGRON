# ASTRAGRON Repaired Engineering & Browser Verification Report

## 1. Automated Verification Summary
| Gate | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **TypeScript Strict Typecheck** | `npm run typecheck` (`tsc --noEmit`) | **PASS (Exit 0)** | 0 errors across `src/`, `app/`, `tests/`, `e2e/` |
| **ESLint v9 Flat Config** | `npm run lint` (`eslint src app`) | **PASS (Exit 0)** | Configured via `eslint.config.mjs` (`eslint-config-next/core-web-vitals` + `typescript`) |
| **Vitest Unit & Adversarial Suite** | `npm run test` (`vitest run`) | **PASS (Exit 0)** | **33 / 33 tests passed** across 10 contract, isolation, and geometry suites |
| **Production Build** | `npm run build` (`next build`) | **PASS (Exit 0)** | Clean static + dynamic Next.js 16 production compilation |
| **Playwright E2E & Responsive Matrix** | `npx playwright test` | **PASS (Exit 0)** | Full user journey, cross-site isolation, vertex editor, and 11-width zero-overflow verification |

## 2. Vitest Unit & Adversarial Coverage (`tests/contracts-and-adapters.test.ts` — 33 Tests)
1. **Contract & Zod Schema Validation (Tests 1–4):** Validates `CoverageStatusSchema`, `EvidenceClassSchema` (including `SYNTHETIC_UI_FIXTURE`), `DatasetOperatingModeSchema`, `M14DecisionDatasetSchema`, `ClimateWaterDatasetSchema`, and `EvidenceRecordSchema`.
2. **Truth Separation & Synthetic Mode Invariants (Tests 5–7):** Verifies 100% synthetic policy IDs (`SYNTH-POL-01`..`SYNTH-POL-12`), zero real `M14` policy hashes (`a27063ce2eca13f02e03`, `fa0e548ed3a7ccbcad4e`), `12 × 9 = 108` state evaluations (`99` numeric, `9` calendar-invalid, `66` pass, `33` fail, `0` universal pass), and Uppsala 3-field (`6 + 8 + 10 = 24.0 ha`) `BASE` (`8,000 m³/yr`, `80 m³/day`) configuration.
3. **Operating Mode Fail-Closed Behavior (Tests 8–9):** Verifies `RECORDED_M14_RESEARCH` returns `SOURCE_NOT_PROVIDED` and `REAL_SCIENTIFIC_BACKEND` returns `BACKEND_NOT_CONNECTED`.
4. **Unknown Farm ID Fail-Closed (Test 10):** Verifies `does-not-exist-999` returns `SITE_NOT_FOUND` with `data: null` across all repository methods and never falls back to Uppsala.
5. **Cross-Site Isolation (Tests 11–16):** Verifies `nyeri-kenya` (Kenya) and `wagga-australia` (Australia) return `OK_COVERAGE_ONLY` on coverage, `MODEL_UNQUALIFIED` on decision/climate, strictly site-scoped evidence records (`syn-ev-kenya-*`, `syn-ev-australia-*`), zero state leakage across `Uppsala -> Kenya -> Australia -> Uppsala`, and `BACKEND_NOT_CONNECTED` for `custom-site-draft`.
6. **Preference Sorting & Null-Not-Zero Invariants (Tests 17–22):** Verifies all 4 preference modes (`STRICT_ALL_SCENARIOS_SERVICE`, `MINIMIZE_WORST_ET_SHORTFALL`, `MINIMAX_REGRET`, `PARETO_FRONTIER`), `CALENDAR_OVERLAP:F3:Y3` exclusion with `null` metrics on `SYNTH-POL-12`, and `null` gap preservation on `2006-08-05`.
7. **Geometry, DMS, Wizard, Export & Cartography (Tests 23–33):** Verifies WGS84 polygon validation, self-intersecting bowtie rejection, Web Mercator (`EPSG:3857`) rejection, antimeridian (`±180°`) warning, DMS conversion, `validateFarmSetupDraft` sowing < harvest date checks, site-bound export payloads, 16-site location search adapter, and Natural Earth 1:110m multi-vertex GeoJSON.
