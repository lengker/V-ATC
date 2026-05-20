# VHHH 多方式下载快速参考 (PowerShell 版本)
# 
# 使用方法：
#   .\vhhh_quick_start.ps1
#
# 或在 PowerShell 中：
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
#   .\vhhh_quick_start.ps1

param()

# 配置
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$downloadsDir = Join-Path $scriptDir "downloads"
$cookieFile = Join-Path $scriptDir ".local" "liveatc_cookie.txt"
$downloadScript = Join-Path $scriptDir "vhhh_multimethod_download.py"

# ============================================================================
# 函数定义
# ============================================================================

function Write-Header {
    Write-Host ""
    Write-Host "+================================================================+" -ForegroundColor Cyan
    Write-Host "|      VHHH 香港机场 LiveATC 历史音频多方式下载                  |" -ForegroundColor Cyan
    Write-Host "|          Multi-Method VHHH Historical Audio Downloader        |" -ForegroundColor Cyan
    Write-Host "+================================================================+" -ForegroundColor Cyan
    Write-Host ""
}

function Show-Menu {
    Write-Host ""
    Write-Host "请选择下载方式 (Choose download method):" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  [1] 快速下载 - 使用现有 Cookie（Fast - Use existing Cookie）" -ForegroundColor Green
    Write-Host "  [2] 浏览器导出 - 启动浏览器完成验证（Browser - Export Cookie with verification）" -ForegroundColor Green
    Write-Host "  [3] 自定义 Cookie - 直接提供 Cookie 字符串（Custom - Provide Cookie string）" -ForegroundColor Green
    Write-Host "  [4] 指定日期 - 下载特定日期的音频（Date - Download specific date）" -ForegroundColor Green
    Write-Host "  [5] 查看日志 - 查看最后的下载日志（Logs - View download logs）" -ForegroundColor Green
    Write-Host "  [6] 打开下载文件夹 - 打开下载目录（Open - Open downloads folder）" -ForegroundColor Green
    Write-Host "  [0] 退出（Exit）" -ForegroundColor Red
    Write-Host ""
    $choice = Read-Host "输入选择 (Enter choice)"
    return $choice
}

function Check-Environment {
    Write-Host "► 环境检查..." -ForegroundColor Cyan
    
    # 检查 Python
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        $python = Get-Command python3 -ErrorAction SilentlyContinue
    }
    
    if (-not $python) {
        Write-Host "  [FAIL] 缺少 Python" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] Python 已安装" -ForegroundColor Green
    
    # 检查脚本
    if (-not (Test-Path $downloadScript)) {
        Write-Host "  [FAIL] 缺少脚本: vhhh_multimethod_download.py" -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK] vhhh_multimethod_download.py 存在" -ForegroundColor Green
    
    # 检查依赖
    try {
        $result = & python -c "import httpx" 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "httpx not found"
        }
    } catch {
        Write-Host "  [WARN] 缺少依赖，尝试安装..." -ForegroundColor Yellow
        Push-Location $scriptDir
        & pip install -r requirements.txt --quiet | Out-Null
        Pop-Location
    }
    Write-Host "  [OK] 依赖已安装" -ForegroundColor Green
    
    # 检查 Cookie
    if (Test-Path $cookieFile) {
        $cookieSize = (Get-Item $cookieFile).Length
        Write-Host "  [OK] Cookie 文件存在（$cookieSize 字节）" -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Cookie 文件不存在: $cookieFile" -ForegroundColor Yellow
    }
    
    Write-Host ""
}

function Quick-Download {
    Write-Host ""
    Write-Host "► 快速下载最近 5 个 30 分钟时段..." -ForegroundColor Cyan
    
    Push-Location $scriptDir
    & python vhhh_multimethod_download.py --count 5 --cookie-file $cookieFile
    Pop-Location
}

function Browser-Export {
    Write-Host ""
    Write-Host "► 启动浏览器导出 Cookie..." -ForegroundColor Cyan
    Write-Host "  1. 浏览器打开 https://www.liveatc.net/" -ForegroundColor Gray
    Write-Host "  2. 如出现 Cloudflare 验证，请手动完成" -ForegroundColor Gray
    Write-Host "  3. 返回此终端按 Enter 键" -ForegroundColor Gray
    Write-Host ""
    
    Push-Location $scriptDir
    & python vhhh_multimethod_download.py --export-cookie --count 5
    Pop-Location
}

function Custom-Cookie {
    Write-Host ""
    $cookieStr = Read-Host "请输入 Cookie 字符串 (Paste Cookie)"
    
    if ([string]::IsNullOrWhiteSpace($cookieStr)) {
        Write-Host "[FAIL] Cookie 不能为空" -ForegroundColor Red
        return
    }
    
    Write-Host ""
    Write-Host "► 使用提供的 Cookie 下载..." -ForegroundColor Cyan
    
    Push-Location $scriptDir
    & python vhhh_multimethod_download.py --cookie $cookieStr --count 5
    Pop-Location
}

function Date-Download {
    Write-Host ""
    $dateStr = Read-Host "输入日期 (Date, YYYY-MM-DD)"
    
    if ([string]::IsNullOrWhiteSpace($dateStr)) {
        Write-Host "[FAIL] 日期不能为空" -ForegroundColor Red
        return
    }
    
    $slotCount = Read-Host "输入时段数 (Time slots, 默认 8)"
    if ([string]::IsNullOrWhiteSpace($slotCount)) {
        $slotCount = 8
    }
    
    Write-Host ""
    Write-Host "► 下载 $dateStr 的 $slotCount 个 30 分钟时段..." -ForegroundColor Cyan
    
    Push-Location $scriptDir
    & python vhhh_multimethod_download.py `
        --date $dateStr `
        --count $slotCount `
        --cookie-file $cookieFile
    Pop-Location
}

function View-Logs {
    Write-Host ""
    $logFile = Join-Path $downloadsDir "vhhh_download.log"
    
    if (Test-Path $logFile) {
        Write-Host "► 最后 30 行日志:" -ForegroundColor Cyan
        Write-Host ""
        Get-Content $logFile -Tail 30 | Write-Host
    } else {
        Write-Host "[FAIL] 日志文件不存在: $logFile" -ForegroundColor Red
    }
}

function Open-Downloads {
    Write-Host ""
    if (Test-Path $downloadsDir) {
        Write-Host "► 打开下载文件夹: $downloadsDir" -ForegroundColor Cyan
        Invoke-Item $downloadsDir
    } else {
        Write-Host "[FAIL] 下载文件夹不存在: $downloadsDir" -ForegroundColor Red
    }
}

# ============================================================================
# 主程序
# ============================================================================

function Main {
    Write-Header
    Check-Environment
    
    while ($true) {
        $choice = Show-Menu
        
        switch ($choice) {
            "1" { Quick-Download }
            "2" { Browser-Export }
            "3" { Custom-Cookie }
            "4" { Date-Download }
            "5" { View-Logs }
            "6" { Open-Downloads }
            "0" { 
                Write-Host "再见 (Goodbye)" -ForegroundColor Green
                exit 0
            }
            default { 
                Write-Host "[FAIL] 无效选择 (Invalid choice)" -ForegroundColor Red
            }
        }
    }
}

# 运行主程序
Main
