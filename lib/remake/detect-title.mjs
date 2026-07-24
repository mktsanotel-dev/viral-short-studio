// 🔎 NHẬN DIỆN TIÊU ĐỀ ĐẦU VIDEO (dùng cho Remake):
// Nếu ĐẦU video gốc ĐÃ có sẵn dòng chữ tiêu đề (text overlay) → remake KHÔNG thêm tiêu đề nữa
// (tránh chồng 2 lớp chữ). Dùng AI-vision qua claude -p với ảnh khung hình (@mention).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { run, WORK } from "../util.mjs";
import { FFMPEG, probe } from "../ffmpeg.mjs";

const CLAUDE = process.env.VSS_CLAUDE || "claude";
const CACHE = path.join(WORK, "cache");
try { fs.mkdirSync(CACHE, { recursive: true }); } catch { /* ok */ }

// Hỏi claude về 1 ảnh (đính kèm bằng @đường-dẫn). Trả về text.
async function askVision(prompt, imgAbsPath, onLog) {
  const input = `${prompt}\n@${imgAbsPath}`;
  const { out } = await run(CLAUDE, ["-p", "--model", "claude-sonnet-4-6"],
    { input, shell: true, onLog: (l) => onLog && onLog("  " + String(l).slice(0, 160)) });
  return String(out || "").trim();
}

// Có tiêu đề/чữ overlay lớn ở ĐẦU video không?
//   true  = có (nên BỎ tiêu đề remake)
//   false = không (nên GIỮ tiêu đề remake)
//   null  = không chắc (lỗi/timeout) → để bên gọi tự quyết
export async function hasOpeningTitle(src, { onLog = () => {}, atSec = null } = {}) {
  if (!src || !fs.existsSync(src)) return null;

  // Cache theo (kích thước + mtime) của file nguồn.
  let key = "x";
  try { const st = fs.statSync(src); key = crypto.createHash("sha1").update(src + st.size + st.mtimeMs).digest("hex").slice(0, 16); } catch { /* ok */ }
  const cacheFile = path.join(CACHE, `title-${key}.txt`);
  try { if (fs.existsSync(cacheFile)) { const v = fs.readFileSync(cacheFile, "utf-8").trim(); onLog("♻ dùng lại kết quả nhận diện tiêu đề"); return v === "true" ? true : v === "false" ? false : null; } } catch { /* ok */ }

  // Trích 1 khung ở đầu (mặc định ~1.5s, hoặc 30% nếu video quá ngắn).
  let at = atSec;
  if (at == null) { try { const m = await probe(src); at = Math.min(1.5, Math.max(0.3, (m.duration || 3) * 0.25)); } catch { at = 1.2; } }
  const frame = path.join(WORK, `titlecheck-${key}.jpg`);
  try {
    await run(FFMPEG, ["-hide_banner", "-y", "-ss", String(at.toFixed(2)), "-i", src,
      "-frames:v", "1", "-q:v", "3", "-vf", "scale=540:-1", frame], {});
  } catch (e) { onLog("  ⚠ không trích được khung để kiểm tra tiêu đề: " + e.message); return null; }

  const prompt =
    "Đây là 1 khung hình ở ĐẦU một video ngắn. Câu hỏi: ở khung hình này có sẵn DÒNG CHỮ TIÊU ĐỀ / HOOK dạng chữ to (text overlay do người làm video thêm vào, KHÔNG tính logo, KHÔNG tính chữ nhỏ trên đồ vật) không? " +
    "Chỉ trả lời DUY NHẤT 1 từ: CO (nếu có tiêu đề chữ to) hoặc KHONG (nếu không).";
  let ans = null;
  try {
    const out = await askVision(prompt, frame, onLog);
    const up = out.toUpperCase();
    if (/\bKHONG\b/.test(up)) ans = false;
    else if (/\bCO\b/.test(up)) ans = true;
    else ans = null;
  } catch (e) { onLog("  ⚠ AI nhận diện tiêu đề lỗi: " + e.message); ans = null; }
  finally { try { fs.unlinkSync(frame); } catch { /* dọn */ } }

  try { if (ans !== null) fs.writeFileSync(cacheFile, String(ans)); } catch { /* ok */ }
  return ans;
}
