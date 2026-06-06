# LiveATC archive 鼠标点击批量下载
# 用法:
#   .\run_liveatc_archive_clicker.ps1 -Calibrate
#   .\run_liveatc_archive_clicker.ps1 -Start "2026-06-03T00:00:00Z" -End "2026-06-03T01:30:00Z" -Import

param(
    [switch]$Calibrate,
    [string]$Start = "",
    [string]$End = "",
    [switch]$Import,
    [switch]$OpenUrl,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

python -c "import pyautogui" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing pyautogui..." -ForegroundColor Yellow
    pip install pyautogui
}

$argsList = @()
if ($Calibrate) {
    $argsList += "--calibrate"
} else {
    if (-not $Start -or -not $End) {
        Write-Host "Usage:" -ForegroundColor Cyan
        Write-Host "  .\run_liveatc_archive_clicker.ps1 -Calibrate"
        Write-Host "  .\run_liveatc_archive_clicker.ps1 -Start 2026-06-03T00:00:00Z -End 2026-06-03T01:30:00Z [-Import] [-OpenUrl]"
        exit 1
    }
    $argsList += @("--start", $Start, "--end", $End)
    if ($Import) { $argsList += "--import-after" }
    if ($OpenUrl) { $argsList += "--open-url" }
    if ($DryRun) { $argsList += "--dry-run" }
}

Push-Location $Root
python liveatc_archive_clicker.py @argsList
Pop-Location
