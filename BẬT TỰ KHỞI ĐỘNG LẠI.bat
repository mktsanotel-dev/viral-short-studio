@echo off
chcp 65001 >nul
title Bật tự khởi động lại - Viral Short Studio
echo.
echo   Đang bật chế độ TỰ KHỞI ĐỘNG LẠI cho phần mềm...
echo   (server bị tắt sẽ tự bật lại trong vòng 2 phút)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-watchdog.ps1"
echo.
echo   ✅ Xong! Từ giờ phần mềm sẽ tự hồi phục khi bị tắt.
echo.
pause
