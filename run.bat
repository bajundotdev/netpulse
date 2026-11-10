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
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)"
if errorlevel 1 (
  echo NetPulse needs Python 3.12 or newer. Found:
  %PY% --version
  echo Install a newer Python from https://www.python.org/downloads/ and run this file again.
  pause
  exit /b 1
)

rem --- First run: virtual environment and dependencies ---
if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating the Python environment, this happens once...
  %PY% -m venv backend\.venv
  if errorlevel 1 goto :fail
)
rem The marker is written only after a successful install, so a failed install is retried.
if not exist "backend\.venv\.deps-ok" (
  echo Installing the Python dependencies...
  "backend\.venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
  if errorlevel 1 goto :fail
  type nul > "backend\.venv\.deps-ok"
)

rem --- First run: build the web UI (needs Node.js once) ---
if not exist "web\dist\index.html" (
  where npm >nul 2>&1
  if errorlevel 1 (
    echo The web UI has not been built yet and Node.js was not found.
    echo Node.js 22 LTS ^(20.19 or newer^) is needed once to build the UI: https://nodejs.org/
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

set "NP_PORT=8765"
if defined NETPULSE_PORT set "NP_PORT=%NETPULSE_PORT%"
echo Starting NetPulse on http://localhost:%NP_PORT%  (close this window or press Ctrl+C to stop)
start "" http://localhost:%NP_PORT%
cd backend
".venv\Scripts\python.exe" -m app
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo NetPulse stopped because of an error. See the messages above.
pause
exit /b 1
