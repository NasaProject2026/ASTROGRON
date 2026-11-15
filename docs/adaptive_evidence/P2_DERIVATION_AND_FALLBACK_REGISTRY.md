# Stage P2 — Physically Bounded Derivation & Fallback Registry

## 1. Registered Estimators (`ESTIMATOR_REGISTRY`)

Implemented in [`adaptive_evidence/estimators.py`](../../adaptive_evidence/estimators.py), every permitted derivation is governed by an explicit estimator entry declaring its citation, required input units, domain applicability bounds, physical invariants, uncertainty propagation method, and mandatory qualification downgrade.

| Estimator ID | Citation | Inputs & Domain Bounds | Outputs & Physical Invariants | Qualification Impact |
|---|---|---|---|---|
| `SAXTON_RAWLS_2006_PTF_V1` | Saxton & Rawls (2006), *SSSAJ*, 70(5), 1569-1578 | `clay_pct` `[2, 60]%`, `silt_pct` `[0, 88]%`, `sand_pct` `[5, 92]%`, `soc_g_kg` `[0, 46.4] g/kg` (`OM <= 8.0%`), `bdod_kg_dm3` `[0.90, 1.85]`, `cfvo_vol_pct` `[0, 75] vol%`, `root_depth_m` `[0.05, 3.0] m` | `theta_wp`, `theta_fc`, `theta_s` (`m3/m3`), gravel-discounted `awc_mm_m` (`mm/m`), `paw_root_mm` (`mm`). Enforces $0 < \theta_{wp} < \theta_{fc} < \theta_s < 1$ and $\text{clay} + \text{silt} + \text{sand} = 100\%$. | `DERIVED_WITH_VALIDATED_METHOD` -> downgrades `C4` and `C7` to `CONDITIONAL` (never `READY`). |
| `WOSTEN_1999_HYPRES_PTF_V1` | Wösten et al. (1999), *Geoderma*, 90(3-4), 169-185 | Same mineral soil domain bounds as `SAXTON_RAWLS_2006_PTF_V1` | Secondary continuous PTF check (`cross_ptf_awc_diff_mm_m`) quantifying inter-model structural uncertainty. | `DERIVED_WITH_VALIDATED_METHOD` -> `CONDITIONAL`. |
| `HARGREAVES_SAMANI_1985_ET0_V1` | Hargreaves & Samani (1985), *Appl. Eng. Agric.*, 1(2), 96-99 | `lat_deg` `[-66.5, 66.5]`, `tmin_c <= tmean_c <= tmax_c` | Conditional radiation-temperature daily reference evapotranspiration `et0_mm_day >= 0`. | `DERIVED_WITH_VALIDATED_METHOD` -> `CONDITIONAL`. |

---

## 2. Joint Scenario Propagation & Out-of-Domain Rejection

- **Normalized Joint Scenarios (`LOW_WATER_HOLDING`, `REFERENCE`, `HIGH_WATER_HOLDING`)**:
  - Rather than plugging independent marginal `Q0.05` and `Q0.95` textures directly into PTF equations (which would violate $\text{clay} + \text{silt} + \text{sand} = 100\%$), `derive_soil_hydraulics_from_soilgrids` constructs three physically normalized joint scenarios via `normalize_texture_triplet` combined with `soc`, `bdod`, and `cfvo` quantiles.
- **Out-of-Domain Rejection (`missing_reason="estimator_out_of_domain"`)**:
  - Organic / peatland soils with $\text{OM} > 8.0\%$ ($\text{SOC} > 46.4\text{ g/kg}$, e.g. `FI_OSTROBOTHNIA_OULU` boreal peatland with $\text{SOC} = 65.0\text{ g/kg} \Rightarrow \text{OM} = 11.2\%$) are automatically blocked with `estimator_out_of_domain`.
  - Heavy swelling clays ($\text{clay} > 60\%$), skeletal gravel beds ($\text{cfvo} > 75\%$), and extreme bulk densities ($\text{bdod} \notin [0.90, 1.85]\text{ kg/dm}^3$) are deterministically rejected.

---

## 3. Prohibited Derivations Registry (`PROHIBITED_DERIVATIONS_REGISTRY`)

`attempt_prohibited_derivation(target_parameter, inputs)` enforces hard negative gates for parameters that cannot be scientifically or legally inferred from regional proxies:

1. `soil.mineral_n_kg_ha` -> `BLOCKED` (`missing_reason="not_identifiable"`)
2. `legal.water_abstraction_permit` -> `BLOCKED` (`missing_reason="official_verification_required"`)
3. `legal.pesticide_registration` -> `BLOCKED` (`missing_reason="official_verification_required"`)
4. `crop.calibrated_kc_curve` -> `BLOCKED` (`missing_reason="unsupported_crop_profile"`)
5. `economics.marketable_yield_t_ha` -> `BLOCKED` (`missing_reason="not_identifiable"`)
6. `economics.net_profit_per_ha` -> `BLOCKED` (`missing_reason="not_identifiable"`)
