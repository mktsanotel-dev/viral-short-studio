@echo off
chcp 65001 >nul
title Viral Short Studio
cd /d "%~dp0"
echo.
echo   ===========================================
echo    VIRAL SHORT STUDIO - dang khoi dong...
echo   ===========================================
echo.
start "" http://localhost:5178
node server.mjs
pause
