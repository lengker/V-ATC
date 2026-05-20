# 启动 A5(8000) + A2(8001) + A3(9002) + 前端(3000)
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

Write-Host "Starting A5 on :8000 ..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$QtRoot\backend'; python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
) | Out-Null

Write-Host "Starting A2 on :8001 ..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Root\ATC-VA-A2'; python run.py"
) | Out-Null

Write-Host "Starting A3 on :9002 (first start may load ONNX, slow) ..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$Root\a3_speech_processing_6'; `$env:DATABASE_URL='sqlite:///$($QtRoot -replace '\\','/')/backend/data.sqlite3'; python -m uvicorn app.main:app --host 127.0.0.1 --port 9002"
) | Out-Null

Write-Host "Starting front on :3000 ..."
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$QtRoot\front'; npm run dev"
) | Out-Null

Write-Host ""
Write-Host "等待约 15 秒后运行: .\health-check.ps1"
Write-Host "数据同步: python sync_a2_to_a5.py"
Write-Host "航迹示例: python seed_a1_tracks_to_a5.py"
