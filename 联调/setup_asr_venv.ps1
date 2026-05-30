# 创建独立 ASR 虚拟环境（避免 Anaconda NumPy2/numba 与 openai-whisper 冲突）
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Venv = Join-Path $Root ".asr-venv"
$Py = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path $Py)) {
    Write-Host "Creating $Venv ..."
    python -m venv $Venv
}

Write-Host "Installing vosk (offline ASR, avoids Chinese-path crash) ..."
& $Py -m pip install -U pip wheel -q
& $Py -m pip install "vosk>=0.3.45" -q

$ModelsDir = Join-Path $Root "vosk-models"
$Zip = Join-Path $ModelsDir "small-en-us.zip"
if (-not (Test-Path (Join-Path $ModelsDir "vosk-model-small-en-us-0.15\am\final.mdl"))) {
    New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null
    if (-not (Test-Path $Zip)) {
        Write-Host "Downloading Vosk model (~40MB) ..."
        Invoke-WebRequest -Uri "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip" -OutFile $Zip -UseBasicParsing
    }
    Expand-Archive -Path $Zip -DestinationPath $ModelsDir -Force
}

Write-Host "Verify import..."
& $Py -c "import vosk; print('vosk OK')"

Write-Host "Done. ASR worker: $Py 联调\asr_worker.py <audio_id> <path>"
