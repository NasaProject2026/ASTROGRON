# Scientific Scope, Abstentions, and Limitations — ASTRAGRON Adaptive Evidence

1. **Non-Validation & Abstention Guarantees**:
   - `field_validated` is always `false`; `marketable_yield` and `profit` remain `null`; zero field yield or profit forecasts are emitted.
   - SoilGrids v2.0 values represent **250 m gridded statistical predictions** (`VERIFIED_OPEN_SOURCE_MAP_ESTIMATE`), NOT plot-scale lab soil samples. Geodesic cell-center offsets (`100–250 m`) and cross-PTF (`Saxton & Rawls 2006` vs `Wosten et al. 1999`) divergence are disclosed explicitly.
   - Multi-depth profiles never substitute `0–5 cm` topsoil for deeper requested intervals; profiles exceeding `200 cm` fail closed (`depth_interval_unavailable`); multi-horizon scalar averaging of `phh2o` abstains (`pH` is logarithmic).
   - NASA POWER historical daily series (`~0.5 deg` grid) cannot capture microclimate frost pockets or convective storm cells. Sub-annual windows fail closed on annual C6/C7 climatology (`temporal_mismatch`), and `UTC` vs `LST` time standards are separated cleanly in cache keys and diagnostics.
2. **Screening vs Canonical 5-Year Decision Sensitivity**:
   - `DecisionSensitivityAnalyzer` (`analysis_kind = "REGIONAL_WATER_SCREENING_SENSITIVITY"`) checks seasonal regional water balance (`C6`/`C7`) ONLY and can report `DECISION_STABLE_WITHIN_TESTED_SCENARIOS` even when 5-year daily soil-water/nutrient dynamics in `ClientDecisionService` flip service compliance (`CHANGED_WITHIN_TESTED_SCENARIOS`). Use `CanonicalDecisionSensitivityRunner` for unmodified 5-year canonical stability checks.
3. **Human/Official Authority Boundaries**:
   - Local water rights, groundwater abstraction permits, and regulatory pesticide clearances (`C10`) always remain `OFFICIAL_VERIFICATION_REQUIRED` (`QualityGate` verdict `REJECTED` for automated clearance claims).
   - No fabricated USD Value-of-Information (`economic_voi_usd = null`, `fabricated_voi = false`); single next missing farmer input is ranked strictly by blocking dependencies first and physical parameter sensitivity second.
