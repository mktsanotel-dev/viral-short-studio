#!/bin/bash
# ==========================================================
#   VIRAL SHORT STUDIO — CÀI ĐẶT CÔNG CỤ cho macOS (chạy 1 lần)
#   Cài: Homebrew · Node.js · FFmpeg · Python · faster-whisper
#        · yt-dlp · Claude CLI (bộ não AI)
# ==========================================================
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"

echo ""
echo "  =========================================================="
echo "     VIRAL SHORT STUDIO  -  CÀI ĐẶT (macOS)"
echo "  =========================================================="
echo ""

# ---------- 1) Homebrew ----------
echo "  --- [1/6] Homebrew ---"
if ! command -v brew >/dev/null 2>&1; then
  echo "  [ ] Chưa có Homebrew -> đang cài (có thể hỏi MẬT KHẨU MÁY của bạn)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "  [x] Đã có Homebrew"
fi
# Nạp brew vào phiên hiện tại (Apple Silicon /opt/homebrew · Intel /usr/local)
[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
[ -x /usr/local/bin/brew ]   && eval "$(/usr/local/bin/brew shellenv)"

if ! command -v brew >/dev/null 2>&1; then
  echo "  [!] Vẫn chưa dùng được Homebrew. Hãy đóng cửa sổ, mở lại file này lần nữa."
  read -r -p "  Nhấn Enter để thoát... " _; exit 1
fi

# ---------- 2) Node · FFmpeg · Python ----------
echo ""
echo "  --- [2/6] Node.js · FFmpeg · Python ---"
for pkg in node ffmpeg python; do
  if brew list "$pkg" >/dev/null 2>&1; then
    echo "  [x] Đã có $pkg"
  else
    echo "  [ ] Cài $pkg..."
    brew install "$pkg"
  fi
done

# ---------- 3) Môi trường Python riêng (.venv) ----------
# Để faster-whisper + yt-dlp nằm gọn trong thư mục phần mềm, không đụng hệ thống.
echo ""
echo "  --- [3/6] Môi trường Python riêng (.venv) ---"
if [ ! -d "$DIR/.venv" ]; then
  python3 -m venv "$DIR/.venv"
fi
echo "  [ ] Cài faster-whisper + yt-dlp + edge-tts (giọng AI) (có thể mất vài phút)..."
"$DIR/.venv/bin/python" -m pip install --upgrade pip >/dev/null 2>&1
"$DIR/.venv/bin/python" -m pip install --upgrade faster-whisper yt-dlp edge-tts

# ---------- 4) Claude CLI ----------
echo ""
echo "  --- [4/6] Claude CLI (bộ não AI) ---"
if ! command -v claude >/dev/null 2>&1; then
  echo "  [ ] Cài Claude CLI..."
  npm install -g @anthropic-ai/claude-code
else
  echo "  [x] Đã có Claude CLI"
fi

# ---------- 5) Cho phép bấm-đúp các file .command khác ----------
echo ""
echo "  --- [5/6] Mở khoá double-click cho các file .command ---"
chmod +x "$DIR/MỞ PHẦN MỀM (Mac).command" "$DIR/TẮT PHẦN MỀM (Mac).command" 2>/dev/null
echo "  [x] Xong"

# ---------- 6) Đăng nhập Claude ----------
echo ""
echo "  --- [6/6] Đăng nhập Claude (cần tài khoản Anthropic) ---"
echo "  Cửa sổ đăng nhập sẽ mở bằng trình duyệt."
echo "  Nếu KHÔNG cần bộ não AI, gõ n rồi Enter để bỏ qua."
read -r -p "  Đăng nhập Claude bây giờ? (Y/n) " ans
if [ "$ans" != "n" ] && [ "$ans" != "N" ]; then
  claude login
fi

echo ""
echo "  =========================================================="
echo "   HOÀN TẤT! Giờ bấm đúp \"MỞ PHẦN MỀM (Mac).command\" để dùng."
echo "  =========================================================="
echo ""
read -r -p "  Nhấn Enter để đóng... " _
