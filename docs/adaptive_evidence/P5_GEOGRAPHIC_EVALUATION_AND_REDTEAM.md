# Stage P5 — Geographic Generalization Evaluation, Security & Scientific Red-Team

## 1. P0 Baseline vs. P5 Adaptive Coverage Across 24 Global Agricultural Sites

Evaluated by [`adaptive_evidence/evaluation.py`](../../adaptive_evidence/evaluation.py) (`evaluate_p5_generalization_and_redteam`), Stage P5 benchmarks all 24 geographic sites across two distinct evidence modes so authentic cached receipts and offline regional reference fixtures are never conflated:

| Metric | Stage P0 Baseline | Stage P5 (Authentic Cache Only) | Stage P5 (Regional Reference + Conditional Mode) |
|---|---|---|---|
| **Total Terrestrial Geographic Sites** | 24 | 24 | 24 |
| **`C2` Historical Regional Climate Ready/Conditional** | 4 / 24 (`16.67%`) | 4 / 24 (`16.67%`) | **24 / 24 (`100.0%`)** |
| **`C3` 250 m SoilGrids Properties Conditional** | 0 / 24 (`0.0%`) | 5 / 24 (`20.83%` live WCS receipts) | **24 / 24 (`100.0%`)** |
| **`USEFUL_PARTIAL_COVERAGE` (`C1`+`C2`+`C3`)** | 4 / 24 (`16.67%`) | 6 / 24 (`25.0%` authentic cache) | **24 / 24 (`100.0%`)** |
| **`CONDITIONAL_PLANNING_COVERAGE` (`C7` Conditional)** | 0 / 24 (`0.0%`, `1/24` Ready) | 3 / 24 (`12.5%` authentic cache) | **23 / 24 (`95.83%`)** (1 boreal peatland `FI_OSTROBOTHNIA_OULU` honestly blocked at `C4` with `estimator_out_of_domain`) |
| **`FALSE_QUALIFICATION_UPGRADES`** | 0 | **0** | **0** |
| **`EVIDENCE_METADATA_COMPLETENESS`** | — | **100.0% (`1.0`)** | **100.0% (`1.0`)** |
| **`prediction_accuracy`** | `"NOT_MEASURED"` | `"NOT_MEASURED"` | `"NOT_MEASURED"` |

---

## 2. 16-Probe Scientific & Security Red-Team Suite (`100.0%` Pass Rate)

1. `ADV_01_PACIFIC_OCEAN` (`[-140.0, 0.0]`) -> `BLOCKED` (`ocean_or_non_land_cell`)
2. `ADV_02_ATLANTIC_OCEAN` (`[-30.0, 15.0]`) -> `BLOCKED` (`ocean_or_non_land_cell`)
3. `ADV_03_ANTARCTIC_POLAR` (`[0.0, -82.0]`) -> `BLOCKED` (`unsupported_region`)
4. `ADV_04_WRONG_CRS_3857` (`EPSG:3857`) -> `BLOCKED` (`invalid_coordinates_or_crs`)
5. `ADV_05_OUT_OF_RANGE_COORDS` (`[210.0, 95.0]`) -> `BLOCKED` (`invalid_coordinates_or_crs`)
6. `ADV_06_INVERTED_SOIL_DEPTH` (`[30, 15] cm`) -> `BLOCKED` (`depth_inconsistency`)
7. `ADV_07_CORRUPT_RECEIPT_HASH` -> `BLOCKED` (`corrupt_receipt_or_hash_mismatch`)
8. `ADV_08_POST_CUTOFF_TIMESTAMP` -> `BLOCKED` (`stale_or_post_cutoff_snapshot`)
9. `RT_09_TEXTURE_SUM_VIOLATION` (`clay + silt + sand = 140%`) -> `BLOCKED` (`quality_fail`)
10. `RT_10_MINERAL_N_FROM_SOILGRIDS_BLOCKED` -> `BLOCKED` (`not_identifiable`)
11. `RT_11_WATER_RIGHTS_FROM_RAINFALL_BLOCKED` -> `BLOCKED` (`official_verification_required`)
12. `RT_12_GAEZ_SUITABILITY_TO_FARM_YIELD_BLOCKED` -> `BLOCKED` (`not_identifiable`)
13. `RT_13_UNSUPPORTED_CROP_GENERIC_KC_BLOCKED` (`avocado_uncalibrated`) -> `BLOCKED` (`unsupported_crop_profile`)
14. `RT_14_PEATLAND_PTF_OUT_OF_DOMAIN_BLOCKED` (`FI_OSTROBOTHNIA_OULU`, `OM=11.2% > 8.0%`) -> `BLOCKED` (`estimator_out_of_domain`)
15. `RT_15_INVERTED_RETENTION_USER_INPUT_BLOCKED` (`theta_wp=0.38 > theta_fc=0.21`) -> `BLOCKED` (`quality_fail`)
16. `RT_16_PATH_TRAVERSAL_AND_BOOLEAN_COORD_GUARD` (`site_id="../../etc/passwd"`, `[True, False]`) -> `BLOCKED` (`invalid_coordinates_or_crs`)
