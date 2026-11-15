# Scientific Truth, Input-Revision Isolation & Scoped Provenance

## 1. Immutable Reference Fixture & Fork-on-Modify (`G1` / `S01–S08`)
V4 eliminates the V3 defect where editing Uppsala's boundary, area, crops, or water constraints could continue displaying Uppsala's pre-baked synthetic 12-policy evaluation or overwrite the shared fixture:

- **Input Revision Identity:** `src/domain/contracts.ts` defines `ScenarioInputIdentity`, `UPPSALA_REFERENCE_INPUT_REVISION`, `computeDraftInputRevision()`, and `detectDraftModificationReasons()`.
- **Fail-Closed Evaluation:** `src/adapters/repositories.ts` compares the active `FarmSetupDraft` revision against `UPPSALA_REFERENCE_INPUT_REVISION`. When any field area, polygon vertex, irrigation setting, crop sequence, water bound, or coordinate changes, every downstream query (`getM14DecisionEvaluation`, `getClimateWaterSeries`, `getSiteCoverageContext`, `buildSiteBoundExportPayload`) returns explicit **`ANALYSIS_NOT_RUN_FOR_INPUT_REVISION`** rather than serving stale Uppsala policy tables or weather series.
- **Immutable Forking in Store & Persistence:** `src/hooks/use-astragron-store.tsx` pins `'uppsala-demo': DEFAULT_UPPSALA_FARM_DRAFT` permanently. Any modification saved against `uppsala-demo`—whether from `/explore` or `/farm/uppsala-demo/analysis`, including sanitized reloads from `localStorage`—forks to a unique draft ID (`custom-uppsala-<rev8>-<timestamp>-<seq>`). Navigating back to `/farm/uppsala-demo/results` always displays the unmodified reference synthetic showcase cleanly.
- **Browser Proof:** Captured in `review/screenshots/16_custom_uppsala_fork_blocked_1440.png` and `review/videos/03_custom_fork_and_outage.webm` (Playwright Test 4), showing declared area change (`24.0 ha -> 44.4 ha`) and edited geometry triggering `ANALYSIS_NOT_RUN_FOR_INPUT_REVISION`.

## 2. Site & Dataset-Mode Scoped Evidence (`G2` / `E01–E06`)
V4 enforces strict provenance containment:

- **Scoped Lookup:** `getEvidenceRecord(scope: EvidenceScope, evidenceId, draft)` in `src/adapters/repositories.ts` requires explicit `{ siteId, datasetMode }` matching and returns `NO_EVIDENCE_FOR_SITE` when an evidence ID belongs to another site (e.g., querying an Uppsala ID inside `nyeri-kenya`), another dataset mode, or an unknown site.
- **Zero Fallback to Uppsala:** Neither `ViewEvidenceButton` (`src/components/design-system/primitives.tsx`) nor `ProvenanceDrawer` (`src/components/evidence/provenance-drawer.tsx`) imports `EVIDENCE_RECORDS_FIXTURE` directly or falls back to Uppsala records. Unknown or modified sites disable the inspect button gracefully rather than opening stale Uppsala metadata.
- **Automatic Reset & Focus Hygiene:** Switching `activeFarmId`, switching `datasetMode`, or navigating routes clears active drawer evidence selection cleanly. Opening and dismissing with `Escape` restores keyboard focus to the exact triggering button (`e2e/astragron-journey.spec.ts` Test 4).

## 3. Mode Truthfulness & M14 Boundary Preservation
- `RECORDED_M14_RESEARCH` -> fail-closed `SOURCE_NOT_PROVIDED`
- `REAL_SCIENTIFIC_BACKEND` -> fail-closed `BACKEND_NOT_CONNECTED`
- Synthetic demo fixtures strictly use `SYNTH-POL-01..SYNTH-POL-12` (`12 policies × 9 states = 108 evaluations`, `99 numeric valid`, `66 passes`, `33 failures`, `9 calendar invalid`). Zero protected M1–M14 source code or policy hashes exist anywhere in runtime modules.
