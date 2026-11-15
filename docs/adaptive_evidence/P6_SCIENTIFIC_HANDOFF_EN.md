# Stage P6 — Coordinator-Ready Scientific Handoff & Integration Guide (`astragron.adaptive-evidence.v1`)

## 1. Executive Summary & Upstream Preservation

- **Mission**: Implement the **ASTRAGRON Global Adaptive Evidence & Intelligent Fallback Engine** (`astragron.adaptive-evidence.v1`) so arbitrary terrestrial agricultural locations worldwide return scientifically honest, uncertainty-aware partial and conditional outputs (`C1`–`C10`) rather than failing with a monolithic `EVIDENCE_BLOCKED` response whenever local crop/soil/water calibration is incomplete.
- **Zero-Touch Upstream Isolation**:
  - Original Source Archive (`ASTRAGRON_GEMINI_SOURCE.zip`) SHA-256: `55d3ef378e33405a5a3a88215aaec26e2322d801db3dcf75dff317080561368e`
  - Uploaded Bundle (`ASTRAGRON_GEMINI_SOURCE_WITH_GLOBAL_EVIDENCE_PROMPT.zip`) SHA-256: `df30964c51035d3c578bae135b676c91c6ef064e99a69dedcf9929f7634c2ae5`
  - Prompt (`00_READ_FIRST_GEMINI_GLOBAL_ADAPTIVE_EVIDENCE.md`) SHA-256: `23307fc9880c25afb53edda301411b8d644aa40e9ae1f9b45b458c2a319a3a12`
  - Protected Baseline Lock (`coordination/BASELINE_LOCK.json`): **301 / 301 files verified, 0 modified**.
  - Growth Input Lock (`coordination/GROWTH_INPUT_LOCK.json`): **59 / 59 files verified, 0 modified**.
  - Pre-existing upstream files (`brain/`, `contracts/`, `tests/engine/`, `examples/engine/`): **0 modified**.

---

## 2. Coordinator Integration Adapter (`AdaptiveClientDecisionBridge`)

Implemented in [`adaptive_evidence/integration.py`](../../adaptive_evidence/integration.py), `AdaptiveClientDecisionBridge.evaluate_with_adaptive_sidecar(client_request)` wraps the canonical `brain.service.ClientDecisionService` without altering its public response contract (`contracts/CLIENT_DECISION_API_V1.md`):
1. Runs `ClientDecisionService.evaluate(client_request)` and returns the unmodified payload in `upstream_client_decision_response`.
2. Translates the location, period, candidate crops, and water supply parameters into `astragron.adaptive-evidence.request.v1` and runs `AdaptiveEvidenceEngine.evaluate(...)` (`adaptive_evidence_sidecar`).
3. Runs `DecisionSensitivityAnalyzer.analyze(...)` (`decision_sensitivity`) to classify `DECISION_STABLE_WITHIN_TESTED_SCENARIOS`, `DECISION_SENSITIVE`, or `UNDETERMINED` with code-backed witnesses.
4. Attaches `provenance_and_license_ledger` and `rollback_and_isolation_plan`.

---

## 3. Provenance & License Ledger

| Source / Method ID | Provider | License | Scientific Role & Restrictions |
|---|---|---|---|
| `NASA_POWER_MERRA2_DAILY_UTC` | NASA Langley Research Center POWER Project | Public Domain / Open Attribution | Historical regional daily meteorology (`0.625 x 0.5 deg`, `3080 km²`); not a future forecast or on-farm gauge. |
| `ISRIC_SOILGRIDS_V2_250M_WCS` | ISRIC - World Soil Information | `CC-BY-4.0` | Regional 250 m predictions (`0.0625 km²`) with `Q0.05`/`Q0.50`/`mean`/`Q0.95` quantiles; never converted to mineral `NO3`/`NH4`. |
| `FAO_IIASA_GAEZ_V4_5ARCMIN` | FAO & IIASA (GAEZ v4) | `SOURCE_UNAVAILABLE_OR_LICENSE_UNVERIFIED` by default | Blocked with `license_unverified` unless verified local CC-BY receipt is supplied; never converted to farm yield. |
| `SAXTON_RAWLS_2006_PTF_V1` | Saxton & Rawls (2006), *SSSAJ* | Published Equation | Mineral soil water retention (`OM <= 8.0%`, `clay <= 60%`); strictly `CONDITIONAL`. |
| `WOSTEN_1999_HYPRES_PTF_V1` | Wösten et al. (1999), *Geoderma* | Published Equation | Secondary continuous pedotransfer check quantifying inter-PTF structural divergence. |
| `HARGREAVES_SAMANI_1985_ET0_V1` | Hargreaves & Samani (1985) | Published Equation | Conditional daily radiation-temperature reference evapotranspiration (`ET0`). |

---

## 4. Rollback & Isolation Plan

- All deliverables live exclusively in `adaptive_evidence/`, `tests/adaptive_evidence/`, `examples/adaptive_evidence/`, and `docs/adaptive_evidence/` on branch `feature/global-adaptive-evidence`.
- One-step rollback: `git checkout snapshot/baseline` (or deleting the four `adaptive_evidence` directories) restores the exact initial repository state with zero side effects.
