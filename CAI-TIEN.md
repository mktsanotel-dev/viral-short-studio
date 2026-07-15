# 🚀 CẢI TIẾN — Viral Short Studio (bản Sanotel)

Bản này bổ sung nhiều tính năng so với bản bàn giao gốc. Toàn bộ file đã cập nhật đều nằm trong gói này.

## 1. Font Roboto cho phụ đề (mới)
- Gói kèm 4 độ đậm **Roboto** trong `assets/fonts/` (Regular/Medium/Bold/Black).
- Toàn bộ phụ đề, hook, chữ tay, thumbnail dùng Roboto (thay Arial).
- File mới: `lib/fonts.mjs` — tự copy font vào `work/fonts` và nạp qua `fontsdir` cho libass.
- File sửa: `lib/transcribe.mjs`, `lib/edit.mjs`, `lib/voiceshort.mjs`, `lib/longedit.mjs`, `lib/thumb.mjs`.

## 2. Tải file lẻ + cả thư mục ở MỌI tab (mới)
- Mỗi tab có thanh **📁 Chọn file · 🗂️ Chọn cả thư mục** (giữ nguyên ô dán đường dẫn/link).
- Tab Hàng loạt: chọn cả thư mục → gom về 1 thư mục trên máy chủ, tự điền đường dẫn.
- File sửa: `server.mjs` (`/api/upload` nhận `X-Subdir`), `public/app.js`, `public/index.html`, `public/style.css`.

## 3. Tab mới "🛋️ Nội thất cho con"
File mới: `lib/interior.mjs` · route `/api/interior` trong `server.mjs` · giao diện trong `public/index.html` + `public/app.js`.
- 🔁 Lật video (gương ngang).
- Tải video thô (file/thư mục/kéo-thả).
- Thêm giọng: **ghi âm trực tiếp bằng micro** (MediaRecorder) hoặc chọn file.
- Tăng tốc video 1 / 1.1 / 1.2 và tăng tốc giọng 1 / 1.1 / 1.2.
- Cắt "à ừ" + khoảng chết (dùng lại `lib/fillers.mjs`).
- Logo (mặc định `Tài nguyên/logo-noi-that-cho-con.png`, hoặc chọn file; chỉnh vị trí + cỡ).
- Hiệu ứng chữ: hook chữ to + chữ tay (trên/giữa/dưới).
- **Từ khóa cảm xúc/câu chuyện phóng to giữa màn** — hàm mới `buildKeywordAss` trong `lib/transcribe.mjs`.
- Mỗi video xuất ra có ô **✍️ Sửa phụ đề rồi dựng lại**.

## 4. Chỉnh giọng nói kiểu CapCut (mới)
- Hàm mới `voicePitchTempo` trong `lib/effects.mjs` (dùng `rubberband`).
- Chỉnh **cao độ** (−12…+12 nửa cung), **tông** (Bình thường/Trầm ấm/Trong trẻo/Trẻ em/Rất trầm), **tốc độ**, **khử tạp âm**.

## Bảo mật
- `.env`, `settings.local.json`, thư mục `work/`, và media trong `Tài nguyên/` KHÔNG được đưa lên (theo `.gitignore`).
