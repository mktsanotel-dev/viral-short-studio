// Trám bối cảnh bằng B-ROLL AI TỰ TẠO (Higgsfield) — không cần thư mục của người dùng.
// Với mỗi cửa sổ lời nói, sinh 1 ảnh dọc 9:16 minh hoạ rồi chèn như b-roll.
//
// LƯU Ý QUAN TRỌNG: Higgsfield là connector claude.ai (xác thực tương tác) nên có thể
// KHÔNG với tới được khi chạy `claude -p` headless. Module này chạy best-effort:
// tạo được ảnh nào dùng ảnh đó, thất bại thì bỏ qua (không làm hỏng cả video).
import path from "node:path";
import fs from "node:fs";
import { run, WORK } from "./util.mjs";

const CLAUDE = process.env.VSS_CLAUDE || "claude";
const AIDIR = path.join(WORK, "aibroll");
fs.mkdirSync(AIDIR, { recursive: true });

// Bỏ dấu + rút gọn 1 cụm mô tả cảnh từ text cửa sổ.
function sceneHint(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

// Chọn các cửa sổ để tạo b-roll (giãn cách, tối đa count).
function pickWindows(transcript, count, targetLen = 3.2) {
  const words = transcript?.words || [];
  const wins = [];
  let cur = null;
  for (const w of words) {
    if (!cur) cur = { start: w.start, end: w.end, text: w.word };
    else { cur.end = w.end; cur.text += " " + w.word; }
    if (cur.end - cur.start >= targetLen) { wins.push(cur); cur = null; }
  }
  if (cur && cur.end - cur.start >= 1.2) wins.push(cur);
  // giãn đều: lấy mỗi cửa sổ thứ 2 để còn thấy người nói
  const spaced = wins.filter((_, i) => i % 2 === 0);
  return spaced.slice(0, count);
}

// Gọi claude headless để Higgsfield tạo 1 ảnh, trả về URL ảnh (hoặc null).
async function genOneImage(hint, style, onLog) {
  const prompt = `Dùng công cụ Higgsfield (generate_image) tạo MỘT ảnh dọc tỉ lệ 9:16, phong cách ${style}, minh hoạ cho nội dung sau (không chứa chữ): "${hint}".
Sau khi ảnh tạo xong, in ra DUY NHẤT đường dẫn URL ảnh (bắt đầu bằng http), KHÔNG giải thích, KHÔNG markdown.`;
  try {
    const { out } = await run(
      CLAUDE,
      ["-p", "--permission-mode", "bypassPermissions", "--model", "claude-sonnet-4-6"],
      { input: prompt, shell: true, onLog: (l) => onLog("    " + l.slice(0, 160)) }
    );
    const m = out.match(/https?:\/\/[^\s"'<>)]+\.(?:png|jpg|jpeg|webp)(?:\?[^\s"'<>)]*)?/i)
      || out.match(/https?:\/\/[^\s"'<>)]+/i);
    return m ? m[0] : null;
  } catch (e) {
    onLog("    ⚠ tạo ảnh lỗi: " + e.message);
    return null;
  }
}

async function downloadTo(url, dest, onLog) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

// Trả về PLAN b-roll [{file,kind:'image',start,dur,matched}] từ ảnh AI.
export async function planAiBroll(transcript, {
  count = 6, style = "điện ảnh, ánh sáng đẹp, chân thực", coverRatio = 0.8, maxLen = 3.5,
  id = "ai", onLog = () => {},
} = {}) {
  const wins = pickWindows(transcript, count);
  if (!wins.length) { onLog("  (không đủ lời để tạo b-roll AI)"); return []; }
  onLog(`  sẽ tạo ${wins.length} ảnh b-roll bằng Higgsfield...`);
  const plan = [];
  for (let i = 0; i < wins.length; i++) {
    const win = wins[i];
    onLog(`  [${i + 1}/${wins.length}] tạo ảnh cho: "${sceneHint(win.text).slice(0, 60)}..."`);
    const url = await genOneImage(sceneHint(win.text), style, onLog);
    if (!url) { onLog("    → bỏ qua (không có ảnh)"); continue; }
    const dest = path.join(AIDIR, `${id}-${i}.jpg`);
    try { await downloadTo(url, dest, onLog); }
    catch (e) { onLog("    ⚠ tải ảnh lỗi: " + e.message); continue; }
    const segLen = win.end - win.start;
    const dur = Math.max(1.0, Math.min(maxLen, segLen * coverRatio));
    plan.push({ file: dest, kind: "image", start: +(win.start + 0.05).toFixed(3), dur: +dur.toFixed(3), matched: true });
    onLog("    ✓ xong");
  }
  onLog(`  tạo được ${plan.length}/${wins.length} ảnh b-roll AI.`);
  return plan.slice(0, count);
}
