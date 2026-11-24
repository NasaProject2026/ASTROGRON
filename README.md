# ASTROGRON — Unified Competition Release (NASA Space Apps Challenge 2026)

> **Live $0 Always-On Website (GitHub Pages — Runs 24/7 Without Any Laptop):**  
> **https://nasaproject2026.github.io/ASTROGRON/**  
> *(Static showcase exported via `npm run build:pages` and served directly from the `gh-pages` branch; includes the complete V7 Next.js UI, interactive 3D Earth Explorer, Wageningen 5-year Pareto charts, grounded Q&A, and Sample Scientific PDF — optional CI workflow template at [`frontend/scripts/github-pages-workflow.example.yml`](frontend/scripts/github-pages-workflow.example.yml).)*

**Competition Release Version:** `astrogron-competition-2026.11.15+95a19217e4ce`  
**Previous `main` Snapshot Preserved At:** branch `backup/v5-initial-fe4df14` / tag `backup-v5-fe4df14` (`fe4df14`, history preserved with zero force-pushes)

---

## 1. For NASA Judges — Immediate No-Login Walkthrough

NASA judges can evaluate ASTROGRON directly from the public URL without entering any operator access code:

1. **Original Homepage (`/`):** Explains the problem, evidence-first methodology, Earth observation layers, and links directly to **"Public scientific demo & PDF (no login)"** (`/research`) and **"Explore 3D Globe"** (`/explore`).
2. **Interactive 3D Earth Explorer (`/explore`):** Public WebGL globe (`maplibre-gl`) with regional agricultural presets, Earth observation source provenance metadata, and honest coverage/capability status disclosures.
3. **Public Read-Only Scientific Demonstration (`/research`):**
   - When connected to the local Python scientific engine, loads verified outputs via `GET /api/public-demo`; when hosted standalone at `$0` (GitHub Pages or serverless without `ASTRAGRON_BACKEND_URL`), automatically serves the same verified Wageningen 5-year snapshot (`frontend/src/data/generated/wageningen-public-snapshot.json`), static PDF report (`public/reports/ASTROGRON_Wageningen_Sample_Scientific_Report.pdf`), deterministic evidence-grounded Q&A fallback, and honest `Insufficient Regional Evidence` gating for uncalibrated coordinates.
   - Displays the **Wageningen 1 ha 5-Year Research Replay** with two Pareto management alternatives (`Alternative 1` and `Alternative 2`, explicitly showing **no single declared winner**), scenario switcher (`REFERENCE`, `HALF_RAIN`, `LOW_INITIAL_MINERAL_N`), storage dry matter vs. nitrogen leaching table, downloadable Sample Scientific PDF, and an **Honest Fail-Closed Abstention Example** (Australia / uncalibrated regions where missing local agronomic evidence blocks fabricated output).
4. **Optional Operator Authentication Guard (`ASTRAGRON_DEMO_ACCESS_FILE`):** In self-hosted private operator mode with `runtime/frontend-access.txt` configured, `/farms`, `/farm/new`, `/settings`, `/api/core/*`, `/api/farms`, `/api/analyses/*`, and raw Python `:8790` remain access-gated (`307` / `401` unauthenticated). On standalone public deployments (GitHub Pages / unconfigured Vercel), public demo farm routes remain browseable with honest standalone provenance labels.

---

## 2. Unified System Architecture

```text
Public HTTPS (Cloudflare Quick Tunnel -> 127.0.0.1:3000 ONLY)
        │
        ▼
┌────────────────────────────────────────────────────────────────┐
│ frontend/  — Original V7 Next.js 16.4.6 UI & Fail-Closed Proxy │
│  • Public Routes: /, /explore, /research (read-only demo),     │
│    /help, /methodology, /api/public-demo (PDF + cached replay) │
│  • Operator Session Routes (HttpOnly cookie + CSRF/Origin):    │
│    /farms, /farm/*, /settings, /api/core/*                     │
└───────────────────────────┬────────────────────────────────────┘
                            │ Loopback-only HTTP + Server Bearer Token
                            ▼
┌────────────────────────────────────────────────────────────────┐
│ core/ — Protected Scientific Backend (A + B + C + D, :8790)    │
│  • D (system_integration / brain): Wofost81_NWLP_MLWB_SNOMIN   │
│    (PCSE 6.0.13) + single-worker persistent job queue          │
│  • B (customer_reports): Provenance manifests & PDF synthesis  │
│  • C (assistant_brain): Offline evidence-grounded chat         │
│  • A (baseline / verification): Protected manifests & checks   │
└───────────────────────────┬────────────────────────────────────┘
                            │ DISABLED BY DEFAULT (version/compat gate)
                            ▼
┌────────────────────────────────────────────────────────────────┐
│ adaptive/ — Adaptive Evidence Sidecar (Disabled in Release)    │
│  • Preserved under Apache-2.0 source; intentionally off until  │
│    upstream 398-file compatibility review is completed.        │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. Repository Contents & Excluded Assets

This public competition repository includes:
- **`frontend/`**: Complete original V7 Next.js TypeScript application, MIT `frontend/LICENSE`, public judging routes (`app/api/public-demo/route.ts`, `proxy.ts`, `app/research/page.tsx`, `src/components/hero/cinematic-landing.tsx`), fixtures (`src/fixtures/`), and open-licensed static web assets (`public/geodata/*` CC0, `public/workers/maplibre-gl-worker.js` BSD-3-Clause, `public/orbit-ab-assets/*` NASA Public Domain / Three.js MIT / Draco Apache-2.0, `public/orbit-lab.html`, `public/favicon.ico`).
- **`core/`**: Permitted original ASTROGRON Python source (`brain/`, `assistant_brain/`, `customer_reports/`, `system_integration/`, `contracts/`, `integration/`, `standalone/`, `coordination/`, `tests/`).
- **`adaptive/`**: Permitted original Adaptive Evidence sidecar Python source (`adaptive_evidence/`, `contracts/`, `tests/`), **disabled by default**.
- **`handoff/` & Root Tools**: `START_UNIFIED.ps1`, `START_QUICK_TUNNEL.ps1`, `BACKEND_PORTABILITY.md`, `CONFIGURATION.example`, `RELEASE_VERSION.json`, `PRIVATE_BASE_EXCLUSIONS.json`, `handoff/{HYDRATE_PRIVATE_BASE,RESTORE_PRIVATE_STATE,SMOKE_HANDOFF,VERIFY_HANDOFF}.py`, `verify_public_access.py`, `verify_unified.py`.

**Intentionally Excluded Assets (Never Published to Public Git):**
- Commissioned hero/editorial artwork (`frontend/public/assets/*.jpg` — proprietary artist rights)
- Protected engine inputs, crop YAML tables, R&D pack, and integrity-sealed test isolation files (`301` protected files / `59` growth pins, bundled Python wheels incl. `pcse==6.0.13`)
- Raw cached NASA POWER / SoilGrids / Natural Earth 10m shapefile downloads (`adaptive/adaptive_evidence/data/`, `adaptive/examples/`, `adaptive/docs/`)
- `.env` credentials, access codes (`frontend-access.txt`, `operator-access.txt`), `runtime/` state, `core/.venv/`, `node_modules/`, `.next/`

See **[`EXCLUDED_ASSETS_AND_RIGHTS.md`](EXCLUDED_ASSETS_AND_RIGHTS.md)** for the full boundary ledger and **[`NASA_AND_DATA_ATTRIBUTIONS.md`](NASA_AND_DATA_ATTRIBUTIONS.md)** for all data source citations.

---

## 4. Reproducible Installation & Local Launch (Windows x64)

### Prerequisites
- **CPython 3.14.3 (x64)**
- **Node.js 24.14.1 (x64)** & **npm**
- **Microsoft Edge**
- **Git for Windows**
- **cloudflared** (optional, for temporary HTTPS Quick Tunnel demonstration)

### Full Authorized Operator Setup (With Private Operational Base Archive)
Authorized operators holding the frozen baseline archive (`ASTROGRON_COMPETITION_RELEASE_20261115_95a19217e4ce.zip`, SHA-256 `95a19217e4ce7abb75823f2d3b415e645e06ba90369b38a35ec7acaaad5ebe9e`):

```powershell
# 1. Hydrate withheld wheels, 301 protected files, and open/commissioned runtime assets
python handoff\HYDRATE_PRIVATE_BASE.py C:\path\to\ASTROGRON_COMPETITION_RELEASE_20261115_95a19217e4ce.zip

# 2. Verify release manifest and CORE integrity
python handoff\VERIFY_HANDOFF.py

# 3. Reconstruct Python .venv + Node modules + build Next.js and launch loopback services
powershell -NoProfile -ExecutionPolicy Bypass -File .\START_UNIFIED.ps1

# 4. Run smoke suite in a second terminal (uses cached replays; submits 0 live jobs)
core\.venv\Scripts\python.exe -B -X utf8 handoff\SMOKE_HANDOFF.py

# 5. (Optional) Expose Next.js ONLY via Cloudflare Quick Tunnel
powershell -NoProfile -ExecutionPolicy Bypass -File .\START_QUICK_TUNNEL.ps1
```

Full step-by-step teammate deployment instructions are in [`TEAM_HANDOFF_START_HERE.md`](TEAM_HANDOFF_START_HERE.md).

### Standalone $0 Static Showcase Build & Inspection (Public Repo)
Without the private Python operational base, reviewers can test, inspect, or export the standalone V7 Next.js website at `$0` hosting cost:

```powershell
cd frontend
npm ci
npx tsc --noEmit
npm test
npm run build        # Full Next.js server build (Vercel / Node standalone with /api/* fallbacks)
npm run build:pages  # Pure static export to frontend/out for 24/7 $0 GitHub Pages
```

*(Note: proprietary editorial JPGs under `frontend/public/assets/` are omitted from this public repo per [`EXCLUDED_ASSETS_AND_RIGHTS.md`](EXCLUDED_ASSETS_AND_RIGHTS.md); the standalone hero uses NASA Blue Marble public-domain imagery.)*

---

## 5. Scientific Status & Honest Limitations

- **Not Field-Validated Agronomic Advice:** `field_validated` is `false`, `marketable_yield` is `null`, and `profit` is `null`. Historical Wageningen 5-year research scenarios (`REFERENCE`, `HALF_RAIN`, `LOW_INITIAL_MINERAL_N`) represent deterministic model outputs under bounded assumptions — **not** field-calibrated farm prescriptions, economic winners, or legal water permits.
- **No Single Declared Winner:** Pareto policy comparison refuses to collapse agronomic trade-offs (crop storage dry matter vs. mineral N leaching) into an arbitrary single best score.
- **Adaptive Evidence Disabled:** `adaptive/` remains turned off in the unified release due to an upstream dependency alignment difference (`390/398` files match core; `6` source/contract files differ; `2` historical receipts absent). Core `A+B+C+D` remains the sole scientific authority.
- **Offline Chat Fallback:** Evidence-grounded AI chat responses use the deterministic evidence renderer bounded to cited analysis fields. Live external Gemini/Groq LLM connectivity is **not** verified or claimed.
- **Always-On $0 Public Hosting:** `https://nasaproject2026.github.io/ASTROGRON/` runs 24/7 on GitHub Pages without keeping a local laptop online by serving verified standalone scientific snapshots, downloadable reports, and regional calibration gating. Temporary Cloudflare Quick Tunnels (such as the historical competition judging URL) are only needed when exposing a live local Python solver session.

---

## 6. Licenses & Attributions

- **Web Frontend (`frontend/`):** MIT License — [`frontend/LICENSE`](frontend/LICENSE)
- **Adaptive Sidecar (`adaptive/` original code):** Apache-2.0
- **Combined Licensing Summary:** [`LICENSE`](LICENSE)
- **NASA & Geospatial Attributions:** [`NASA_AND_DATA_ATTRIBUTIONS.md`](NASA_AND_DATA_ATTRIBUTIONS.md)
- **Excluded Assets & Rights:** [`EXCLUDED_ASSETS_AND_RIGHTS.md`](EXCLUDED_ASSETS_AND_RIGHTS.md)
