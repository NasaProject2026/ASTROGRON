# 04 — Global M4 Coverage Separation & Three-Axis Truth Matrix

## 1. Three-Axis Separation (`src/adapters/m4-coverage-adapter.ts`, `/api/research/m4-coverage`)
The frontend strictly enforces separation between:
1. **Axis 1 — Earth Observation & Gridded Climate Availability (`COVERAGE`)** (`SE_UPPSALA`, `KE_NYERI_REGION`, `AU_RIVERINA`, Arctic/Antimeridian test sites, marine edge cases).
2. **Axis 2 — Historical / Local Model Calibration (`CALIBRATION`)** (`SE_UPPSALA` recorded water-service experiment only; non-Sweden = `BLOCKED`).
3. **Axis 3 — Live Agronomic & Field Prescription (`RECOMMENDATION`)** (`BLOCKED` / `field_validated = false` everywhere).

## 2. Verified Multi-Site Behavior
- **Sweden (`uppsala-demo` / `SE_UPPSALA`):** Recorded M14 research results unlocked strictly read-only when `RECORDED_M14_RESEARCH` is selected; field recommendation remains `BLOCKED`.
- **Kenya (`nyeri-kenya` / `KE_NYERI_REGION`):** `/farm/nyeri-kenya/coverage` renders `OK_COVERAGE_ONLY` EO availability alongside `BLOCKED` agronomic calibration/recommendation; `/farm/nyeri-kenya/results` fails closed with `data-status-code="MODEL_UNQUALIFIED"`.
- **Australia / Ocean / Unknown Coordinate:** Unknown coordinates never silently fall back to Sweden or false NASA out-of-coverage (`e2e/v5-acceptance-gates.spec.ts`, `review/screenshots/11_unknown_site_not_found_1440.png`).
- **Sensor Disclosure:** `SMAP`, `HLS`, `IMERG`, and `NASA POWER` explicitly warn that orbital/gridded products do not measure soil chemistry, crop nitrogen, disease, or yield.
