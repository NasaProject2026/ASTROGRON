# ASTRAGRON Scientific Truth, Epistemic Honesty & Data Isolation Rules

## 1. Strict Separation of Operating Modes (`P0-A`)
Because the protected scientific backend and raw `M14` research JSON corpus (`candidate_audit.json`, `COMPARISON_DOMAIN.json`) are intentionally isolated outside this standalone frontend workspace, ASTRAGRON enforces three distinct operating modes (`DatasetOperatingMode`):

1. **`SYNTHETIC_UI_DEMO` (Default Active Mode):**
   - Uses 100% synthetic policy IDs (`SYNTH-POL-01` through `SYNTH-POL-12`) and synthetic evidence IDs (`syn-ev-*`) with `source_sha256: null`.
   - Never mixes real `M14` policy hashes (`a27063ce2eca13f02e03`, `fa0e548ed3a7ccbcad4e`) with synthetic rows.
   - Displays a persistent watermark: `SYNTHETIC INTERFACE DEMONSTRATION — NOT RECORDED SCIENTIFIC RESULTS`.
2. **`RECORDED_M14_RESEARCH` (Fail-Closed Without Raw Corpus):**
   - Returns `statusCode: 'SOURCE_NOT_PROVIDED'` and renders `<FailClosedStatusCard />` unless verified raw `M14` JSON corpus files are mounted.
3. **`REAL_SCIENTIFIC_BACKEND` (Fail-Closed Without Live Engine):**
   - Returns `statusCode: 'BACKEND_NOT_CONNECTED'` and renders `<FailClosedStatusCard />` until a live scientific backend endpoint is connected.

## 2. Strict Cross-Site Data Isolation (`P0-B` & `P1-E`)
Every `/farm/[id]/*` route, evidence drawer, and export action queries `src/adapters/repositories.ts`:
- **`uppsala-demo` (Uppsala, Sweden · `59.8586°N, 17.6389°E`):** The sole site qualified for the synthetic 12-policy × 9-state (`108` state evaluations) northern European rotational demonstration (`3` fields: `F1=6.0 ha` non-irrigable, `F2=8.0 ha` non-irrigable, `F3=10.0 ha` irrigable; total `24.0 ha`; `BASE` allocation `8,000 m³/yr` and `80 m³/day`).
- **`nyeri-kenya` (Nyeri, Kenya · `0.4167°S, 36.9500°E`) & `wagga-australia` (Wagga Wagga, Australia · `35.1082°S, 147.3598°E`):** Coverage-only reference sites (`OK_COVERAGE_ONLY`). Navigating to `/analysis`, `/results`, `/plans`, `/climate`, or `/decisions` returns `MODEL_UNQUALIFIED` and blocks Swedish crop rotations, Uppsala weather analogues, and Uppsala evidence records from rendering.
- **Unknown Farm IDs (e.g., `/farm/does-not-exist-999/*`):** Return `SITE_NOT_FOUND` with `data: null` and never fall back to `uppsala-demo`.
- **Custom User Drafts (`/farm/custom-site-draft/*`):** Created when confirming custom coordinates on `/explore` or submitting `/farm/new`; never overwrite `uppsala-demo` and return `BACKEND_NOT_CONNECTED` on model evaluation pages.

## 3. Null-Not-Zero & Honest Abstention Invariants
- **Calendar-Invalid Policies (`SYNTH-POL-12` · `CALENDAR_OVERLAP:F3:Y3`):** Excluded from numeric rankings with `null` shortfall and regret metrics (never substituted with `0`).
- **Climate Series Missing Observations (`2006-08-05`):** Preserved as `null` (`qualityFlag: 'MISSING_NULL'`) so ECharts breaks the line cleanly instead of plotting a false zero dip.
- **Universal Feasibility Abstention (`0 / 12` Pass All States):** Under `STRICT_ALL_SCENARIOS_SERVICE`, the UI explicitly abstains from declaring a winner because non-irrigable Field `F1` exceeds the `100.0 mm` research threshold (`165.473240 mm` deficit) in the `2018` dry analogue.
