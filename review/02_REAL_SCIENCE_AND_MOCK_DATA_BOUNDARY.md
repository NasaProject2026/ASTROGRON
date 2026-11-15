# 02 — Real Science, Synthetic Demo & Fail-Closed Data Boundaries

## 1. Strict Three-Mode Separation (`DatasetMode`)
The frontend enforces strict separation across `DatasetMode = 'SYNTHETIC_UI_DEMO' | 'RECORDED_M14_RESEARCH' | 'REAL_SCIENTIFIC_BACKEND'` defined in `src/domain/contracts.ts` and validated by Zod schemas in `src/domain/schemas.ts`:

| Mode | Active Status in V5 | Repository Behavior (`src/adapters/repositories.ts`) | Verified Evidence |
| --- | --- | --- | --- |
| `SYNTHETIC_UI_DEMO` | **ACTIVE (Default)** | Serves deterministic 3-field (`24.0 ha`) Uppsala synthetic fixture **only when** `farmId === 'uppsala-demo'` AND canonical `inputRevision === UPPSALA_REFERENCE_INPUT_REVISION`. | `tests/p1-scientific-integrity.test.ts`; `review/screenshots/05_uppsala_results_1440.png` |
| `RECORDED_M14_RESEARCH` | **LOCKED / FAIL-CLOSED** | Returns `statusCode: 'SOURCE_NOT_PROVIDED'`, `recommendationEligible: false`, empty evaluations, and explicit provenance blocker. | `tests/p1-scientific-integrity.test.ts`; header & data-mode pills |
| `REAL_SCIENTIFIC_BACKEND` | **LOCKED / FAIL-CLOSED** | Returns `statusCode: 'BACKEND_NOT_CONNECTED'`, `recommendationEligible: false`, zero synthetic numbers leaked. | `tests/p1-scientific-integrity.test.ts`; `review/09_ARCHITECTURE_AND_CODEX_INTEGRATION_HANDOFF.md` |

---

## 2. Canonical `inputRevision` Invalidation Across All Routes (`G01`)
Editing the Uppsala reference scenario must invalidate all cached M14 results rather than silently showing reference metrics for modified inputs:
- **Deterministic Revision Hash (`computeDraftInputRevision`):** Computes an FNV-1a-derived canonical fingerprint (`rev-<hex8>`) over farm name, site ID, coordinates (`6` decimal places), sorted field areas, irrigation flags, soil parameters, planned crop sequences, sowing date windows, water constraints, and polygon geometry.
- **Persistence Fix Across Route Transitions (`P1`):**
  - Opening `/farm/new?from=uppsala-demo` forks the draft with a new site ID while preserving `clonedFromUppsala` metadata; even returning/reloading retains modified draft inputs via `localStorage` (`useAstragronStore`), and non-reference revisions force `ANALYSIS_NOT_RUN_FOR_INPUT_REVISION`.
  - Checked explicitly on `/farm/[id]/results`, `/farm/[id]/plans`, `/farm/[id]/climate`, and `/farm/[id]/reports` — all render explicit blocked messaging rather than showing `SYNTH-POL-01` or `38,420.50 m³ eq` for mutated inputs.
- **Verified E2E (`e2e/v5-acceptance-gates.spec.ts`):** Mutated Step 3 sowing dates (`+7 days` offset), clicked Finish/Results, confirmed `ANALYSIS_NOT_RUN_FOR_INPUT_REVISION`, navigated `page.goBack()`, executed `page.reload()`, and re-verified invalidation remained intact across both Chromium and WebKit.

---

## 3. Site & Evidence Isolation — Negative Tests (`G02`)
- `getEvidenceRecordsForSite(siteId, datasetMode, draft)` and `getEvidenceRecord(scope, evidenceId, draft)` require matching `{ siteId, datasetMode }`.
- Requesting `/farm/nyeri-kenya/results` or `/farm/wagga-australia/results` returns `OK_COVERAGE_ONLY` with `recommendationEligible: false` and `statusCode: 'NO_EVIDENCE_FOR_SITE'` if Uppsala evidence IDs are requested for Kenya (`review/screenshots/10_kenya_isolation_blocked_1440.png`).
- Unknown farm IDs (`/farm/unknown-site-999/results`) return `SITE_NOT_FOUND` (`review/screenshots/11_unknown_site_not_found_1440.png`).

---

## 4. Separation of NASA / EO Coverage (M4) from Agronomic Model Qualification (`G03`)
`app/farm/[id]/coverage/page.tsx` renders three independent axes (`M4 Global Evidence Contract · astragron.global-evidence.v1`):
1. `SOURCE_DATA_COVERAGE` — Satellite/gridded availability (e.g. NASA POWER `~50 km`, GPM IMERG `0.1°`, SMAP L4 `9 km`, HLS `30 m`). For oceanic coordinates (`lon = -30, lat = 0`), land-mask classification returns `OUT_OF_COVERAGE` for terrestrial soil/crop layers rather than claiming satellite coverage.
2. `AGRONOMIC_MODEL_QUALIFICATION` — Strictly `SYNTHETIC_UI_DEMO_ONLY` for immutable Uppsala, or `MODEL_UNQUALIFIED` for all other sites and custom forks.
3. `FIELD_RECOMMENDATION_ELIGIBILITY` — Strictly `BLOCKED` across all showcase modes; even in Uppsala synthetic demo, `0 of 12` policies qualify universally under the 2018 dry analogue.

---

## 5. Honest Report & CSV Export Metadata (`G04`)
Verified by Vitest + `e2e/v5-acceptance-gates.spec.ts`: exported CSV & JSON metadata bundles from `/farm/uppsala-demo/reports` and modified custom drafts explicitly include:
- `dataset_mode` (`SYNTHETIC_UI_DEMO`)
- `input_revision` (`rev-...`)
- `reference_revision` (`UPPSALA_REFERENCE_INPUT_REVISION`)
- `inputs_modified` (`false` for immutable Uppsala, `true` for any edited fork)
- Explicit `NOT_FOR_FIELD_ADVISORY` governance disclaimer.
