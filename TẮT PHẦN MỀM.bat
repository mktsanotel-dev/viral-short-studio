@echo off
chcp 65001 >nul
title Tắt Viral Short Studio
echo   Đang tắt phần mềm...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :5178 ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
echo   Đã tắt. (Cửa sổ này sẽ tự đóng)
timeout /t 2 >nul
