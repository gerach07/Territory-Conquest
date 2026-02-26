@echo off
title Territory Conquest Server
echo.
echo   ==========================================
echo     Territory Conquest Server
echo   ==========================================
echo.

set "NODE_PATH=%~dp0node-portable\node-v20.11.1-win-x64"
set "PATH=%NODE_PATH%;%PATH%"

cd /d "%~dp0"

echo   Starting server on http://localhost:3000
echo   Press Ctrl+C to stop
echo.

node start.js

pause
