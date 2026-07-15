#!/bin/bash
# ==========================================================
#   VIRAL SHORT STUDIO — TẮT PHẦN MỀM (macOS)
#   Giải phóng cổng 5178 (dừng server đang chạy).
# ==========================================================
echo ""
echo "  Đang tắt Viral Short Studio (cổng 5178)..."
PIDS="$(lsof -ti tcp:5178 2>/dev/null)"
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -9 2>/dev/null
  echo "  ✅ Đã tắt."
else
  echo "  (Không có server nào đang chạy.)"
fi
echo ""
read -r -p "  Nhấn Enter để đóng... " _
