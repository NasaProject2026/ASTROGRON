# ASTRAGRON Domain Contract & Repository Mapping

## 1. Core Domain Contracts (`src/domain/contracts.ts`)
- **`DatasetOperatingMode`:** `'SYNTHETIC_UI_DEMO' | 'RECORDED_M14_RESEARCH' | 'REAL_SCIENTIFIC_BACKEND'`
- **`RepositoryStatusCode`:** `'OK_SYNTHETIC_DEMO' | 'OK_COVERAGE_ONLY' | 'MODEL_UNQUALIFIED' | 'BACKEND_NOT_CONNECTED' | 'SOURCE_NOT_PROVIDED' | 'SITE_NOT_FOUND'`
- **`CoverageStatus`:** `'AVAILABLE' | 'CONDITIONAL' | 'INSUFFICIENT_EVIDENCE' | 'OUT_OF_COVERAGE' | 'TEMPORARILY_UNAVAILABLE'`
- **`EvidenceClass`:** `'OBSERVED' | 'DERIVED' | 'REGIONAL_MODEL_EVIDENCE' | 'RESEARCH_ASSUMPTION' | 'SYNTHETIC_UI_FIXTURE' | 'MISSING_OR_UNQUALIFIED'`
- **`ResearchPreference`:** `'STRICT_ALL_SCENARIOS_SERVICE' | 'MINIMIZE_WORST_ET_SHORTFALL' | 'MINIMAX_REGRET' | 'PARETO_FRONTIER'`

## 2. Runtime Zod Schemas (`src/domain/schemas.ts`)
- **`M14DecisionDatasetSchema`:** Validates portfolio summary arithmetic, 9-state matrix structure, nullable metrics on `EXCLUDED_CALENDAR` rows, and reference selections.
- **`ClimateWaterDatasetSchema`:** Validates historical weather analogue metadata and nullable daily/dekadal series points (`null` preserved for missing observations).
- **`EvidenceRecordSchema`:** Validates site-scoped (`site_id`) provenance records and nullable `source_sha256`.
- **`validateFieldGeoJson()` & `estimatePolygonAreaHectares()`:** Validates `EPSG:4326` coordinate bounds, rejects `EPSG:3857` Web Mercator meter coordinates, detects self-intersecting bowtie edges (`segmentsIntersect`), detects antimeridian (`±180°`) crossings, and computes spherical geodesic area in hectares.
- **`validateFarmSetupDraft()`:** Validates farm coordinates, positive field area, `ELEMENTAL_N_KG_HA` nitrogen basis, and chronological sowing < harvest dates.

## 3. Repository & Adapter Layer (`src/adapters/repositories.ts`)
All 9 `/farm/[id]/*` routes consume `AstragronRepository` via `useAstragron().repository`:
- `getFarmDraft(siteId)`
- `getCoverageReport(siteId)`
- `getDecisionEvaluation(siteId)`
- `getClimateWaterSeries(siteId)`
- `getEvidenceRecords(siteId)`
- `buildSiteBoundExportPayload(siteId, mode)`
- `searchLocationsViaAdapter(query)`
