# Backend Integration Handoff Contract (`G9` — Strictly Frontend Boundary)

This document defines the exact typed TypeScript interfaces, dataset-mode flags, and adapter boundaries exposed in `ASTRAGRON-FRONTEND` so an authorized backend integration engineer can later wire a protected scientific engine (`REAL_SCIENTIFIC_BACKEND`) or static corpus (`RECORDED_M14_RESEARCH`) without disturbing frontend safety guarantees.

> **Status in V4 Package:** Live scientific engine intentionally **unconnected** (`BACKEND_NOT_CONNECTED`) and M14 raw corpus intentionally **absent** (`SOURCE_NOT_PROVIDED`). Do not deploy `SYNTHETIC_UI_DEMO` outputs as operational advice.

## 1. Core Contracts (`src/domain/contracts.ts` & `src/domain/schemas.ts`)
- **`DatasetMode`:** `'SYNTHETIC_UI_DEMO' | 'RECORDED_M14_RESEARCH' | 'REAL_SCIENTIFIC_BACKEND'`
- **`AnalysisStatusCode`:**
  - `'OK_UPPSALA_SYNTHETIC'`
  - `'OK_COVERAGE_ONLY'`
  - `'SOURCE_NOT_PROVIDED'`
  - `'BACKEND_NOT_CONNECTED'`
  - `'MODEL_UNQUALIFIED'`
  - `'SITE_NOT_FOUND'`
  - `'ANALYSIS_NOT_RUN_FOR_INPUT_REVISION'`
  - `'NO_EVIDENCE_FOR_SITE'`
- **`ScenarioInputIdentity` & Revision Guards:**
  - Every `FarmSetupDraft` produces a canonical deterministic revision via `computeDraftInputRevision(draft)`.
  - `UPPSALA_REFERENCE_INPUT_REVISION` identifies the immutable baseline `uppsala-demo` specification.
  - Downstream evaluation payloads in a real backend response MUST bind `inputRevision` back to the submitted geometry, field areas, irrigation settings, crops, and water constraints so mismatched revisions continue failing closed.
- **`EvidenceScope`:**
  - `{ siteId: string; datasetMode: DatasetMode }` — any backend provenance API MUST enforce strict `siteId` + `datasetMode` scoping and return `NO_EVIDENCE_FOR_SITE` rather than falling back to default reference records.
- **Separated Three-Axis Readiness Contract:**
  - `SOURCE_DATA_COVERAGE` (M4 source availability & missingness diagnostics)
  - `AGRONOMIC_MODEL_QUALIFICATION` (site & crop calibration status)
  - `FIELD_RECOMMENDATION_ELIGIBILITY` (must stay blocked unless backend returns authorized qualified policy evaluation for the exact submitted `inputRevision`)

## 2. Adapter Replacement Point (`src/adapters/repositories.ts`)
All routes and UI hooks query repository adapter functions cleanly:
- `getM14DecisionEvaluation(farmId, mode, draft)`
- `getClimateWaterSeries(farmId, mode, draft)`
- `getSiteCoverageContext(farmId, mode, draft)`
- `getEvidenceRecordsForSite(siteId, mode, draft)`
- `getEvidenceRecord(scope, evidenceId, draft)`
- `buildSiteBoundExportPayload(farmId, mode, draft)`

All backend JSON payloads MUST be validated against Zod schemas in `src/domain/schemas.ts` before entering UI state, preserving non-empty provenance headers, SHA-256 artifact digests (when non-synthetic), and `isSafeExternalUrl()` validation.
