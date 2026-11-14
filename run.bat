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

rem --- Python environment and dependencies ---
if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating the Python environment, this happens once...
  %PY% -m venv backend\.venv
  if errorlevel 1 goto :fail
)
rem The marker is a copy of the requirements it was installed from, written only after a
rem successful install: a failed install is retried, and changed requirements (a new version)
rem are installed again. fc sets errorlevel 1 when the files differ, 2 when one is missing.
if not exist "backend\.venv\.deps-ok" goto :deps_install
fc /b "backend\requirements.txt" "backend\.venv\.deps-ok" >nul 2>&1
if not errorlevel 1 goto :deps_done
echo Updating the Python dependencies...
goto :deps_run
:deps_install
echo Installing the Python dependencies...
:deps_run
"backend\.venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
if errorlevel 1 goto :fail
copy /y "backend\requirements.txt" "backend\.venv\.deps-ok" >nul
if errorlevel 1 goto :fail
:deps_done

rem --- Web UI: built on the first run, rebuilt when its inputs change (needs Node.js) ---
rem The stamp web\.build-stamp is written only after a successful build. It holds a copy of
rem web\package-lock.json plus the git commit (when git is available), so a new version is
rem rebuilt. Without git only package-lock.json counts: after a source-only change, delete
rem web\dist (rmdir /s /q web\dist) to force a rebuild.
set "NP_STAMP=%TEMP%\netpulse-build-stamp-%RANDOM%.txt"
copy /y "web\package-lock.json" "%NP_STAMP%" >nul
if errorlevel 1 goto :fail
where git >nul 2>&1
if errorlevel 1 goto :stamp_ready
call git rev-parse HEAD >>"%NP_STAMP%" 2>nul
:stamp_ready
if not exist "web\dist\index.html" goto :ui_first
if not exist "web\.build-stamp" goto :ui_update
fc /b "%NP_STAMP%" "web\.build-stamp" >nul 2>&1
if not errorlevel 1 goto :ui_done
:ui_update
set "NP_UI_MSG=Rebuilding the web UI..."
goto :ui_node
:ui_first
set "NP_UI_MSG=Building the web UI, this happens once..."
:ui_node
where npm >nul 2>&1
if errorlevel 1 goto :ui_no_node
echo %NP_UI_MSG%
pushd web || goto :ui_fail_nodir
call npm ci
if errorlevel 1 goto :ui_fail
call npm run build
if errorlevel 1 goto :ui_fail
popd
copy /y "%NP_STAMP%" "web\.build-stamp" >nul
if errorlevel 1 goto :ui_fail_nodir
goto :ui_done

:ui_no_node
del "%NP_STAMP%" >nul 2>&1
echo The web UI has to be built for this version and Node.js was not found.
echo Node.js 22 LTS ^(20.19 or newer^) is needed to build the UI: https://nodejs.org/
echo Install it, then run this file again.
pause
exit /b 1

:ui_fail
popd
:ui_fail_nodir
del "%NP_STAMP%" >nul 2>&1
goto :fail

:ui_done
del "%NP_STAMP%" >nul 2>&1

set "NP_PORT=8765"
if defined NETPULSE_PORT set "NP_PORT=%NETPULSE_PORT%"
echo Starting NetPulse on http://localhost:%NP_PORT%  (close this window or press Ctrl+C to stop)
start "" http://localhost:%NP_PORT%
rem Production: debug is always off here, even if NETPULSE_DEBUG is set for development.
set "NETPULSE_DEBUG="
cd backend
".venv\Scripts\python.exe" -m app
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo NetPulse stopped because of an error. See the messages above.
pause
exit /b 1
