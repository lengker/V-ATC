# Manual LiveATC archive download + import (when script gets 403)
# Usage: cd 联调 ; .\manual_liveatc_import.ps1

$ErrorActionPreference = "Stop"
$A2 = Join-Path $PSScriptRoot "ATC-VA-A2"
$Downloads = Join-Path $A2 "liveatc-downloader\downloads"
$ArchiveUrl = "https://www.liveatc.net/archive.php?m=vhhh5"

New-Item -ItemType Directory -Force -Path $Downloads | Out-Null

Write-Host ""
Write-Host "=== Manual LiveATC download (browser only) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Why: cf_clearance cookie only works inside YOUR Edge, not in Python scripts."
Write-Host ""
Write-Host "Steps:"
Write-Host "  1. Edge opens the LiveATC archive page"
Write-Host "  2. Pick UTC date + time (30-min slot), click Submit"
Write-Host "  3. Save the .mp3 to this folder:"
Write-Host "     $Downloads"
Write-Host "  4. Come back here and press Enter"
Write-Host ""

Start-Process "msedge.exe" $ArchiveUrl
Read-Host "Press Enter after the mp3 is saved to downloads folder"

$mp3 = Get-ChildItem -Path $Downloads -Filter "*.mp3" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $mp3) {
    Write-Host "[FAIL] No mp3 in downloads folder." -ForegroundColor Red
    exit 1
}

Write-Host "Found: $($mp3.Name)" -ForegroundColor Green

Push-Location $PSScriptRoot
python import_liveatc_downloads_to_a2.py
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
python sync_a2_to_a5.py
$syncExit = $LASTEXITCODE
Pop-Location

if ($syncExit -ne 0) {
    Write-Host "[WARN] sync_a2_to_a5 had issues; check A2/A5 are running." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "[DONE] Imported and synced to A5. Refresh the frontend recording list." -ForegroundColor Green
