#!/bin/bash
# ==========================================================
#   VIRAL SHORT STUDIO — MỞ PHẦN MỀM (macOS)
# ==========================================================
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"

# Nạp Homebrew (để thấy node / ffmpeg / claude trên PATH)
[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
[ -x /usr/local/bin/brew ]   && eval "$(/usr/local/bin/brew shellenv)"

# Trỏ Python + yt-dlp vào môi trường riêng .venv (đã cài faster-whisper)
if [ -x "$DIR/.venv/bin/python" ]; then
  export VSS_PYTHON="$DIR/.venv/bin/python"
fi
if [ -x "$DIR/.venv/bin/yt-dlp" ]; then
  export VSS_YTDLP="$DIR/.venv/bin/yt-dlp"
fi

echo ""
echo "   ==========================================="
echo "    VIRAL SHORT STUDIO - đang khởi động..."
echo "   ==========================================="
echo ""

# Mở trình duyệt sau 2 giây (đợi server lên)
( sleep 2; open "http://localhost:5178" ) &

# Chạy server (Ctrl+C để dừng, hoặc bấm "TẮT PHẦN MỀM (Mac).command")
node server.mjs

read -r -p "  Server đã dừng. Nhấn Enter để đóng... " _
