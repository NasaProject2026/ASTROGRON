# 09 — Architecture & Codex Integration Handoff

## 1. Strict Frontend/Backend Separation
This repository contains **only** the Next.js 16 App Router frontend (`app/`, `src/`, `public/`, `tests/`, `e2e/`, `scripts/`). No protected M1–M14 scientific kernel files are modified or bundled.

---

## 2. Typed Contracts, Validation & Adapter Swap Points
| Layer | File(s) | Responsibility |
| --- | --- | --- |
| **Domain Contracts** | `src/domain/contracts.ts` | Canonical `DatasetMode`, `AnalysisStatusCode`, `FarmSetupDraft`, `M14DecisionEvaluation`, `SiteCoverageContext`, `EvidenceRecord`, `EvidenceScope` |
| **Canonical Revision & Zod Guards** | `src/domain/schemas.ts` | `computeDraftInputRevision()`, `UPPSALA_REFERENCE_INPUT_REVISION`, strict Zod payload validation, `isSafeExternalUrl()` |
| **Repository Adapters** | `src/adapters/repositories.ts` | `getM14DecisionEvaluation`, `getClimateWaterSeries`, `getSiteCoverageContext`, `getEvidenceRecordsForSite`, `getEvidenceRecord`, `buildSiteBoundExportPayload` |
| **Synthetic & Geo Fixtures** | `src/fixtures/m14-decision-fixture.ts`, `src/fixtures/climate-water-fixture.ts`, `src/fixtures/sites-and-coverage.ts`, `src/fixtures/natural-earth-world.ts` | Deterministic Uppsala 3-field synthetic UI demo + non-Uppsala site readiness metadata + CC0 world fallback |
| **State & Persistence** | `src/hooks/use-astragron-store.tsx` | Active farm draft persistence (`localStorage`), complexity mode (`SIMPLE` / `SCIENTIFIC`), units, reduced-motion, dataset-mode selection |
| **Map & 3D Modules** | `src/components/maps/*`, `src/components/orbital/orbit-ab-stage.tsx` | MapLibre 3D globe + EOX/GIBS/OpenFreeMap failover + Natural Earth fallback + isolated Three.js `/orbit-ab` stage |
| **Telemetry** | `src/components/telemetry/web-vitals-reporter.tsx` | Official `web-vitals@6.2.3` RUM hook wired into root layout |

---

## 3. Integrating the Protected Scientific Engine (`REAL_SCIENTIFIC_BACKEND`)
To wire live scientific computation in Codex / backend integration without weakening V5 safety checks:
1. Replace fail-closed stub branches in `src/adapters/repositories.ts` for `datasetMode === 'REAL_SCIENTIFIC_BACKEND'` with authenticated HTTP/RPC client calls.
2. Validate every backend response through the schemas in `src/domain/schemas.ts` before updating UI state.
3. **Mandatory Backend Echo Checks:**
   - Response `inputRevision` MUST match `computeDraftInputRevision(submittedDraft)` or UI will hold at `ANALYSIS_NOT_RUN_FOR_INPUT_REVISION`.
   - Provenance lookup MUST enforce `EvidenceScope = { siteId, datasetMode }` or return `NO_EVIDENCE_FOR_SITE`.
   - `SOURCE_DATA_COVERAGE`, `AGRONOMIC_MODEL_QUALIFICATION`, and `FIELD_RECOMMENDATION_ELIGIBILITY` must remain independent axes.
   - `RECORDED_M14_RESEARCH` must only unlock once immutable provenance digests (SHA-256) and raw M14 artifacts are mounted.

---

## 4. Environment & Secrets Posture (`.env.example`)
- Default standalone runtime requires **zero keys**.
- `NEXT_PUBLIC_MAPLIBRE_STYLE_URL`, `NEXT_PUBLIC_SATELLITE_TILE_URL`, `NEXT_PUBLIC_GEOCODER_ENDPOINT`, and `NEXT_PUBLIC_ASTRAGRON_ADAPTER_MODE` (`SYNTHETIC_UI_DEMO` default) are optional public overrides; `NEXT_PUBLIC_MAP_PROVIDER_KEY` is reserved/unused in V5.
- Security scan confirms zero secrets, private keys, or hardcoded user machine paths inside `app/`, `src/`, `e2e/`, `tests/`, or `scripts/`.
