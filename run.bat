@echo off
setlocal
cd /d "%~dp0"

rem --- Python launcher: prefer "py -3", fall back to "python" ---
set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (
  python --version >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo Python 3.12 or newer was not found. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH", then run this file again.
  pause
  exit /b 1
)

rem --- First run: virtual environment and dependencies ---
if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating the Python environment, this happens once...
  %PY% -m venv backend\.venv
  if errorlevel 1 goto :fail
  "backend\.venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
  if errorlevel 1 goto :fail
)

rem --- First run: build the web UI (needs Node.js once) ---
if not exist "web\dist\index.html" (
  where npm >nul 2>&1
  if errorlevel 1 (
    echo The web UI has not been built yet and Node.js was not found.
    echo Node.js 20 or newer is needed once to build the UI: https://nodejs.org/
    echo Install it, then run this file again.
    pause
    exit /b 1
  )
  echo Building the web UI, this happens once...
  pushd web
  call npm ci
  if errorlevel 1 ( popd & goto :fail )
  call npm run build
  if errorlevel 1 ( popd & goto :fail )
  popd
)

echo Starting NetPulse on http://localhost:8765  (close this window or press Ctrl+C to stop)
start "" http://localhost:8765
cd backend
".venv\Scripts\python.exe" -m app
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo NetPulse stopped because of an error. See the messages above.
pause
exit /b 1
