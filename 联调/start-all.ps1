# Start A5(8000) + A2(8001) + A3(9002) + Front(3000) + A1 collector
# Usage: cd 联调; .\start-all.ps1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$QtRoot = Split-Path -Parent $Root

function Stop-Port($port) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

Stop-Port 8000
Stop-Port 8001
Stop-Port 9002
Stop-Port 3000
Start-Sleep -Seconds 1

$AsrVenv = Join-Path $Root ".asr-venv\Scripts\python.exe"
if (-not (Test-Path $AsrVenv)) {
    Write-Host "ASR venv not found - running setup_asr_venv.ps1 (one-time) ..."
    & (Join-Path $Root "setup_asr_venv.ps1")
}

Write-Host "Starting A5 on :8000 ..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$QtRoot\backend'; python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
) | Out-Null

Write-Host "Starting A2 on :8001 ..."
$A2Dir = Join-Path $Root "ATC-VA-A2"
if (-not (Test-Path (Join-Path $A2Dir ".env")) -and (Test-Path (Join-Path $A2Dir ".env.example"))) {
    Copy-Item (Join-Path $A2Dir ".env.example") (Join-Path $A2Dir ".env")
}
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$A2Dir'; `$env:APP_PORT='8001'; `$env:APP_HOST='127.0.0.1'; if (Test-Path .env) { Get-Content .env | ForEach-Object { if (`$_ -match '^\s*([^#][^=]+)=(.*)$') { Set-Item -Path env:(`$matches[1].Trim()) -Value `$matches[2].Trim() } } }; python run.py"
) | Out-Null

Write-Host "Starting A3 on :9002 (first start may be slow) ..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Root\a3_speech_processing_6'; `$env:DATABASE_URL='sqlite:///$($QtRoot -replace '\\','/')/backend/data.sqlite3'; `$env:ASR_BACKEND='faster_whisper'; `$env:WHISPER_MODEL='tiny'; python -m uvicorn app.main:app --host 127.0.0.1 --port 9002"
) | Out-Null

Write-Host "Starting A1 live ADSB collector ..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Root'; python a1_live_collector.py"
) | Out-Null

Write-Host "Starting front on :3000 (webpack dev, stable on Windows) ..."
$FrontNext = Join-Path $QtRoot "front\.next"
if (Test-Path $FrontNext) {
    Write-Host "Cleaning front\.next ..."
    Remove-Item -Recurse -Force $FrontNext -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$QtRoot\front'; npm run dev"
) | Out-Null

Write-Host ""
Write-Host "Done. Wait ~15s then run: .\health-check.ps1"
Write-Host "Open browser: http://localhost:3000"
Write-Host "Sync audio:  python sync_a2_to_a5.py"
Write-Host "A1 collector: keep ONE window only; if OpenSky rate limit, wait 3-5 min"
