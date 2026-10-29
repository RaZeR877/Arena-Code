@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or is not on PATH.
  echo Install Node.js 20 or later, then try again.
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)"
if errorlevel 1 (
  echo Arena Code requires Node.js 20 or later.
  node --version
  pause
  exit /b 1
)
echo Starting Arena Code on http://127.0.0.1:3000
start "Arena Code Server" cmd /k "cd /d ""%~dp0"" && node server.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3000"
