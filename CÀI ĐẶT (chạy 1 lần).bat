@echo off
chcp 65001 >nul
title CÀI ĐẶT - Viral Short Studio
cd /d "%~dp0"
color 0B

echo.
echo   ==========================================================
echo      VIRAL SHORT STUDIO  -  CÀI ĐẶT CÔNG CỤ (chạy 1 lần)
echo   ==========================================================
echo.
echo   Trình này sẽ kiểm tra và cài các công cụ cần thiết:
echo     1) Node.js      2) FFmpeg      3) Python + Whisper
echo     4) yt-dlp       5) Claude CLI (bộ não AI)
echo.
pause

set NEEDREOPEN=0

REM ---- winget có sẵn không? ----
where winget >nul 2>&1
if errorlevel 1 (
  echo   [!] Máy chưa có "winget" (App Installer). Hãy cài "App Installer" từ Microsoft Store rồi chạy lại.
  echo.
)

REM ================= 1) NODE.JS =================
echo.
echo   --- [1/5] Node.js ---
where node >nul 2>&1
if errorlevel 1 (
  echo   [ ] Chưa có Node.js -> đang cài...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  set NEEDREOPEN=1
) else (
  for /f "delims=" %%v in ('node -v') do echo   [x] Đã có Node.js %%v
)

REM ================= 2) FFMPEG =================
echo.
echo   --- [2/5] FFmpeg ---
where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo   [ ] Chưa có FFmpeg -> đang cài...
  winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
  set NEEDREOPEN=1
) else (
  echo   [x] Đã có FFmpeg
)

REM ================= 3) PYTHON =================
echo.
echo   --- [3/5] Python ---
where python >nul 2>&1
if errorlevel 1 (
  echo   [ ] Chưa có Python -> đang cài...
  winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
  set NEEDREOPEN=1
) else (
  for /f "delims=" %%v in ('python --version') do echo   [x] Đã có %%v
)

if "%NEEDREOPEN%"=="1" (
  echo.
  echo   ==========================================================
  echo    ĐÃ CÀI CÔNG CỤ NỀN. Vui lòng ĐÓNG cửa sổ này và
  echo    CHẠY LẠI "CÀI ĐẶT" một lần nữa để hoàn tất Whisper + Claude.
  echo   ==========================================================
  echo.
  pause
  exit /b
)

REM ================= 4) WHISPER + YT-DLP (pip) =================
echo.
echo   --- [4/5] Whisper (gõ chữ) + yt-dlp ---
python -m pip install --upgrade pip >nul 2>&1
echo   Đang cài faster-whisper + yt-dlp + edge-tts (giọng AI) (có thể mất vài phút)...
python -m pip install --upgrade faster-whisper yt-dlp edge-tts
echo   Đang cài thư viện tăng tốc GPU (bỏ qua nếu máy không có card NVIDIA)...
python -m pip install --upgrade nvidia-cublas-cu12 nvidia-cudnn-cu12 >nul 2>&1

REM ================= 5) CLAUDE CLI =================
echo.
echo   --- [5/5] Claude CLI (bộ não AI chọn đoạn) ---
where claude >nul 2>&1
if errorlevel 1 (
  echo   [ ] Chưa có Claude CLI -> đang cài...
  call npm install -g @anthropic-ai/claude-code
) else (
  echo   [x] Đã có Claude CLI
)

echo.
echo   ==========================================================
echo    GẦN XONG! Bước cuối: ĐĂNG NHẬP CLAUDE (cần tài khoản Anthropic)
echo   ==========================================================
echo   Cửa sổ đăng nhập sẽ mở. Làm theo hướng dẫn (đăng nhập bằng trình duyệt).
echo   Nếu không cần bộ não AI, có thể bỏ qua bước này (đóng cửa sổ).
echo.
pause
call claude login

echo.
echo   ==========================================================
echo    HOÀN TẤT! Giờ bấm đúp "MỞ PHẦN MỀM" để dùng.
echo    (Chạy "TẠO LỐI TẮT MÀN HÌNH" để có biểu tượng ngoài Desktop)
echo   ==========================================================
echo.
pause
