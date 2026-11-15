# ASTROGRON â€” teammate Windows handoff

**Frozen version:** `astrogron-competition-2026.11.15+95a19217e4ce`  
**Git checkpoint tag:** `competition-release-20261115-handoff`  
**Deadline:** 15 November 2026, 15:45 Europe/Berlin (CET).

This transfers the existing verified A+B+C+D + original V7 app, with Adaptive disabled. No scientific output, provenance or protected file was changed. The existing demo on the original laptop is left running. Your laptop is **not** claimed tested until you run the smoke below successfully.

## 1. What to copy

P0: copy `ASTROGRON_TEAM_HANDOFF_20261115.zip` and its `.sha256.txt` privately. It expands to `ASTROGRON_TEAM_HANDOFF/app/` plus this guide. It includes the frozen operational source and bundled CORE dependency assets, not installed environments or credentials.

Keep the original immutable baseline too:

```text
ASTROGRON_COMPETITION_RELEASE_20261115_95a19217e4ce.zip
SHA256 95a19217e4ce7abb75823f2d3b415e645e06ba90369b38a35ec7acaaad5ebe9e
```

Optional PRIVATE transfer: the separately listed `COMPETITION_PRIVATE_STATE_*.zip`, accompanied by its SHA-256. Do not put private state in GitHub or a public archive. The small Git bundle is for development, not a replacement for the operational handoff; see `GIT_TEAM_WORKFLOW.md`.

Verify the ZIP using `Get-FileHash -Algorithm SHA256 -LiteralPath .\ASTROGRON_TEAM_HANDOFF_20261115.zip` and compare with `DELIVERY_SHA256SUMS.txt`. Extract into a short writable path, for example `C:\ASTROGRON_TEAM`; avoid OneDrive/network locations and long nested folders. No original-laptop absolute path is required.

## 2. Install Windows x64 prerequisites

Use **standard CPython 3.14.3 x64**, **Node.js 24.14.1 x64**, Microsoft Edge, and cloudflared. Do not substitute the newest Python/Node version for this competition build. PowerShell 5.1 or 7 is supported. Reference environment: Edge 158.0.4370.16 and cloudflared 2026.5.2; Edge is a separately installed/updating browser, not a bundled executable.

Official sources: [Python 3.14.3](https://www.python.org/downloads/release/python-3143/), [Node 24.14.1](https://nodejs.org/dist/v24.14.1/), [Microsoft Edge](https://www.microsoft.com/edge/download), [cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/).

Example installer commands (execute on the teammate laptop; administrative permission may be needed for the Node MSI):

```powershell
New-Item -ItemType Directory -Path "$env:TEMP\astrogron-install" -Force | Out-Null
Invoke-WebRequest https://www.python.org/ftp/python/3.14.3/python-3.14.3-amd64.exe -OutFile "$env:TEMP\astrogron-install\python.exe"
Start-Process -FilePath "$env:TEMP\astrogron-install\python.exe" -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1 Include_test=0' -Wait -WindowStyle Hidden
Invoke-WebRequest https://nodejs.org/dist/v24.14.1/node-v24.14.1-x64.msi -OutFile "$env:TEMP\astrogron-install\node.msi"
Start-Process msiexec.exe -ArgumentList "/i `"$env:TEMP\astrogron-install\node.msi`" /qn" -Wait -WindowStyle Hidden
```

Install Edge from its official installer if absent. For cloudflared, either use the official Windows download or this pinned, official-project binary:

```powershell
New-Item -ItemType Directory -Path "$env:LOCALAPPDATA\ASTROGRON-tools" -Force | Out-Null
Invoke-WebRequest https://github.com/cloudflare/cloudflared/releases/download/2026.5.2/cloudflared-windows-amd64.exe -OutFile "$env:LOCALAPPDATA\ASTROGRON-tools\cloudflared.exe"
$env:Path = "$env:LOCALAPPDATA\ASTROGRON-tools;$env:Path"
cloudflared --version
```

Keep that PATH assignment in the tunnel console, or add this tools directory to the user's PATH using normal Windows settings. Reopen PowerShell after installing Python/Node, then verify:

```powershell
python --version  # Python 3.14.3
node --version    # v24.14.1
npm.cmd --version
Get-Command python,node,cloudflared
```

If `python` opens the Microsoft Store or points to another version, correct PATH/use the actual 3.14.3 installation before proceeding. Downloaded installers/binaries remain external prerequisites under their respective licenses; they are not inside the handoff.

## 3. Verify source and reconstruct dependencies

Open PowerShell in the extracted **app** directory (the one containing `START_UNIFIED.ps1`):

```powershell
python handoff\VERIFY_HANDOFF.py
powershell -NoProfile -ExecutionPolicy Bypass -File .\START_UNIFIED.ps1 -PrepareOnly
```

The verifier checks 1,427 frozen release manifest entries and all 835 CORE files. CORE includes 301 protected science files and 59 growth pins. The launcher recreates `.venv`, installs the 36 bundled hash-pinned Python distributions without a package index, extracts bundled Playwright tooling, runs package-local preflight, installs frontend dependencies with `npm ci` and builds Next.js. It calculates paths for **this extraction**. Do not copy `.venv`, `node_modules`, `.next*`, `runtime/LOCAL_RUNTIME.json`, or credentials from the original laptop.

First frontend installation/build needs Internet access to npm and Google Fonts; it is source-complete, not a fully offline npm/runtime installer. No paid cloud service or LLM key is required. Next may regenerate `frontend/next-env.d.ts` / `tsconfig.json` for its build directory; this does not alter CORE science. After preparation use `python handoff\VERIFY_HANDOFF.py --after-startup`.

## 4. Optional: restore private analyses BEFORE first normal launch

Skip this section for a clean demo: D automatically seeds the accepted cached research and blocked fixtures. To transfer historical durable analyses, follow `PRIVATE_STATE_RESTORE.md` **before** normal launch. Use only a fresh, stopped extraction. Restore no credential or old runtime-environment files. The helper refuses to overwrite an existing/live store. New credentials will be generated locally.

## 5. Start and smoke locally

Console 1, in `app`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\START_UNIFIED.ps1
```

Keep it open. It serves the complete V7 app at `http://127.0.0.1:3000/`, explorer at `/explore`, and scientific login/workspace at `/research`. D listens only on loopback port 8790. The new private frontend code is in `runtime/frontend-access.txt`; the new D bearer is in `core/runtime/integration/release-demo/operator-access.txt`. Never send the D bearer to a browser or commit either file.

Console 2, same directory, **short cached-only smoke**:

```powershell
core\.venv\Scripts\python.exe -B -X utf8 handoff\SMOKE_HANDOFF.py
```

It checks the homepage, `/explore`, `/research`, authentication, cached NASA-backed analysis, two Pareto alternatives/no winner, PDF, queue DTO and same-analysis cited offline chat. It submits **zero scientific jobs** and makes **zero hosted LLM calls**. Inspect `runtime/HANDOFF_SMOKE.json`. Also open the pages in the browser and verify the original hero/globe visually. Existing full test receipts are retained; do not rerun heavy native simulations for handoff.

## 6. Start a NEW HTTPS Quick Tunnel

Console 3, same directory (ensure cloudflared is on PATH):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\START_QUICK_TUNNEL.ps1
```

The script checks authentication gates first, then exposes **only Next.js port 3000**, never D/metrics/admin ports. Read the new URL in `runtime/tunnel/public-origin.txt`. Log in there using the teammate laptop's new frontend code. Optional HTTPS smoke:

```powershell
$newUrl=(Get-Content runtime\tunnel\public-origin.txt -Raw).Trim()
core\.venv\Scripts\python.exe -B -X utf8 handoff\SMOKE_HANDOFF.py --base $newUrl
```

Every new Quick Tunnel creates a **different temporary URL**. Do not reuse URLs recorded in old receipts. Keep the laptop awake and both services/tunnel running. Quick Tunnels can expire after network loss; use `START_QUICK_TUNNEL.ps1 -Stop` then start again and share the newly printed URL. No named tunnel, permanent hostname, account purchase, Cloud VM or migration is included. [Cloudflare Quick Tunnel behavior](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Do not stop the original laptop's working demo until the teammate confirms local and HTTPS smoke success. No automatic remote-laptop success is asserted here.

## 7. Troubleshooting

| Symptom | Action |
|---|---|
| Python/Node version mismatch | Fix PATH to 3.14.3 / 24.14.1; do not relax the scientific version guard. |
| Dependencies missing after interrupted prep | Rerun the same `-PrepareOnly`; inspect `core/runtime/verification/PREFLIGHT.json`. Rebuild only local generated environments if necessary, never scientific inputs. |
| npm/font network failure | Restore network access to npm/Google Fonts and rerun preparation. No `npm update`, lockfile regeneration or paid service is needed. |
| Source/protected hash mismatch | Stop using that extraction; re-extract the verified archive. Never edit hashes to hide a difference. |
| Ports already used | Stop only your own duplicate launch, or use `-FrontendPort 3300 -BackendPort 8890` and `START_QUICK_TUNNEL.ps1 -FrontendPort 3300`; smoke with `--base http://127.0.0.1:3300`. |
| Research asks for login / 401 | Read the code generated on THIS laptop. Old browser cookies and old codes are not required. |
| Legacy shared-store API says disabled | Expected. Draft farms stay in browser storage; canonical science uses `/research`. |
| PDF/Edge failure | Confirm normal installed Edge exists under Program Files, use a short local path, inspect `runtime/backend.stderr.log`; retain original report/provenance. |
| Queue says Estimating | Expected on a new host until sufficient real observations exist; this estimates START, not completion. |
| Public URL fails but local pages pass | Inspect `runtime/tunnel/cloudflared.stderr.log`; recreate only the expired tunnel and use its new URL. |

Adaptive remains OFF because its upstream lock gate failed. Chat uses the cited deterministic fallback; current live Gemini is unverified. Results are conditional research, not field-qualified recommendations, marketable yield, profit or a scientific/economic winner.

## Acceptance checklist

The exact packaging/startup results are recorded in `HANDOFF_ACCEPTANCE.json`.

- **PASS:** immutable competition ZIP and SHA-256 retained; all source/protected scientific hashes checked.
- **PASS:** source-level operational archive and pinned CORE dependency assets present; new credentials excluded from transfer.
- **PASS:** original test receipts reused; no expensive science rerun or new feature work.
- **PASS:** separate private state checkpoint verified idle and hash-valid; restore helper excludes credentials and refuses overwrite.
- **PASS/PARTIAL:** fresh extraction reconstruction/local cached smoke results are in the acceptance receipt; they test another folder on the original Windows machine, not the teammate laptop.
- **PASS:** new private Git working tree/main/tag/bundle prepared, with withheld asset inventory and no public remote.
- **BLOCKED / NOT RUN:** creating GitHub repository/invites: no teammate identifiers and no authenticated `gh` available. Exact commands are supplied.
- **PENDING:** actual teammate laptop installation, local/HTTPS smoke and independent-device confirmation before switching demonstrations.
