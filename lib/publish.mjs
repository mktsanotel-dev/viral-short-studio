// 📦 XUẤT BẢN DÙNG CHUNG — MỌI tính năng làm video (Cắt tự động / Video dài /
// Short lồng voice / Tự biên tập) đều đi qua đây để có BA việc GIỐNG NHAU:
//   1) 🖼️ Thumbnail thương hiệu (nền ảnh chân dung + tiêu đề) — bản brand, fallback trích khung.
//   2) ✍️ Content: AI viết TIÊU ĐỀ + CAPTION đăng bài từ transcript.
//   3) 📤 Đăng Lark Base (video + thumbnail + caption) — chỉ khi bật rõ ràng.
// Nhờ tập trung ở một chỗ → hành vi ĐỒNG NHẤT, không mỗi tab một kiểu.
import path from "node:path";
import fs from "node:fs";
import { askClaude } from "./ai.mjs";
import { makeBrandThumb, pickPhoto } from "./thumbcard.mjs";
import { makeThumbnail } from "./thumb.mjs";
import { postToLark } from "./larkpost.mjs";
import { BRAND } from "./presets.mjs";

// Bóc 1 object JSON đầu tiên trong text (chịu được rào ```json / chữ thừa).
function parseObj(text) {
  if (!text) return null;
  const t = String(text).replace(/```json/gi, "```").replace(/```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* vá dưới */ } }
  try { return JSON.parse(t); } catch { return null; }
}

// ── 1. CONTENT: AI viết tiêu đề + caption đăng bài từ transcript ─────────────
// transcriptText: lời trong video. hintTitle: tiêu đề gợi ý sẵn (vd tiêu đề video dài).
// Trả { title, hook, caption }. Lỗi/không có lời → fallback từ câu đầu transcript.
export async function generateContent({ transcriptText = "", hintTitle = "", onLog = () => {} } = {}) {
  const src = String(transcriptText || "").replace(/\s+/g, " ").trim();
  const fallback = () => {
    const first = src.slice(0, 120).trim();
    return { title: (hintTitle || first || "Video").slice(0, 120), hook: "", caption: hintTitle || first || "" };
  };
  if (!src) return fallback();
  const prompt = `Bạn là biên tập content${BRAND.name ? ` của ${BRAND.name}` : ""} (chủ đề: ${BRAND.niche}).
Dưới đây là LỜI THOẠI trong một video vừa dựng xong. Hãy viết phần đăng bài.
${hintTitle ? `Gợi ý chủ đề: "${hintTitle}"\n` : ""}LỜI THOẠI:
"""${src.slice(0, 3500)}"""

Trả về DUY NHẤT một object JSON hợp lệ (không giải thích, không markdown):
{"title":"<tiêu đề ngắn giật tít, <=120 ký tự>","hook":"<hook 3-8 chữ IN HOA đắt giá>","caption":"<caption đăng Facebook: 2-4 câu cuốn, giá trị thật, KHÔNG icon/emoji, xuống dòng tự nhiên, kết bằng 2-3 hashtag không dấu>"}`;
  try {
    const ans = await askClaude(prompt, { onLog: () => {}, cache: true });
    const o = parseObj(ans);
    if (o && (o.caption || o.title)) {
      return {
        title: String(o.title || hintTitle || "").slice(0, 140).trim() || fallback().title,
        hook: String(o.hook || "").slice(0, 40).trim(),
        caption: String(o.caption || "").trim() || fallback().caption,
      };
    }
    onLog("  ⚠ AI content không trả JSON hợp lệ → dùng câu đầu transcript.");
  } catch (e) { onLog("  ⚠ AI content lỗi: " + e.message + " → dùng câu đầu transcript."); }
  return fallback();
}

// ── 2. THUMBNAIL: brand (ảnh chân dung + tiêu đề) → fallback trích khung video ─
export async function makeThumbFor({ videoPath, title = "Video", thumbPhotoDir = null, thumbPhoto = null, thumbName = BRAND.name, id = "thumb", atSec = null, onLog = () => {} }) {
  // ƯU TIÊN 1: ảnh NGƯỜI CỤ THỂ do người dùng chỉ định (lấy đúng người lên bìa).
  if (thumbPhoto) {
    try {
      if (fs.existsSync(thumbPhoto)) {
        const out = videoPath.replace(/\.mp4$/i, "-thumb.png");
        await makeBrandThumb(thumbPhoto, title || BRAND.name, out, { name: thumbName, id, onLog });
        return out;
      }
      onLog("  ⚠ ảnh người chỉ định không tồn tại → dùng thư mục ảnh.");
    } catch (e) { onLog("  ⚠ thumbnail từ ảnh người lỗi: " + e.message + " → dùng thư mục ảnh."); }
  }
  const dir = thumbPhotoDir || BRAND.thumbPhotoDir;
  // Ưu tiên bản THƯƠNG HIỆU nếu có thư mục ảnh truy cập được.
  if (dir) {
    try {
      const photo = pickPhoto(dir, title || String(id));
      if (photo) {
        const out = videoPath.replace(/\.mp4$/i, "-thumb.png");
        await makeBrandThumb(photo, title || BRAND.name, out, { name: thumbName, id, onLog });
        return out;
      }
      onLog("  ⚠ thư mục ảnh trống/không đọc được → trích khung video.");
    } catch (e) { onLog("  ⚠ thumbnail thương hiệu lỗi: " + e.message + " → trích khung video."); }
  }
  // Fallback: trích 1 khung từ video + chữ tiêu đề.
  try {
    const out = videoPath.replace(/\.mp4$/i, "-thumb.jpg");
    await makeThumbnail(videoPath, title, out, { id, atSec: atSec ?? undefined });
    return out;
  } catch (e) { onLog("  ⚠ trích khung thumbnail lỗi: " + e.message); return null; }
}

// ── 3. ORCHESTRATE: chạy cả 3 việc cho một DANH SÁCH video đầu ra ────────────
// items: [{ outPath, title?, transcriptText?, thumbPath? }]
// opts:  { makeThumb, makeContent, postLark, thumbPhotoDir, thumbName, loai, onLog }
// Trả về items được BỔ SUNG { title, hook, caption, thumbPath, larkRecordId, larkPosted, larkError }.
// Fail an toàn từng bước: lỗi 1 video không chặn các video khác.
export async function publishOutputs(items = [], opts = {}) {
  const {
    makeThumb = true, makeContent = true, postLark = false,
    thumbPhotoDir = null, thumbPhoto = null, thumbName = BRAND.name, loai = "Video", onLog = () => {},
  } = opts;
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = { ...items[i] };
    const tag = items.length > 1 ? `[${i + 1}/${items.length}] ` : "";

    // 3a. Content (caption/title) từ transcript.
    if (makeContent) {
      onLog(`✍️ ${tag}Viết tiêu đề + caption đăng bài (AI)...`);
      const c = await generateContent({ transcriptText: it.transcriptText || "", hintTitle: it.title || "", onLog });
      it.title = c.title || it.title || "Video";
      it.hook = c.hook || it.hook || "";
      it.caption = c.caption || it.caption || "";
    }

    // 3b. Thumbnail (nếu chưa có).
    if (makeThumb && !it.thumbPath && it.outPath) {
      onLog(`🖼️ ${tag}Tạo thumbnail thương hiệu...`);
      try {
        it.thumbPath = await makeThumbFor({
          videoPath: it.outPath, title: it.title || "Video",
          thumbPhotoDir, thumbPhoto, thumbName, id: `pub-${i}`, onLog,
        });
      } catch (e) { onLog("  ⚠ thumbnail lỗi: " + e.message); }
    }

    // 3c. Đăng Lark (chỉ khi bật). Xuất bản là hành động chủ động.
    if (postLark && it.outPath) {
      onLog(`📤 ${tag}Đăng lên Lark Base (Loại=${loai})...`);
      try {
        const pr = await postToLark({ videoPath: it.outPath, caption: it.caption || it.title || "", thumbPath: it.thumbPath || null, loai, onLog: (l) => onLog("    " + l) });
        it.larkRecordId = pr.recordId; it.larkPosted = true;
      } catch (e) { onLog("  ⚠ đăng Lark lỗi: " + e.message); it.larkError = e.message; }
    }
    out.push(it);
  }
  return out;
}
