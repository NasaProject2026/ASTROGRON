param([int]$FrontendPort=3000,[switch]$Stop)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$tunnelPath=Join-Path $PSScriptRoot 'runtime\tunnel'
$processFile=Join-Path $tunnelPath 'process.json'
if ($Stop) {
  if (Test-Path -LiteralPath $processFile) {
    $record=Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
    $running=Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if ($running -and $running.ProcessName -eq 'cloudflared' -and [Math]::Abs(($running.StartTime.ToUniversalTime()-([DateTime]$record.start_utc).ToUniversalTime()).TotalSeconds) -lt 2) {
      Stop-Process -Id $running.Id -Force
      Write-Output 'Stopped this release Quick Tunnel.'
    }
  }
  if (Test-Path -LiteralPath (Join-Path $tunnelPath 'public-origin.txt')) {
    '' | Set-Content -LiteralPath (Join-Path $tunnelPath 'public-origin.txt') -Encoding ascii -NoNewline
  }
  exit 0
}
if ($FrontendPort -lt 1024 -or $FrontendPort -gt 65535) { throw 'Choose a local frontend port from 1024 to 65535.' }
if (Test-Path -LiteralPath $processFile) {
  $record=Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
  $running=Get-Process -Id $record.pid -ErrorAction SilentlyContinue
  if ($running -and $running.ProcessName -eq 'cloudflared' -and [Math]::Abs(($running.StartTime.ToUniversalTime()-([DateTime]$record.start_utc).ToUniversalTime()).TotalSeconds) -lt 2) {
    throw 'This release already has a running Quick Tunnel. Use -Stop before creating another.'
  }
}
$binary=Get-Command cloudflared.exe -ErrorAction Stop
$frontendReady=$false
for ($attempt=0; $attempt -lt 40; $attempt++) {
  try {
    $response=Invoke-WebRequest -Uri "http://127.0.0.1:$FrontendPort/research" -UseBasicParsing -TimeoutSec 2
    if ([int]$response.StatusCode -eq 200) { $frontendReady=$true; break }
  } catch { }
  Start-Sleep -Milliseconds 500
}
if (!$frontendReady) { throw 'The unified frontend is not ready on loopback.' }
# Refuse to expose an earlier frontend build without the global API access gate.
foreach ($endpoint in @('api/core/catalog','api/farms','api/capabilities')) {
  $status=0
  try { $response=Invoke-WebRequest -Uri "http://127.0.0.1:$FrontendPort/$endpoint" -UseBasicParsing -TimeoutSec 5; $status=[int]$response.StatusCode }
  catch { if ($_.Exception.Response) { $status=[int]$_.Exception.Response.StatusCode } }
  if ($status -ne 401) { throw "Authentication gate failed for $endpoint (HTTP $status). Start the current unified build first." }
}
New-Item -ItemType Directory -Path $tunnelPath -Force | Out-Null
$outFile=Join-Path $tunnelPath 'cloudflared.stdout.log'
$errFile=Join-Path $tunnelPath 'cloudflared.stderr.log'
$arguments=@('tunnel','--url',"http://127.0.0.1:$FrontendPort",'--http-host-header',"127.0.0.1:$FrontendPort",'--protocol','http2','--no-autoupdate','--metrics','127.0.0.1:20191')
$process=Start-Process -FilePath $binary.Source -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
@{pid=$process.Id;start_utc=$process.StartTime.ToUniversalTime().ToString('o');frontend_port=$FrontendPort;backend_exposed=$false} | ConvertTo-Json | Set-Content -LiteralPath $processFile -Encoding ascii
$publicOrigin=$null
for ($attempt=0; $attempt -lt 80; $attempt++) {
  if ($process.HasExited) { throw 'Quick Tunnel exited. Inspect runtime/tunnel/cloudflared.stderr.log.' }
  $logText=''
  foreach ($file in @($outFile,$errFile)) { if (Test-Path -LiteralPath $file) { $logText += Get-Content -LiteralPath $file -Raw } }
  $match=[regex]::Match($logText,'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($match.Success) { $publicOrigin=$match.Value; break }
  Start-Sleep -Milliseconds 500
}
if (!$publicOrigin) { Stop-Process -Id $process.Id -Force; throw 'Quick Tunnel did not produce a public URL.' }
$publicOrigin | Set-Content -LiteralPath (Join-Path $tunnelPath 'public-origin.txt') -Encoding ascii -NoNewline
Write-Output "Authenticated demonstration: $publicOrigin/research"
Write-Output 'Use the private local access code in runtime/frontend-access.txt. No backend bearer is shared.'
Write-Output 'The scientific backend and metrics remain on loopback. Stop this tunnel with START_QUICK_TUNNEL.ps1 -Stop.'
