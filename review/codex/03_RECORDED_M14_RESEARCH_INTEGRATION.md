# 03 — Source-Backed M14 Recorded Integration (`SE_UPPSALA`)

## 1. Exact Preserved Recorded M14 Quantitative Truth
Using `src/adapters/m14-recorded-translator.ts` and read-only `GET /api/research/m14?siteId=SE_UPPSALA`:

- **Experiment Domain:** `16` unique policy IDs × `9` seasonal/weather scenarios = `144` cases.
- **Outcomes:** `135` comparable numeric evaluations (`90 PASS`, `45 FAIL`) under the `100.0 mm` water-service criterion + `9` `CALENDAR_INELIGIBLE` cases (`0` policies pass all `9` states).
- **Calendar-Excluded Policy:** `10e4f587b144b38bae9d` remains `CALENDAR_INELIGIBLE` / `NOT_EVALUATED` across all 9 states and is never coerced to `0 mm`.
- **Distinct Pareto / Robustness Leaders (`preference_decisions.json`):**
  - Least-Worst ET Shortfall: `a27063ce2eca13f02e03` (`52,102.45 m³ eq` — raw `52102.446821`)
  - Minimax Regret: `fa0e548ed3a7ccbcad4e` (`814.77 m³ eq` — raw `814.768106`)
  - Unspecified Preference: `NO_UNIQUE_WINNER (2 Policies)` (`{a27063ce2eca13f02e03, fa0e548ed3a7ccbcad4e}`)
- **Sensitivity Bracket on F1 Rainfed Max Deficit:** `165.47323956605408 mm`, explicitly displaying `[165.473239, 165.473240]` mm bracket bounds.
- **Forensic Cross-Platform Note:** Upstream CPython Windows `3.14.3` vs Linux `3.13.5` exhibits a 1-ULP `libm` difference in `sin(0.7676162197112674)` at `J=4` (`~1e-14 mm`), causing zero policy rank or PASS/FAIL change.

## 2. Mode & Scientific Boundaries
- Synthetic fixtures (`SYNTH-POL-*`, `SYNTHETIC_UI_DEMO`) never mix with `RECORDED_M14_RESEARCH`.
- Analogues (`2006`, `2012`, `2018`) are explicitly labeled historical analogues; unmodeled `ET0` renders `ET0: N/A (Unmodeled)`.
- Custom forked Uppsala sites and non-Sweden locations fail closed and never inherit `SE_UPPSALA` M14 policy tables (`app/api/research/m14/route.ts` rejects unknown/traversal `siteId`, e.g. `../etc/passwd` -> HTTP `400`).
- **Execution Note:** Native Python scripts (`m14_replay.py`, `m14_api.py`) are `NOT_RUN_NO_PYTHON`.
