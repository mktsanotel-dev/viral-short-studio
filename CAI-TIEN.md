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

## 5. 🔊 Văn bản → Giọng AI (TTS) — có ở MỌI phần cần voice
File mới: `lib/tts.mjs` · route `/api/tts` + `/api/tts/voices` trong `server.mjs`.
- Dùng **edge-tts** (giọng neural của Microsoft): **miễn phí, KHÔNG cần API key**, cần internet.
- **12 giọng đọc tiếng Việt** chia 2 nhóm:
  - *Giọng Việt gốc (tự nhiên nhất)* — Microsoft chỉ có **2 giọng Việt gốc**, nên tạo thêm biến thể
    bằng cao độ/tốc độ nền: Hoài My (chuẩn · trầm ấm · trẻ trung · bé gái) và
    Nam Minh (chuẩn · trầm ấm · MC năng động · bé trai).
  - *Giọng đa ngôn ngữ (chất khác lạ)* — Ava · Emma · Andrew · Brian (đã test đọc tiếng Việt OK).
- Chỉnh **tốc độ** (−40…+60%) và **cao độ** (−30…+30Hz) — cộng thêm vào mức nền của giọng.
- **Tự động thử lại 3 lần** khi edge-tts rớt mạng (dịch vụ online hay chập chờn).
- Không có voice? Gõ/dán văn bản → AI đọc thành file giọng, dùng dựng video ngay.
- Có mặt ở:
  - 🎙️ **Short lồng voice** — tự điền vào ô giọng đọc.
  - 🛋️ **Nội thất cho con** — tự điền vào ô giọng.
  - 🔊 **Tab "Giọng AI"** (mới, độc lập) — tạo file giọng + copy đường dẫn dùng cho **tab bất kỳ**.
- Bộ cài (`CÀI ĐẶT (chạy 1 lần).bat` và bản Mac) đã thêm `edge-tts`.
- `server.mjs`: bổ sung MIME audio (mp3/wav/m4a/ogg/webm) để nghe thử ngay trong app.

## 6. Sửa phụ đề trên MỌI thành phẩm (mới)
Trước đây chỉ tab Cắt tự động & Nội thất sửa được phụ đề. Nay **mọi tab làm video** đều có
ô **"✍️ Sửa phụ đề rồi dựng lại"** ngay dưới video: Tự biên tập, Video dài, Short lồng voice.
- Hàm dùng chung `applyEditedText` + `transcriptSegments` trong `lib/transcribe.mjs`.
- Mỗi pipeline (`edit.mjs`, `longedit.mjs`, `voiceshort.mjs`, `interior.mjs`) nhận `editedSegments`,
  áp phụ đề đã sửa rồi burn lại; trả về `segments` cho giao diện.
- Sửa chữ Whisper đọc sai → bấm dựng lại (whisper có cache nên nhanh, không tốn token).
- Giao diện: `subEditorBlock` + `attachSubEditor` trong `public/app.js` (dùng chung mọi tab).

## Bảo mật
- `.env`, `settings.local.json`, thư mục `work/`, và media trong `Tài nguyên/` KHÔNG được đưa lên (theo `.gitignore`).
