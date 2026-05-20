$checks = @(
    @{ Name = "A5"; Url = "http://127.0.0.1:8000/health" },
    @{ Name = "A2"; Url = "http://127.0.0.1:8001/health" },
    @{ Name = "A3"; Url = "http://127.0.0.1:9002/" },
    @{ Name = "Front"; Url = "http://localhost:3000/" }
)

foreach ($c in $checks) {
    try {
        $r = Invoke-WebRequest -Uri $c.Url -UseBasicParsing -TimeoutSec 15
        Write-Host ("[OK] {0} {1} -> {2}" -f $c.Name, $c.Url, $r.StatusCode)
    } catch {
        Write-Host ("[FAIL] {0} {1} -> {2}" -f $c.Name, $c.Url, $_.Exception.Message)
    }
}

Write-Host ""
Write-Host "A2 by-track:" 
try {
    (Invoke-WebRequest -Uri "http://127.0.0.1:8001/api/v1/audio/by-track/1?limit=5" -UseBasicParsing).Content
} catch { Write-Host $_.Exception.Message }

Write-Host ""
Write-Host "A5 audio count (tables list):"
try {
    (Invoke-WebRequest -Uri "http://127.0.0.1:8000/tables/audio_records?limit=10" -UseBasicParsing).Content.Substring(0, [Math]::Min(500, (Invoke-WebRequest -Uri "http://127.0.0.1:8000/tables/audio_records?limit=10" -UseBasicParsing).Content.Length))
} catch { Write-Host $_.Exception.Message }
