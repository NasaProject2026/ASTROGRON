# ASTRAGRON Unified System — Ship-Readiness Report (`SHIP_READINESS.md`)

**Date:** `2026-11-14`  
**Branch:** `feature/global-adaptive-evidence`  
**Schema:** `astragron.unified-decision.response.v1` / `astragron.adaptive-evidence.v1`

---

## 1. Required Ship-Readiness Flags

```text
LOCAL_APP_RUNS: PASS
LIVE_GLOBAL_NASA_FETCH_VERIFIED: PASS
OFFLINE_CACHE_REPLAY_VERIFIED: PASS
GEOMETRY_GATES_PASS: PASS
ADAPTIVE_PARTIAL_RESULTS_PASS: PASS
REAL_5Y_RESEARCH_CASES_PASS: PASS
ENGLISH_UI_REPORT_E2E_PASS: PASS
SOURCE_LICENSE_AUDIT_PASS: PASS
OWNER_LICENSE_AUTHORIZED: BLOCKED
PUBLIC_DEPLOYMENT_VERIFIED: NOT_APPLICABLE
```

---

## 2. Gate-by-Gate Verification Summary (Gates I–VII)

| Gate | Scope | Status | Verification Evidence |
|---|---|---|---|
| **Gate I — Source & Integration** | Baseline locks (`301` + `59` protected files), clean receipt verification, unified wiring | **PASS** | `docs/adaptive_evidence/FINAL_BASELINE_AND_OWNERSHIP.json` (`0` mismatches across `360` locked upstream files) |
| **Gate II — Geography & Security** | Berlin polygon + Heilbronn point (`spatial_mismatch`), malformed GeoJSON (`['oops', 49.14]`, booleans, `NaN`/`Inf`, unclosed rings), `MultiPolygon`, antimeridian, islands, lakes, coast, polar, ocean `[0, 0]` | **PASS** | `tests/adaptive_evidence/test_ship_now_gates.py` + `tests/adaptive_evidence/test_g1_g5_comprehensive.py` (`100%` pass, zero false land promotions, zero C2/C3 assignment on spatial mismatch) |
| **Gate III — Worldwide Acquisition (12 Sites)** | Live official NASA POWER daily API fetch + SHA-256 receipt caching & offline replay across 12 global locations on 6 continents (`Sweden`, `Kenya`, `Australia`, `Germany`, `Brazil`, `Argentina`, `India`, `Japan`, `Indonesia`, `Egypt`, `USA`, `South Africa`) | **PASS** | `examples/adaptive_evidence/gate3_12site_worldwide_matrix.json` (`8` live-fetched & cached NASA POWER receipts + `4` upstream pinned receipts; `11` SoilGrids v2.0 250 m WCS receipts; `3` true 5-year research plans; `8` regional screenings; `1` climate-ready/soil-blocked partial) |
| **Gate IV — Actual Decision** | `3` complete 5-year research examples (`Sweden`, `Kenya`, `Australia`) + partial/blocked locations (`Japan`, `Germany` uncalibrated crop) | **PASS** | `examples/adaptive_evidence/gate4_five_year_and_partial_cases.json` (`field_validated=false`, `marketable_yield=null`, `profit=null` across all runs) |
| **Gate V — Runnable Local App & English Report** | Local HTTP server (`adaptive_evidence.unified_server`), one-command launcher (`START_ASTRAGRON_UNIFIED.ps1`), 6 distinct status outcomes, printable English HTML/CSV/JSON report exports | **PASS** | `test_gate5_unified_http_server_and_6_status_outcomes_e2e` (`GET /research`, `GET /unified`, `POST /api/v1/adaptive-evidence`, `GET /api/v1/adaptive-evidence/results/<sha256>.(html|json|csv)`) |
| **Gate VI — Open-Source Rights** | NASA Space Apps 2026 compliance audit, third-party notices, per-layer GAEZ gates, root license authorization check | **PASS** (`OWNER_LICENSE_AUTHORIZED: BLOCKED`) | `docs/adaptive_evidence/OPEN_SOURCE_LICENSE_AND_PROVENANCE_REGISTER.json` + `docs/adaptive_evidence/THIRD_PARTY_NOTICES.md` (Root `LICENSE` remains `PENDING_OWNER_AUTHORIZATION`) |
| **Gate VII — Regression & Reproducibility** | All adaptive tests (`64/64`), upstream client API tests (`37/37`), clean temporary directory extraction & replay | **PASS** | `docs/adaptive_evidence/G6_TEST_EXECUTION_SUMMARY.json` + `README_REPLAY.md` |
| **Gate VIII — Unified Routing, Spatial Coherence & Live UI** | Single-run `ClientDecisionService` routing, nested location/CRS/Polygon coherence (`INVALID_LOCATION_OR_GEOMETRY` fail-closed), live `FETCH_ALLOWED` (3-dp NASA POWER & UTC SoilGrids, `SOIL_READY_CLIMATE_PARTIAL`), interactive English `/unified` UI (Chromium E2E PASS; Gemini V5 & Codex B customer PDF renderer absent in repo) | **PASS** | `tests/adaptive_evidence/test_unified_acceptance_regressions.py` + `adaptive_evidence/web_unified/` |

---

## 3. One-Command Local Launch & Verification

```powershell
# 1. Verify all 64 adaptive & unified system tests + 37 upstream v1 API tests:
.\.venv\Scripts\python.exe -B -X utf8 -m unittest discover -s tests/adaptive_evidence -v
.\.venv\Scripts\python.exe -B -X utf8 -m unittest tests/engine/test_client_api.py -v

# 2. Launch the unified local HTTP server & English UI:
powershell -ExecutionPolicy Bypass -File docs\adaptive_evidence\START_ASTRAGRON_UNIFIED.ps1 -Port 8080
```
