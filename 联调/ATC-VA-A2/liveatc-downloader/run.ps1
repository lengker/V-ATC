# VHHH Downloader Quick Start (PowerShell)
# 
# This script activates the .venv virtual environment and runs the downloader
# 
# Usage:
#   .\vhhh_quick_start.ps1

param()

# Get paths
$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scriptDir = Join-Path $projectRoot "liveatc-downloader"
$venvPath = Join-Path $projectRoot ".venv"
$pythonExe = Join-Path (Join-Path $venvPath "Scripts") "python.exe"

# Check virtual environment
if (-not (Test-Path $pythonExe)) {
    Write-Host "[ERROR] Virtual environment not found" -ForegroundColor Red
    Write-Host "Create it with: python -m venv .venv" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "[INFO] Using Python from: $pythonExe" -ForegroundColor Green
Write-Host ""

# Run the downloader
Push-Location $scriptDir
& $pythonExe vhhh_multimethod_download.py @args
$exitCode = $LASTEXITCODE
Pop-Location

exit $exitCode
