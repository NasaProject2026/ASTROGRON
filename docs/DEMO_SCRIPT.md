# ASTRAGRON — 3-Minute Professional Demo Script (`DEMO_SCRIPT.md`)

**Objective:** Showcase the complete user journey (`Landing → Earth Explorer → Farm Setup → Scenario Analysis → Honest Abstention → Provenance & Export`) with zero scientific exaggeration.

---

### Step 1: Cinematic Opening & Honest Proposition (0:00 – 0:30)
1. Open `http://localhost:3000/`.
2. Point out the orbital Earth limb and spacecraft hero composition on the right and the clean editorial headline on the left: **"Understand your land. Explore what comes next."**
3. Highlight the persistent top disclosure bar (`DEMO DATA — NOT A FARM RECOMMENDATION`) and the conceptual art disclosure note below the telemetry strip.
4. Scroll briefly through the narrative sections—specifically **Section 3 (Explore Global Coverage)** and **Section 5 (Decision Transparency & Honest Abstention)**—then click **Explore Earth**.

### Step 2: Global Earth Explorer & M4 Source Coverage (0:30 – 1:15)
1. On `/explore`, rotate/zoom the MapLibre GL JS v6 globe and inspect the default **Uppsala Research Domain (Sweden)** site (`[17.6389, 59.8586] EPSG:4326`).
2. Click **Nyeri (Kenya)** or **Wagga Wagga (Australia)** in the top preset bar:
   - Point out that while NASA POWER and GPM IMERG show `AVAILABLE` or `CONDITIONAL` regional coverage, **Regional Crop Phenology & Water-Service Calibration** is marked `OUT_OF_COVERAGE` because Swedish crop coefficients are never extrapolated to other climates.
3. Click **Uppsala Research Domain (Sweden)** again, test the **GeoJSON Import** or **DMS Converter** tab, and click **Confirm & Inspect Evidence Readiness**.

### Step 3: Guided Farm Setup & Null Preservation (1:15 – 1:45)
1. Click **Edit in Setup Wizard** (`/farm/new`) to walk through the 5-step wizard:
   - Show Step 2 (**Field Parcels**), highlighting that **Field F1** is explicitly `NON-IRRIGABLE` (`irrigationAccess: NO`), while Fields `F2–F4` share a surface canal delivery cap.
   - Show Step 3 (**Soil, Water & Crops**), pointing out that unmeasured mineral nitrogen (`NO3-N`) is stored as `NULL (Not Measured)` rather than fake zeros.
   - Click **Open Recorded M14 Decision Results** on Step 5.

### Step 4: Decision Overview & Honest Abstention (1:45 – 2:30)
1. On `/farm/uppsala-demo/results`, read the primary outcome statement aloud:
   > *"No tested policy meets the declared water-service criterion across all recorded scenarios. You can still compare conditional research alternatives, but a field recommendation is not available."*
2. Point to **Zone 1 (Feasibility Audit)**: `16 policies × 9 states = 144 cases` (`135 numeric`, `9 calendar-invalid`; `90 state passes`, `45 state fails`, `0 universal passes`).
3. In **Zone 2**, switch between the four M14 preference buttons:
   - `MINIMIZE_WORST_ET_SHORTFALL`: Highlights Policy `a27063ce2eca13f02e03` (`52,102.45 m³ eq` worst-state shortfall).
   - `MINIMAX_REGRET`: Highlights Policy `fa0e548ed3a7ccbcad4e` (`814.77 m³ eq` maximum regret).
   - `PARETO_FRONTIER`: Shows `NO_UNIQUE_WINNER` across the 4 non-dominated policies.
   - Point out excluded Policy `c91b40e7118d44f09b12` at the bottom (`9 calendar-invalid states`, `NULL` shortfall/regret).

### Step 5: Five-Year Matrix, Climate Analogues, Provenance & Export (2:30 – 3:00)
1. Open **Five-Year Plan Matrix** (`/farm/uppsala-demo/plans`) and toggle **Compare Two Policies** to view `a27063ce2eca13f02e03` vs `fa0e548ed3a7ccbcad4e` side by side.
2. Open **Climate & Water Series** (`/farm/uppsala-demo/climate`) to inspect the Apache ECharts plots and companion HTML table for the `2018` dry, `2006` median, and `2012` wet recorded historical analogues (noting the explicit `NULL (Gap)` row in 2006).
3. Click any **View evidence** button to open the **Scientific Provenance Drawer**, then navigate to **Reports & Export** (`/farm/uppsala-demo/reports`) to download the watermarked JSON/CSV.
