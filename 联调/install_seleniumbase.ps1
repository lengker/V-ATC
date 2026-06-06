# Install SeleniumBase for LiveATC historical download (use python -m pip, not bare pip)
$ErrorActionPreference = "Stop"
Write-Host "Installing seleniumbase..." -ForegroundColor Cyan
python -m pip install seleniumbase --upgrade-strategy only-if-needed
Write-Host "Installing uc_driver (undetected Chrome, required for Cloudflare)..." -ForegroundColor Cyan
python -m seleniumbase install uc_driver
Write-Host "Installing chromedriver (optional fallback)..." -ForegroundColor Cyan
python -m seleniumbase install chromedriver
python -c "import seleniumbase; print('seleniumbase OK:', seleniumbase.__version__)"
Write-Host "[DONE] Restart A2 and retry historical download." -ForegroundColor Green
