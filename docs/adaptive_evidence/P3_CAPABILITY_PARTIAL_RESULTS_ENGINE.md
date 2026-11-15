# Stage P3 — Capability-Level Partial-Results Engine (`astragron.adaptive-evidence.v1`)

## 1. Architecture & Schemas

Implemented in [`adaptive_evidence/engine.py`](../../adaptive_evidence/engine.py) (`AdaptiveEvidenceEngine`), Stage P3 replaces the upstream all-or-nothing readiness gate with independent evaluation of capabilities `C1` through `C10`, validated against:
- Request JSON Schema: [`docs/adaptive_evidence/adaptive_evidence_request_v1.schema.json`](adaptive_evidence_request_v1.schema.json)
- Response JSON Schema: [`docs/adaptive_evidence/adaptive_evidence_response_v1.schema.json`](adaptive_evidence_response_v1.schema.json)

---

## 2. Independent Capability Evaluation (`C1`–`C10`)

| Capability | Ready Condition | Conditional Condition | Blocked Condition |
|---|---|---|---|
| `C1` Geographic & Land Identity | Valid terrestrial `EPSG:4326` coordinates and monotonic soil depth intervals | — | Invalid CRS, out-of-range coordinates, ocean/polar cell, or inverted depth |
| `C2` Historical Regional Climate | Authentic cached or live-fetched daily NASA POWER MERRA-2 series | Offline regional climatology reference summary | Source outage, corrupt receipt, or post-cutoff snapshot |
| `C3` Regional Soil Properties | On-farm soil laboratory analysis | 250 m ISRIC SoilGrids v2.0 WCS predictions (`clay`, `silt`, `sand`, `bdod`, `cfvo`, `soc`, `phh2o`) | Source outage, urban/ocean zero mask, or violated texture mass balance |
| `C4` Soil Hydraulic Screening | Direct soil core water-retention measurements (`theta_wp < theta_fc`) | Saxton & Rawls (2006) + Wösten (1999) PTF across `LOW`/`REFERENCE`/`HIGH` scenarios | Out-of-domain organic peat (`OM > 8%`), heavy clay (`>60%`), or blocked `C3` |
| `C5` Regional Suitability Screening | — | Verified local FAO GAEZ v4 receipt or explicit contract-control fixture | Default: `SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED` (`license_unverified`) |
| `C6` Water Balance & Irrigation | Local measured soil hydraulics + calibrated crop `Kc` | `C2` + `C4` + supported regional crop `Kc` under declared water supply scenario | Unsupported crop (`unsupported_crop_profile`) or blocked `C2`/`C4` |
| `C7` 5-Year Crop / Rotation Plan | Upstream `ClientDecisionService` `DECISION_READY` with local calibration | Scenario-conditional 5-year crop ranking under `C6` + declared water supply | Missing water supply scenario, unsupported crop, or blocked `C6` |
| `C8` Process Simulation (`WOFOST`/`SNOMIN`) | — | Pinned Wageningen research envelope `[5.67, 51.97]` with measured mineral N | Non-Wageningen coordinates (`unsupported_region`) or missing mineral N (`not_identifiable`) |
| `C9` Economic Cost Screening | — | User-declared input cost scenario (`marketable_yield=null`, `profit=null`) | Missing local input cost parameters |
| `C10` Legal & Regulatory Compliance | — | User-supplied official water permit & pesticide clearance verification | Default: `official_verification_required` |

---

## 3. Seven Verified P3 Scenarios (`tests/adaptive_evidence/test_p3_partial_engine.py`)

1. **`climate_only` (`DE_BERLIN`)**: `C1=READY`, `C2=READY`, `C3..C10=BLOCKED` — returns full historical climate envelope even when urban-masked SoilGrids is unavailable.
2. **`climate_plus_regional_soil` (`KE_NYERI_REGION`)**: `C1=READY`, `C2=READY`, `C3=CONDITIONAL`, `C4=CONDITIONAL`, `C6=CONDITIONAL`, `C7/C8/C10=BLOCKED`.
3. **`source_outage` (`AU_WAGGA_REGION` with simulated NASA outage)**: `C2=BLOCKED (source_outage)`, while `C3=CONDITIONAL` and `C4=CONDITIONAL` still succeed independently.
4. **`unsupported_crop` (`["dragonfruit", "wheat"]`)**: `C1..C4` succeed, while `C6` and `C7` are `BLOCKED` with `unsupported_crop_profile`.
5. **`supported_conditional_research` (`NL_WAGENINGEN_RESEARCH`)**: `C1=READY`, `C2..C4=CONDITIONAL`, `C6..C9=CONDITIONAL`, `C10=BLOCKED`.
6. **`missing_water_rights` (`AU_WAGGA_REGION` irrigated without permit)**: `C6=CONDITIONAL`, `C7=CONDITIONAL`, `C10=BLOCKED (official_verification_required)`.
7. **`unknown_field_measurements` (`SE_UPPSALA` coordinates only)**: Returns `C1`, `C2`, `C3`, `C4`, `C6` and prioritized `minimal_next_measurements`.
