# Stage P0 — Baseline Inventory, Reproducibility & Claim-Dependency Map

## 1. Archive & Snapshot Provenance
- **Uploaded Archive (`ASTRAGRON_GEMINI_SOURCE_WITH_GLOBAL_EVIDENCE_PROMPT.zip`):**
  - SHA-256: `df30964c51035d3c578bae135b676c91c6ef064e99a69dedcf9929f7634c2ae5` (17,621,343 bytes; 1,203 files).
- **Original Source Snapshot (`ASTRAGRON_GEMINI_SOURCE.zip` per `GEMINI_SOURCE_ARCHIVE_RECEIPT.json`):**
  - SHA-256: `55d3ef378e33405a5a3a88215aaec26e2322d801db3dcf75dff317080561368e` (1,201 files).
- **Mission Specification (`00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`):**
  - SHA-256: `23307fc9880c25afb53edda301411b8d644aa40e9ae1f9b45b458c2a319a3a12`.
- **Protected Upstream Lock (`coordination/BASELINE_LOCK.json`):**
  - Commit: `03be95432d6ee5b83f80b2e98b9575484b927025`
  - Lock SHA-256: `5447e3eb907ebe1a70f5e8e63f8a63aacf140811cc04d6f95c8518abd4f92dfe`
  - Verified files: **301 / 301** (`0` mismatches).
- **Protected Growth Input Lock (`coordination/GROWTH_INPUT_LOCK.json`):**
  - Lock SHA-256: `d7be163cf056384b6b19db52b86a9ff61105f7b405f95f441cf3b636a1a40fa7`
  - Verified files: **59 / 59** (`0` mismatches).

## 2. Authoritative Upstream Architecture vs. Historical R&D Packs
- **Authoritative Root Engine (`brain/` & `contracts/`):**
  - `brain/service.py` (`ClientDecisionService(runtime_dir).run(payload)`) and `brain/cli.py` implement `contracts/CLIENT_DECISION_API_V1.md` (`astragron.client-decision.request.v1` -> `astragron.client-decision.response.v1`).
  - `brain/growth_decision.py` and `brain/growth_experiment.py` implement `contracts/GROWTH_DECISION_BRIDGE_V1.md` (`astragron.growth-decision.request.v1`) for a narrow conditional Wageningen research comparison (`[5.67, 51.97]`, `NL`, `2016-2020`, `potato_Fontane` / `sugarbeet_601`).
- **Historical R&D Pack (`ASTRAGRON_COMPLETE_RND_PACK_2026-10-20/`):**
  - Retained strictly as read-only historical provenance and locked PCSE crop/soil parameter fixtures (`GROWTH_INPUT_LOCK.json`). Not used as the public API contract.

## 3. Real Missing-Data Pathways in the Current Baseline
1. **All-or-Nothing Scientific Gate (`MP_01`):** In `SOIL_MEMORY_FINAL_TEST_ISOLATION_20261109/release/water_core/application.py`, if `scientific_gate(d)` finds any missing local parameter (`crop_profiles`, `fields[*].soil`, `winter`, `supply`, or `assumptions_manifest`), execution halts before `forcing()` / `weather()` are run, returning `status="CLIMATE_READY_CROP_MODEL_BLOCKED"` (`EVIDENCE_BLOCKED` in Client API v1) with `alternatives=[]` and no extracted climate profile.
2. **Missing Soil Hydraulic Parameters (`MP_02`):** `water_core/contract.py` requires explicit `theta_fc` and `theta_wp` (`m3/m3`) per field. Locations with coordinates only have no regional soil screening (`C3`) or pedotransfer hydraulic estimation (`C4`).
3. **Climate Cache Scope (`MP_03`):** `water_core/source_cache/` ships authentic multi-year NASA POWER receipts for 4 sites (`SE_UPPSALA`, `AU_WAGGA_REGION`, `KE_NYERI_REGION`, `DE_BERLIN`). Other global coordinates require bounded acquisition or cached receipts.
4. **Growth Bridge Scope (`MP_04`):** `brain/growth_decision.py` is restricted to `[5.67, 51.97]` (`NL`, 2016–2020) and requires an 8-variable solar/weather NASA receipt plus an external PCSE Python environment.

## 4. Capability Dependency Map (`C1`–`C10`)
| Capability | Description | Upstream Dependencies | Can Proceed When `C7` Blocked? | Field Validated? |
|---|---|---|---|---|
| `C1` | Coordinates, land/geographic identity & source coverage | None | Yes | No (`false`) |
| `C2` | Historical regional climate profile & limitations (NASA POWER) | `C1` | Yes | No (`false`) |
| `C3` | Soil property screening with depth, resolution & quantiles (SoilGrids) | `C1` | Yes | No (`false`) |
| `C4` | Derived hydrologic soil-property range (pedotransfer estimator) | `C1`, `C3` | Yes | No (`false`) |
| `C5` | Regional crop suitability screening (licensed source if obtained) | `C1` | Yes | No (`false`) |
| `C6` | Historical water-demand / deficit research diagnostics | `C1`, `C2`, `C4` | Yes | No (`false`) |
| `C7` | Conditional 5-year crop planning (Client Decision API v1) | `C1`, `C2`, `C4`, `C6` | Planner itself | No (`false`) |
| `C8` | Native crop-growth & N research (WOFOST/SNOMIN at `[5.67, 51.97]`) | `C1`, `C2` | Independent narrow scope | No (`false`) |
| `C9` | Optional conditional economics (dated user price/cost/yield) | `C1` | Yes (scenario arithmetic) | No (`false`) |
| `C10` | Pesticide, water-right & legal clearance | `C1` | Always `BLOCKED` until official local verification | No (`false`) |

## 5. Baseline Coverage Matrix (24 Geographic + 8 Adversarial Cases)
- **24 Geographic Cases:** Cover Northern and Southern Hemispheres, humid tropics, drylands/hyper-arid deltas, Mediterranean plains, cool temperate, cold continental/subarctic (`>65°N`), tropical/Andean mountains (`~3400 m`), and coastal lowlands.
  - Baseline Engine `CONDITIONAL_RESEARCH_COMPLETE`: **2 / 24** (`GEO_01_SE_UPPSALA`, `GEO_02_AU_WAGGA`).
  - P0 Local Cache Climate Ready (`C2 = READY`): **4 / 24** (`SE_UPPSALA`, `AU_WAGGA`, `KE_NYERI`, `DE_BERLIN`).
  - False qualification upgrades: **0**.
- **8 Adversarial Cases:** Open Pacific Ocean (`[-140, 0]`), unsupported CRS (`EPSG:3857`), out-of-bounds coordinates (`[195, -95]`), Antarctic ice sheet (`[0, -82]`), misaligned soil depth intervals, prohibited mineral-N derivation from total N + self-certified water rights, tampered NASA receipt SHA-256 / post-cutoff timestamp, and unsupported crop cultivar + unqualified profit claim. All 8 adversarial claims are strictly blocked.
