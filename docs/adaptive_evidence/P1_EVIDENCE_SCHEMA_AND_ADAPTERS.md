# Stage P1 — Typed Evidence Schema, Source Arbitration, and Working Source Adapters

## 1. Typed Evidence Object (`TypedEvidenceObject`)

Implemented in [`adaptive_evidence/schema.py`](../../adaptive_evidence/schema.py), every retrieved, derived, scenario-assumed, or blocked parameter is wrapped in an immutable `TypedEvidenceObject` containing:

| Field Group | Fields | Scientific Role |
|---|---|---|
| **Identity & Provenance** | `parameter_path`, `provenance_class`, `source_id`, `provider`, `product`, `variable`, `version`, `permanent_url`, `citation`, `access_path` | Distinguishes `OBSERVED_OR_AUTHENTIC_SOURCE` from `DERIVED_WITH_VALIDATED_METHOD`, `USER_SCENARIO_ASSUMPTION`, `NOT_RETRIEVABLE`, and `OFFICIAL_VERIFICATION_REQUIRED`. |
| **Temporal & Spatial Support** | `retrieved_at`, `valid_period`, `evidence_type`, `point_lon_lat`, `geometry`, `crs`, `spatial_resolution_desc`, `pixel_area_km2`, `depth_interval_cm` | Prevents silent mixing of 55 km climate reanalysis (`3080 km²`), 250 m regional soil predictions (`0.0625 km²`), and on-farm lab samples. |
| **Units & Scaling** | `raw_unit`, `scale_factor`, `raw_value`, `converted_si_value`, `si_unit` | Enforces explicit unit conversion (e.g. SoilGrids `g/kg -> %` via `0.1`, `cg/cm3 -> kg/dm3` via `0.01`, `pH*10 -> pH` via `0.1`). |
| **Uncertainty & Quality** | `quantiles` (`q05`, `q50`, `mean`, `q95`), `uncertainty_semantics`, `quality_flags`, `missing_value_handling`, `missing_reason` | Preserves predictive quantiles and inter-annual envelopes rather than collapsing to a single deterministic mean. |
| **Integrity & Licensing** | `raw_source_sha256`, `receipt_sha256`, `fixture_origin`, `transformation_id`, `estimator_id`, `license`, `attribution`, `restrictions`, `evidence_id` | Cryptographically binds every evidence object to its raw payload and separates authentic receipts from offline reference or synthetic control fixtures. |

---

## 2. Coordinate, Depth, Time, and Arbitration Guards

1. **`validate_coordinates_and_crs(point_lon_lat, crs, geometry)`**:
   - Admits only explicit `EPSG:4326` with finite `[-180, 180] x [-90, 90]` coordinates.
   - Verifies GeoJSON `Point` consistency (`missing_reason="spatial_mismatch"` on mismatch).
   - Screens out open-ocean (`missing_reason="ocean_or_non_land_cell"`) and Antarctic polar (`missing_reason="unsupported_region"`) coordinates.
2. **`validate_depth_intervals(intervals_cm)`**:
   - Enforces `0 <= top_cm < bottom_cm <= 500` and strict non-overlapping monotonicity (`missing_reason="depth_inconsistency"` on inversion or overlap).
3. **`validate_period_and_leap_years(start_iso, end_iso, as_of_iso)`**:
   - Validates ISO dates, chronological ordering (`missing_reason="temporal_mismatch"`), historical cutoff compliance (`missing_reason="stale_or_post_cutoff_snapshot"`), and enumerates all leap days (`YYYY0229`) inside the interval.
4. **`arbitrate_parameter_sources(parameter_path, candidates, ...)`**:
   - Selects the highest-priority valid source (`OBSERVED_OR_AUTHENTIC_SOURCE` > `DERIVED_WITH_VALIDATED_METHOD` > `USER_SCENARIO_ASSUMPTION`, breaking ties by `fixture_origin` and finer spatial resolution `pixel_area_km2`) and records every rejected or superseded candidate in `rejected_substitutes`.

---

## 3. Working Source Adapters

### 3.1 NASA POWER Climate Adapter (`NASAPowerAdapter`)
- **Implementation**: [`adaptive_evidence/adapters/nasa_power.py`](../../adaptive_evidence/adapters/nasa_power.py)
- **Authentic Receipt Reuse**: Directly inspects and verifies SHA-256 hashes of the pre-cached authentic NASA POWER snapshots in `water_core/data/POWER_2006_2025.json` (`SE_UPPSALA`) and `water_core/source_cache/` (`AU_WAGGA_REGION`, `KE_NYERI_REGION`, `DE_BERLIN`), and delegates live fetches to upstream `water_core/power_source.py` when `acquisition="FETCH_ALLOWED"`.
- **Quality & Physics Checks**:
  - Rejects `-999` sentinel values without imputation (`missing_reason="quality_fail"`).
  - Verifies daily `T2M_MIN <= T2M <= T2M_MAX` and leap-day completeness (`20120229`, `20160229`, `20200229`, `20240229`).
  - Computes conditional Hargreaves-Samani (`ET0`) and inter-annual precipitation quantiles (`driest_year`, `median`, `wettest_year`) while labeling output as regional historical reanalysis (`future_forecast=False`, `field_station_measurement=False`).

### 3.2 ISRIC SoilGrids v2.0 250 m WCS Adapter (`SoilGridsWCSAdapter`)
- **Implementation**: [`adaptive_evidence/adapters/soilgrids.py`](../../adaptive_evidence/adapters/soilgrids.py)
- **Live OGC WCS 2.0.1 + Pure-Python GeoTIFF Decoder**: Queries `https://maps.isric.org/mapserv?map=/map/<prop>.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage` across all 7 properties (`clay`, `silt`, `sand`, `bdod`, `cfvo`, `soc`, `phh2o`) and 4 statistical layers (`Q0.05`, `Q0.5`, `mean`, `Q0.95`), decoding DEFLATE-compressed tiled/stripped `int16` GeoTIFFs (`Predictor=2`) in pure Python (`decode_wcs_int16_geotiff`).
- **Unit Scaling & Prohibitions**:
  - Validates unit conversions (`clay/silt/sand: g/kg * 0.1 -> %`, `bdod: cg/cm3 * 0.01 -> kg/dm3`, `cfvo: cm3/dm3 * 0.1 -> vol%`, `soc: dg/kg * 0.1 -> g/kg`, `phh2o: pH*10 * 0.1 -> pH`).
  - Verifies `clay + silt + sand` mass balance (`100% +/- 8%`) and rejects zero/nodata ocean or urban-masked cells (`missing_reason="ocean_or_non_land_cell"`).
  - Explicitly blocks deriving plant-available mineral nitrogen (`NO3` / `NH4`) from SoilGrids (`prohibited_substitutions`, `missing_reason="not_identifiable"`).

### 3.3 FAO GAEZ v4 Suitability Adapter Contract (`FAOGAEZAdapter`)
- **Implementation**: [`adaptive_evidence/adapters/fao_gaez.py`](../../adaptive_evidence/adapters/fao_gaez.py)
- **Honest Default Gate**: Returns `status="BLOCKED"`, `adapter_status="SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED"`, `missing_reason="license_unverified"` unless an authenticated local receipt with verified CC-BY license or an explicit contract-control test flag (`allow_contract_test_fixture=True`) is supplied.
- **Anti-Overclaim Guard**: Strictly prohibits converting regional suitability classes (`VS/S/MS/mS/NS` or `0-100` index) into calibrated farm yields (`calibrated_farm_yield_t_ha=None`).
