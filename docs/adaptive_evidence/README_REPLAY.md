# ASTRAGRON Adaptive Evidence Engine — Clean-Room Replay Instructions

## Prerequisites
- Clean extraction of the base source repository (`ASTRAGRON_GEMINI_SOURCE_WITH_GLOBAL_EVIDENCE_PROMPT.zip`, commit `03be95432d6ee5b83f80b2e98b9575484b927025`).
- Python 3.13+ (tested on Python 3.13.1). Third-party runtime dependencies are pinned in `docs/adaptive_evidence/requirements.lock`.
- Optional: unzip/tar and `pip` in an isolated virtual environment (no global site-packages modification).

## 1. Extract the Review Overlay
Unzip `ASTRAGRON_ADAPTIVE_EVIDENCE_FINAL_UPGRADE_REVIEW.zip` onto the freshly extracted base repository root so these directories are populated:
- `adaptive_evidence/**`
- `tests/adaptive_evidence/**`
- `examples/adaptive_evidence/**`
- `docs/adaptive_evidence/**`

Verify no protected baseline files (`brain/`, `contracts/`, `water_core/`, `tests/engine/`, `examples/engine/`, root `LICENSE`) were altered or added.

## 2. Create Virtual Environment & Install Pinned Dependencies

### Windows (PowerShell)
```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r docs\adaptive_evidence\requirements.lock
```

### Linux / macOS (Bash)
```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -r docs/adaptive_evidence/requirements.lock
```

## 3. Execute Offline Deterministic Verification (Network Disabled)

### Windows (PowerShell)
```powershell
$env:ASTRAGRON_OFFLINE_ONLY = "1"
.\.venv\Scripts\python.exe -B -X utf8 -m unittest discover -s tests/adaptive_evidence -v
.\.venv\Scripts\python.exe -B -X utf8 -m unittest tests/engine/test_client_api.py -v
.\.venv\Scripts\python.exe -B -X utf8 -m adaptive_evidence.license_gate
.\.venv\Scripts\python.exe -B -X utf8 -m adaptive_evidence.verification_g6 --offline-audit
.\.venv\Scripts\python.exe -B -X utf8 -c "import json; from adaptive_evidence.inventory import verify_upstream_integrity; r=verify_upstream_integrity(); print(json.dumps({'passed':r['passed'],'protected':r['protected_baseline_files_verified'],'growth':r['growth_input_files_verified'],'altered':r['pre_existing_files_altered']}, indent=2)); assert r['passed'] and not r['pre_existing_files_altered']"
```

### Linux / macOS (Bash)
```bash
export ASTRAGRON_OFFLINE_ONLY=1
./.venv/bin/python -B -X utf8 -m unittest discover -s tests/adaptive_evidence -v
./.venv/bin/python -B -X utf8 -m unittest tests/engine/test_client_api.py -v
./.venv/bin/python -B -X utf8 -m adaptive_evidence.license_gate
./.venv/bin/python -B -X utf8 -m adaptive_evidence.verification_g6 --offline-audit
./.venv/bin/python -B -X utf8 -c "import json; from adaptive_evidence.inventory import verify_upstream_integrity; r=verify_upstream_integrity(); print(json.dumps({'passed':r['passed'],'protected':r['protected_baseline_files_verified'],'growth':r['growth_input_files_verified'],'altered':r['pre_existing_files_altered']}, indent=2)); assert r['passed'] and not r['pre_existing_files_altered']"
```

## 4. Optional Live Network Retrieval Verification (Internet Required)
Live provider calls are **opt-in** (`acquisition="FETCH_ALLOWED"` / `--live`) and are blocked automatically whenever `ASTRAGRON_OFFLINE_ONLY=1` is set:
```powershell
Remove-Item Env:ASTRAGRON_OFFLINE_ONLY -ErrorAction SilentlyContinue
.\.venv\Scripts\python.exe -B -X utf8 -m adaptive_evidence.verification_g6 --live
```
Note: Uncached live GeoTIFFs fetched during `--live` remain in an ephemeral temporary cache during the run and are not bundled into the review archive. Pre-bundled Natural Earth 10m public-domain vectors and verified cached NASA POWER / SoilGrids JSON receipts support offline replay of cached test suites without live internet access.
