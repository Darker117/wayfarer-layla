$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $env:LOCALAPPDATA 'WayfarerVideo'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
if ([int]((& $nodePath --version).TrimStart('v').Split('.')[0]) -lt 22) { throw 'Wayfarer PC Companion needs Node.js 22 or newer.' }
$pythonPath = if ($env:WAYFARER_MCP_PYTHON) { $env:WAYFARER_MCP_PYTHON } else { Join-Path $env:LOCALAPPDATA 'comfy-mcp-tools\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Set WAYFARER_MCP_PYTHON to a Python environment with comfy-mcp and mcp installed.' }
foreach ($binary in @($(if ($env:WAYFARER_FFMPEG) { $env:WAYFARER_FFMPEG } else { 'ffmpeg.exe' }), $(if ($env:WAYFARER_FFPROBE) { $env:WAYFARER_FFPROBE } else { 'ffprobe.exe' }))) { Get-Command $binary -ErrorAction Stop | Out-Null }
if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'Port 8787 already has a service. Check the existing Wayfarer gateway before starting another.'
    exit 0
}
$serverPath = Join-Path $PSScriptRoot 'server.mjs'
$process = Start-Process -FilePath $nodePath -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'gateway.log') -RedirectStandardError (Join-Path $stateDir 'gateway-errors.log') -PassThru
Set-Content -LiteralPath (Join-Path $stateDir 'gateway.pid') -Value $process.Id
for ($attempt=0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) { throw 'Gateway exited. See WayfarerVideo\gateway-errors.log in LocalAppData.' }
    if (Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue) { break }
    Start-Sleep -Milliseconds 200
}
Write-Host 'Wayfarer PC Companion started. Open http://127.0.0.1:8788 to manage your connection codes.'
Write-Host 'API is loopback-only on port 8787. Use private Tailscale Serve for phone access.'
