# 修复刷新 500 / _buildManifest.js ENOENT：结束占用 3000 的进程并清 .next 后重启
$ErrorActionPreference = "Stop"
$FrontRoot = Split-Path -Parent $PSScriptRoot

Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 2

$nextDir = Join-Path $FrontRoot ".next"
if (Test-Path $nextDir) {
    Remove-Item -Recurse -Force $nextDir
    Write-Host "Removed $nextDir"
}

Set-Location $FrontRoot
Write-Host "Starting npm run dev ..."
npm run dev
