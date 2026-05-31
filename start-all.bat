@echo off
setlocal

set "ROOT=%~dp0"
set "FRONT_DIR=%ROOT%front"
set "A1_DIR=%ROOT%A-1"
set "A2_DIR=%ROOT%A-2"
set "ALPHA_DIR=%ROOT%Alpha"
set "A2_DATA_ROOT=%A2_DIR%\storage"
set "A2_DB_PATH=%A2_DATA_ROOT%\a2.sqlite3"
set "A2_TEMP_ROOT=%A2_DATA_ROOT%\tmp"

echo Starting ATC annotation services...
echo.
echo Frontend: http://127.0.0.1:3000
echo A-1:      http://127.0.0.1:3001
echo Alpha:    http://127.0.0.1:8000
echo A-2:      http://127.0.0.1:8001
echo A-2 DB:   %A2_DB_PATH%
echo.

start "ATC A-1 ADS-B Interface - 3001" cmd /k "cd /d ""%A1_DIR%"" && npm start"
start "ATC Frontend - Next.js" cmd /k "cd /d ""%FRONT_DIR%"" && call conda activate alpha311 && npm run dev"
start "ATC Alpha Backend - 8000" cmd /k "cd /d ""%ALPHA_DIR%"" && call conda activate alpha311 && python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
start "ATC A-2 Backend - 8001" cmd /k "cd /d ""%A2_DIR%"" && call conda activate alpha311 && python -m uvicorn app.main:app --host 127.0.0.1 --port 8001"

endlocal
