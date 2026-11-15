# Stage P7 — Continued Scientific Improvements

Implemented in [`adaptive_evidence/improvements.py`](../../adaptive_evidence/improvements.py), Stage P7 delivers four high-value scientific and agronomic increments on top of the verified P0–P6 core:

1. **Multi-Depth (0–200 cm) Root-Zone Integration & Subsurface Impedance Detection (`integrate_multidepth_root_zone_profile`)**:
   - Integrates all 6 standard ISRIC SoilGrids v2.0 horizons (`0-5`, `5-15`, `15-30`, `30-60`, `60-100`, `100-200 cm`) up to any crop-specific `root_depth_m` (`0.05`–`2.00 m`).
   - Automatically detects subsurface root-impeding layers (`bdod >= 1.68 kg/dm3` compaction hardpan or `cfvo >= 50 vol%` skeletal gravel layer below `15 cm`), truncating `effective_root_depth_m` and computing thickness-weighted `depth_weighted_theta_wp`, `depth_weighted_theta_fc`, `depth_weighted_awc_mm_m`, and `cumulative_root_zone_paw_mm`.
2. **Field Polygon Spatial Heterogeneity & Management-Zone Diagnostics (`evaluate_polygon_spatial_heterogeneity`)**:
   - Validates GeoJSON `Polygon` field boundaries in `EPSG:4326`, estimates bounding-box acreage (`approx_bbox_area_ha`), evaluates spatial coefficient of variation (`cv_awc_pct`) and clay spread (`clay_spread_pct`) across sampled 250 m SoilGrids cells, and flags `requires_zonal_soil_sampling = True` when `cv_awc_pct >= 12%` or `clay_spread_pct >= 15%`.
3. **Cross-PTF & Cross-Source Disagreement Diagnostics (`diagnose_source_and_ptf_disagreement`)**:
   - Quantifies structural divergence between Saxton & Rawls (2006) (`SAXTON_RAWLS_2006_PTF_V1`) and Wösten et al. (1999) HYPRES (`WOSTEN_1999_HYPRES_PTF_V1`), flagging `HIGH_INTER_MODEL_DIVERGENCE` whenever $|\Delta\text{AWC}| > 20\text{ mm/m}$ or $|\Delta\theta_{fc}| > 0.045\text{ m}^3/\text{m}^3$.
4. **Held-Out 12-Class USDA Pedotransfer Benchmark (`run_held_out_ptf_benchmark`) & Farmer Measurement Wizard (`build_farmer_measurement_wizard`)**:
   - Benchmarks `SAXTON_RAWLS_2006_PTF_V1` across 12 published USDA texture classes (`Sand` through `Clay`), reporting exact `MAE`, `RMSE`, and `bias` for `theta_wp`, `theta_fc`, and `awc_mm_m`.
   - Converts low-friction on-farm observations (hand-ribbon/jar texture class, trench rooting depth, irrigation allocation) into schema-valid `user_measurements` and `water_supply_scenario` blocks.
