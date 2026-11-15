# ASTRAGRON — UX, Page Architecture & Product Flows (`UX_AND_PAGE_ARCHITECTURE.md` & `PRODUCT_FLOWS.md`)

## 1. End-to-End Farmer & Researcher Journey

1. **Stage 0 — First Impression (`/`):**
   - Within 5 seconds, the visitor sees the orbital Earth limb and spacecraft visual, understands the proposition (*"Understand your land. Explore what comes next."*), sees the honest qualifier (*"Research-only analysis · No field-calibrated recommendation"*), and clicks **Explore Earth** or **View Research Demo**.
2. **Stage 1 — Choose a Place (`/explore`):**
   - Visitor clicks a point on the MapLibre GL JS v6 globe, searches the offline-resilient index, pastes decimal `[longitude, latitude]`, converts DMS coordinates, or clicks **Use My Location** (explicit consent).
   - Visitor draws a field polygon or imports GeoJSON (validated for `<= 2048` vertices, `<= 64 KB`, closed rings, and `±180°` antimeridian crossings) or declares manual hectares (`USER_DECLARED_NOT_SURVEYED`).
3. **Stage 2 — Inspect M4 Source Coverage (`/explore` & `/farm/[id]/coverage`):**
   - Visitor sees per-capability M4 status badges (`AVAILABLE`, `CONDITIONAL`, `INSUFFICIENT_EVIDENCE`, `OUT_OF_COVERAGE`, `TEMPORARILY_UNAVAILABLE`) and expands *"Why is this conditional / unavailable?"*.
4. **Stage 3 — Guided 5-Step Farm Setup (`/farm/new`):**
   - Visitor configures fields, irrigation access (`YES` / `NO` / `UNKNOWN`), and soil/water parameters. Unknown mineral nitrogen (`NO3-N / NH4-N`) remains explicitly `null`.
5. **Stage 4 — Select M14 Research Preference (`/farm/[id]/analysis`):**
   - Visitor selects `STRICT_ALL_SCENARIOS_SERVICE`, `MINIMIZE_WORST_ET_SHORTFALL`, `MINIMAX_REGRET`, or `PARETO_FRONTIER`.
6. **Stage 5 — Understand the Outcome (`/farm/[id]/results`, `/plans`, `/climate`, `/decisions`):**
   - Primary abstention statement is displayed first (`0 / 16` pass all 9 states; `FIELD_RECOMMENDATION_ELIGIBILITY: BLOCKED`).
   - Visitor compares conditional benchmarks (`a27063ce2eca13f02e03` vs `fa0e548ed3a7ccbcad4e`), inspects the 5-year field × year matrix, and explores 2018/2006/2012 weather analogues.
7. **Stage 6 — Inspect Provenance & Export (`/farm/[id]/evidence` & `/farm/[id]/reports`):**
   - Visitor opens the Scientific Provenance Drawer from any metric and exports watermarked JSON/CSV or prints the neutral-light HTML research dossier.

---

## 2. Failure & Adversarial Journeys (No Dead Ends)

- **Selected Region Outside Calibrated Crop Domain (e.g., Nyeri Kenya or Wagga Wagga Australia):**
  - Displays M4 Earth observation coverage honestly while marking crop optimization `OUT_OF_COVERAGE` / `MODEL_UNQUALIFIED`. Offers direct buttons to review regional Earth context or switch to the recorded Uppsala M14 demo.
- **Marine or Polar Coordinate (North Atlantic Ocean / Svalbard 78.22°N):**
  - Displays `OUT_OF_COVERAGE` with land-mask / high-latitude frozen-surface explanation.
- **Corrupt or Invalid GeoJSON Import:**
  - Displays exact ring closure, coordinate range (`[-180, 180]`, `[-90, 90]`), or vertex limit error messages without losing form state.
- **WebGL Disabled or Headless Environment without GPU:**
  - Automatically renders the interactive 2D equirectangular SVG coordinate/polygon selector so all workflows remain 100% functional.
