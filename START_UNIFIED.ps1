param([int]$FrontendPort=3000,[int]$BackendPort=8790,[switch]$PrepareOnly,[switch]$Rebuild,[string]$RemoteBackendUrl='',[string]$RemoteBackendAllowedHost='',[string]$RemoteBackendTokenFile='',[string]$BuildDir='.next')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($FrontendPort -lt 1024 -or $FrontendPort -gt 65535 -or $BackendPort -lt 1024 -or $BackendPort -gt 65535 -or $FrontendPort -eq $BackendPort) { throw 'Choose distinct local ports from 1024 to 65535.' }
if ($BuildDir -notmatch '^\.next(?:-[A-Za-z0-9_-]+)?$') { throw 'BuildDir must be a local .next build directory.' }
$env:ASTRAGRON_NEXT_DIST_DIR=$BuildDir
$corePath=Join-Path $PSScriptRoot 'core'
$frontendPath=Join-Path $PSScriptRoot 'frontend'
$runtimePath=Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$env:PYTHONPATH=$null; $env:PYTHONHOME=$null
$env:PYTHONNOUSERSITE='1'; $env:PYTHONDONTWRITEBYTECODE='1'; $env:PYTHONUTF8='1'
Push-Location -LiteralPath $corePath
try {
  if (!(Test-Path -LiteralPath '.venv\Scripts\python.exe')) { python -I standalone/install.py }
  else { python -I standalone/install.py --preflight }
  if ($LASTEXITCODE -ne 0) { throw 'CORE bootstrap or integrity preflight failed.' }
} finally { Pop-Location }
$settings=Get-Content -LiteralPath (Join-Path $corePath 'runtime\LOCAL_RUNTIME.json') -Raw | ConvertFrom-Json
$env:ASTRAGRON_PCSE_PYTHON=$settings.python; $env:ASTRAGRON_NODE=$settings.node
$env:ASTRAGRON_NODE_MODULES=$settings.node_modules; $env:ASTRAGRON_BROWSER=$settings.browser
$env:USERPROFILE=Join-Path $corePath 'runtime\user-home'
$env:TEMP=Join-Path $corePath 'runtime\tmp'; $env:TMP=$env:TEMP
$env:ASTRAGRON_CHAT_PROVIDER='offline'; $env:ASTRAGRON_CHAT_ADVANCED_ENABLED='false'
$env:ASTRAGRON_APPROVED_PUBLIC_DEMO_CHAT_ENABLED='0'; $env:ASTRAGRON_GLOBAL_EVIDENCE_ENABLED='0'
$env:ASTRAGRON_BACKEND_PROTOCOL='D_V1'; $env:ASTRAGRON_BACKEND_URL="http://127.0.0.1:$BackendPort"
$env:ASTRAGRON_BACKEND_TOKEN_FILE=Join-Path $corePath 'runtime\integration\release-demo\operator-access.txt'
if ($RemoteBackendUrl) {
  if (!$RemoteBackendAllowedHost -or !$RemoteBackendTokenFile -or !(Test-Path -LiteralPath $RemoteBackendTokenFile)) { throw 'Remote D requires an HTTPS URL, exact allowed hostname and private server token file.' }
  $remoteUri=[Uri]$RemoteBackendUrl
  if ($remoteUri.Scheme -ne 'https' -or $remoteUri.Host -ne $RemoteBackendAllowedHost -or $remoteUri.UserInfo -or $remoteUri.AbsolutePath -ne '/' -or $remoteUri.Query -or $remoteUri.Fragment) { throw 'Invalid remote D endpoint. Use an allowlisted HTTPS service origin.' }
  $env:ASTRAGRON_BACKEND_URL=$RemoteBackendUrl
  $env:ASTRAGRON_BACKEND_ALLOWED_HOSTS=$RemoteBackendAllowedHost
  $env:ASTRAGRON_BACKEND_TOKEN_FILE=(Resolve-Path -LiteralPath $RemoteBackendTokenFile).Path
}
$env:ASTRAGRON_DEMO_ACCESS_FILE=Join-Path $runtimePath 'frontend-access.txt'
$env:ASTRAGRON_UNIFIED_STATE_DIR=Join-Path $runtimePath 'frontend-sessions'
$env:ASTRAGRON_PUBLIC_ORIGIN_FILE=Join-Path $runtimePath 'tunnel\public-origin.txt'
$env:ASTRAGRON_RUNTIME_STORE_PATH=Join-Path $runtimePath 'legacy-ui-store.json'
$env:NEXT_TELEMETRY_DISABLED='1'
@{ frontend_build_dir=$BuildDir;frontend_port=$FrontendPort;backend_url=$env:ASTRAGRON_BACKEND_URL;remote_backend=[bool]$RemoteBackendUrl } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'UNIFIED_SETTINGS.json') -Encoding utf8
if (!(Test-Path -LiteralPath $env:ASTRAGRON_DEMO_ACCESS_FILE)) {
  $accessBytes=New-Object byte[] 24
  $generator=[System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($accessBytes) } finally { $generator.Dispose() }
  [BitConverter]::ToString($accessBytes).Replace('-','').ToLowerInvariant() | Set-Content -LiteralPath $env:ASTRAGRON_DEMO_ACCESS_FILE -Encoding ascii -NoNewline
}
Push-Location -LiteralPath $frontendPath
try {
  if (!(Test-Path -LiteralPath 'node_modules\next\package.json')) {
    npm.cmd ci --ignore-scripts --no-audit --no-fund --cache .npm-cache
    if ($LASTEXITCODE -ne 0) { throw 'Locked frontend dependency installation failed.' }
  }
  if ($Rebuild -or !(Test-Path -LiteralPath (Join-Path $BuildDir 'BUILD_ID'))) {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend production build failed.' }
  }
} finally { Pop-Location }
if ($PrepareOnly) { Write-Output 'Unified local dependencies and build ready.'; exit 0 }
if ($RemoteBackendUrl) {
  Write-Output "Frontend at http://127.0.0.1:$FrontendPort/research ; remote scientific endpoint is server-configured."
  Push-Location -LiteralPath $frontendPath
  try { & $settings.node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port $FrontendPort }
  finally { Pop-Location }
  exit $LASTEXITCODE
}
# Start only the authoritative D backend. The frontend package's Python engines are inert snapshots.
$backendProcess=Start-Process -FilePath $settings.python -ArgumentList @('-B','-X','utf8','-m','system_integration.release_demo','--port',"$BackendPort") -WorkingDirectory $corePath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimePath 'backend.stdout.log') -RedirectStandardError (Join-Path $runtimePath 'backend.stderr.log')
try {
  $healthy=$false
  for ($attempt=0; $attempt -lt 60; $attempt++) {
    if ($backendProcess.HasExited) { throw 'D stopped; inspect runtime/backend.stderr.log.' }
    try { $probe=Invoke-RestMethod "$env:ASTRAGRON_BACKEND_URL/health" -TimeoutSec 2; if ($probe.status -eq 'alive') { $healthy=$true; break } } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (!$healthy) { throw 'D did not become healthy on the requested loopback port.' }
  Write-Output "Open http://127.0.0.1:$FrontendPort/research"
  Write-Output "Read the private frontend code from $env:ASTRAGRON_DEMO_ACCESS_FILE"
  Write-Output 'Keep this console open. Ctrl+C stops the local demonstration.'
  Push-Location -LiteralPath $frontendPath
  try { & $settings.node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port $FrontendPort }
  finally { Pop-Location }
} finally {
  if (!$backendProcess.HasExited) { Stop-Process -Id $backendProcess.Id -Force }
}
