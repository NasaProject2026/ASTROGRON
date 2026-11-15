# Stage P4 — Uncertainty Propagation, Decision Stability, and Minimal Next Measurements

## 1. Bounded Candidate x Joint-Scenario Sensitivity Grid

Implemented in [`adaptive_evidence/sensitivity.py`](../../adaptive_evidence/sensitivity.py) (`DecisionSensitivityAnalyzer`), Stage P4 propagates empirical climate and soil uncertainty across a bounded joint-scenario grid combining:
- **3 Historical Climate States (`C2`)**: `CLIM_DRY_Q05` (driest year precipitation, `+8%` evaporative demand), `CLIM_REF_MEAN` (mean precipitation and reference `ET0`), `CLIM_WET_Q95` (wettest year precipitation, `-7%` evaporative demand).
- **4 Soil Hydraulic States (`C4`)**: `SOIL_LOW_AWC` (Saxton & Rawls 2006 low water-holding scenario, `0.85x` rooting depth), `SOIL_REF_AWC` (reference scenario), `SOIL_HIGH_AWC` (high water-holding scenario, `1.15x` rooting depth), and `SOIL_WOSTEN_PTF` (secondary Wösten et al. 1999 HYPRES pedotransfer check).
- **Irrigation Supply Perturbations**: `SUPPLY_LOW_75PCT`, `SUPPLY_REF_100PCT`, `SUPPLY_HIGH_125PCT` (or `SUPPLY_RAINFED_0MM` for rainfed requests).

---

## 2. Decision-Stability Classifications & Code-Backed Witnesses

Every evaluation produces one of three exact classifications:
1. **`DECISION_STABLE_WITHIN_TESTED_SCENARIOS`**:
   - Triggered when `flip_witness_count == 0` across all tested joint scenarios (`top_crop` and `feasible_crops` remain invariant).
   - Includes a `stability_witness` enumerating `invariant_top_crop`, `invariant_feasible_crops`, and all `tested_scenario_ids`.
2. **`DECISION_SENSITIVE`**:
   - Triggered when at least one joint scenario flips either the `top_crop` or the `feasible_crops` set relative to `reference_scenario_id`.
   - Includes explicit `flip_witnesses` showing `reference_scenario_id`, `perturbed_scenario_id`, `reference_top_crop` vs `perturbed_top_crop`, `reference_feasible_crops` vs `perturbed_feasible_crops`, and exact physical input perturbations.
3. **`UNDETERMINED`**:
   - Triggered when `C2`, `C4`, or candidate crop profiles are `BLOCKED` (`tested_scenario_count == 0`).

---

## 3. Physical Parameter Influence Ranking (Zero Fabricated VoI)

- Ranks `soil_hydraulics.awc_mm_m_and_root_depth_m`, `climate.interannual_precipitation_envelope`, and `water_supply_scenario.seasonal_supply_m3_ha` by single-factor flips caused and adequacy-score swing.
- Explicitly sets `economic_voi_usd = null` and `fabricated_voi = false` on every sensitivity report and measurement recommendation.
