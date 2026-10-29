@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-to-github.ps1" %*
if errorlevel 1 echo Publishing did not complete. Review the message above.
pause
