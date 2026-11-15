# Three-Axis Separation: Source Coverage, Model Qualification & Field Advice (`G3` / `C01–C05`)

## 1. Separated Readiness Architecture
Prior V3 UI allowed source availability pills (`AVAILABLE`) to visually suggest operational farming readiness for a site. V4 separates readiness into three independent axes rendered consistently across `/explore` (`src/components/maps/earth-explorer-client.tsx`) and `/farm/[id]/coverage` (`app/farm/[id]/coverage/page.tsx`):

1. **`SOURCE_DATA_COVERAGE`** — Whether Earth observation / weather time-series inputs exist for inspecting source availability (distinct M4 codes).
2. **`AGRONOMIC_MODEL_QUALIFICATION`** — Whether the agronomic simulation engine is calibrated and verified for that site and exact input revision (`Demo Preview (Uppsala)` vs `Unqualified` vs `Re-run Needed`).
3. **`FIELD_RECOMMENDATION_ELIGIBILITY`** — Operational advisory eligibility, which stays strictly **`Blocked (Showcase Only)`** or **`Blocked (Unqualified)`** unless a live verified scientific backend (`REAL_SCIENTIFIC_BACKEND`) supplies authorized field evidence.

## 2. Site-by-Site Matrix Verified in Unit & Browser Checks
- **`uppsala-demo` (`SYNTHETIC_UI_DEMO`, unchanged revision):**
  - Source Coverage: `Synthetic Demo Series`
  - Model Qualification: `Demo Preview (Uppsala)` (`CONDITIONAL` header badge — never green `AVAILABLE`)
  - Field Advice: `Blocked (Showcase Only)` (`0 of 12` tested policies pass every state)
- **`custom-uppsala-*` (modified revision):**
  - Model Qualification & downstream results/plans/climate/exports blocked under `ANALYSIS_NOT_RUN_FOR_INPUT_REVISION` with exact modification deltas surfaced.
- **`nyeri-kenya` & `wagga-australia`:**
  - Coverage route exposes M4 five-state descriptor badges (`OK_COVERAGE_ONLY`, etc., clearly paired with icons and non-color labels), while Decision / Climate / Plans / Reports fail closed with `MODEL_UNQUALIFIED` (`10_kenya_isolation_blocked_1440.png`).
- **Arbitrary / Unknown Coordinates:**
  - `getSiteCoverageContext` never fabricates full NASA availability by guesswork and fails closed for unknown IDs (`11_unknown_site_not_found_1440.png`).

## 3. Resolution, Date & Unit Precision (`C05`)
- Satellite mosaic metadata explicitly labels **`Historical Satellite Mosaic · EOX S2Cloudless 2016 (CC BY 4.0) + NASA GIBS`**, stating 2016 Sentinel-2 mosaic vintage rather than "Live Satellite" or 2017 imagery.
- Area cards distinguish **`Preview Box Area: 34.2 ha`** from **`Model parcels F1–F3 = 24.0 ha`** (`02b_explore_satellite_uppsala_1440.png`) unless the user explicitly redraws or edits the parcel geometry.
