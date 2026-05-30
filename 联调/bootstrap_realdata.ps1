# 真实数据联调：A2 LiveATC 下载 -> sync A2/A3/A1 -> A5 -> 前端
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$QtRoot = Split-Path -Parent $Root
$A2Dir = Join-Path $Root "ATC-VA-A2"

function Wait-HttpOk($url, $maxSec = 90) {
    $deadline = (Get-Date).AddSeconds($maxSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch { Start-Sleep -Seconds 2 }
    }
    return $false
}

Write-Host "=== 1/5 检查 A5 :8000 ===" -ForegroundColor Cyan
if (-not (Wait-HttpOk "http://127.0.0.1:8000/health" 5)) {
    Write-Host "请先启动 A5: cd backend; python -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
    exit 1
}

Write-Host "=== 2/5 启动 A2 :8001（若未运行）===" -ForegroundColor Cyan
if (-not (Wait-HttpOk "http://127.0.0.1:8001/health" 3)) {
    if (-not (Test-Path (Join-Path $A2Dir ".env")) -and (Test-Path (Join-Path $A2Dir ".env.example"))) {
        Copy-Item (Join-Path $A2Dir ".env.example") (Join-Path $A2Dir ".env")
    }
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "Set-Location '$A2Dir'; `$env:APP_PORT='8001'; `$env:APP_HOST='127.0.0.1'; `$env:A2_AUTO_START_SCHEDULER='false'; python run.py"
    ) | Out-Null
    if (-not (Wait-HttpOk "http://127.0.0.1:8001/health" 60)) {
        Write-Host "A2 启动失败" -ForegroundColor Red
        exit 1
    }
}

Write-Host "=== 3/5 触发 LiveATC 历史下载（真实 mp3，可能需 1-3 分钟）===" -ForegroundColor Cyan
Write-Host "确保 .env 已配置 Cookie 或 A2_LIVEATC_BROWSER_ARCHIVE_FLOW_ENABLED=true"
try {
    $hist = Invoke-RestMethod -Uri "http://127.0.0.1:8001/api/v1/ingestion/scheduler/trigger/historical" -Method POST -TimeoutSec 600
    $hist | ConvertTo-Json -Depth 5 | Write-Host
    if ($hist.downloaded -lt 1) {
        Write-Host "警告: LiveATC 本轮未下载到新 mp3（多为 403，需 .env 配置 Cookie）。" -ForegroundColor Yellow
        Write-Host "兜底: 导入 A3 真实 wav 到 A2 ..." -ForegroundColor Yellow
        python (Join-Path $Root "seed_a2_real_files.py")
        $dlDir = Join-Path $A2Dir "liveatc-downloader\downloads"
        if ((Get-ChildItem $dlDir -Filter *.mp3 -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
            python (Join-Path $Root "import_liveatc_downloads_to_a2.py")
        }
    }
} catch {
    Write-Host "历史下载请求失败: $_" -ForegroundColor Red
    python (Join-Path $Root "seed_a2_real_files.py")
}

$status = Invoke-RestMethod -Uri "http://127.0.0.1:8001/api/v1/ingestion/scheduler/status" -Method GET
Write-Host "A2 scheduler status:" ($status | ConvertTo-Json -Compress)

Write-Host "=== 4/5 同步 A1/A2/A3 -> A5 ===" -ForegroundColor Cyan
Set-Location $Root
python sync_all_to_a5.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== 5/5 校验媒体 URL ===" -ForegroundColor Cyan
$rows = Invoke-RestMethod -Uri "http://127.0.0.1:8000/tables/audio_records?limit=20" -Method GET
foreach ($r in $rows) {
    $url = [string]$r.source_url
    if ($url -match "^https?://127\.0\.0\.1:8001/media/") {
        try {
            $head = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 10
            Write-Host ("[OK] audio_id={0} {1} -> {2}" -f $r.audio_id, $r.file_name, $head.StatusCode)
        } catch {
            Write-Host ("[FAIL media] audio_id={0} {1} {2}" -f $r.audio_id, $r.file_name, $url) -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "完成。请启动前端: cd front; npm run dev" -ForegroundColor Green
Write-Host "浏览器: http://localhost:3000 （NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000）"
