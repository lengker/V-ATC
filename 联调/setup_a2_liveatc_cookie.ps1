# LiveATC Cookie setup - uses YOUR normal Edge (Cloudflare blocks all automation)
# Usage: cd 联调 ; .\setup_a2_liveatc_cookie.ps1

$ErrorActionPreference = "Stop"
$A2 = Join-Path $PSScriptRoot "ATC-VA-A2"
$CookieDir = Join-Path $A2 "liveatc-downloader\.local"
$CookieFile = Join-Path $CookieDir "liveatc_cookie.txt"
$EnvFile = Join-Path $A2 ".env"
$EnvExample = Join-Path $A2 ".env.example"
$CookieEnvLine = "A2_HTTP_COOKIE_FILE=./liveatc-downloader/.local/liveatc_cookie.txt"

function Update-EnvCookieFile {
    $lines = @(Get-Content $EnvFile -ErrorAction SilentlyContinue)
    $out = New-Object System.Collections.Generic.List[string]
    $setCookieFile = $false
    foreach ($line in $lines) {
        if ($line -match '^\s*A2_HTTP_COOKIE_FILE\s*=') {
            [void]$out.Add($CookieEnvLine)
            $setCookieFile = $true
        }
        elseif ($line -match '^\s*A2_HTTP_COOKIE\s*=' -and $line -notmatch '^\s*#') {
            [void]$out.Add("# $line")
        }
        elseif ($line -match '^\s*#\s*A2_HTTP_COOKIE_FILE=') {
            [void]$out.Add($CookieEnvLine)
            $setCookieFile = $true
        }
        else {
            [void]$out.Add($line)
        }
    }
    if (-not $setCookieFile) {
        [void]$out.Add($CookieEnvLine)
    }
    $out | Set-Content $EnvFile -Encoding utf8
}

if (-not (Test-Path $EnvFile)) {
    Copy-Item $EnvExample $EnvFile
}

New-Item -ItemType Directory -Force -Path $CookieDir | Out-Null

Write-Host ""
Write-Host "Cloudflare blocks automated browsers (Playwright/CDP)." -ForegroundColor Yellow
Write-Host "Using your NORMAL Edge - the same one that can open LiveATC." -ForegroundColor Cyan
Write-Host ""

Push-Location (Join-Path $A2 "liveatc-downloader")
python manual_cookie_setup.py $CookieFile
$exitCode = $LASTEXITCODE
Pop-Location

if ($exitCode -ne 0) {
    Write-Host "[FAIL] Cookie setup cancelled." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $CookieFile)) {
    Write-Host "[FAIL] Cookie file not created." -ForegroundColor Red
    exit 1
}

$cookieLine = (Get-Content $CookieFile -Raw).Trim()
if (-not $cookieLine) {
    Write-Host "[FAIL] Cookie file is empty." -ForegroundColor Red
    exit 1
}

Update-EnvCookieFile

Write-Host ""
Write-Host "[DONE] Cookie saved; A2 .env updated." -ForegroundColor Green
Write-Host "Restart A2, then retry historical download." -ForegroundColor Yellow
