param(
    [string]$BindHost = "127.0.0.1",
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $RepoRoot "adaptive_evidence\unified_server.py"))) {
    $RepoRoot = $PSScriptRoot
}

Set-Location $RepoRoot
$PythonExe = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = "python"
}

Write-Host "Starting ASTROGRON Unified Local Server on http://${BindHost}:${Port} ..."
& $PythonExe -B -X utf8 -m adaptive_evidence.unified_server --host $BindHost --port $Port
