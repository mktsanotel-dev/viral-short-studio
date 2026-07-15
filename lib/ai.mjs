// Phân tích sâu bằng AI cloud: gọi claude CLI headless (-p).
// Claude tại máy có sẵn Higgsfield (virality predictor) + kiến thức viral để phân tích.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { run, WORK } from "./util.mjs";

const CLAUDE = process.env.VSS_CLAUDE || "claude";
const CACHE_DIR = path.join(WORK, "cache");
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ok */ }

// Gửi 1 prompt cho claude -p, nhận text trả về. Timeout mặc định 5 phút.
// cache=true → LƯU kết quả theo hash prompt; prompt y hệt lần sau → dùng lại, KHÔNG tốn token.
export async function askClaude(prompt, { onLog = () => {}, timeoutMs = 300000, cache = false } = {}) {
  let cacheFile = null;
  if (cache) {
    const key = crypto.createHash("sha1").update(String(prompt)).digest("hex").slice(0, 20);
    cacheFile = path.join(CACHE_DIR, `ai-${key}.txt`);
    try { if (fs.existsSync(cacheFile)) { onLog("♻ dùng lại kết quả AI đã lưu (0 token)"); return fs.readFileSync(cacheFile, "utf-8"); } } catch { /* ignore */ }
  }
  onLog("→ Gọi AI cloud (claude -p)...");
  return await new Promise(async (resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error("AI cloud quá thời gian (timeout)"));
      }
    }, timeoutMs);
    try {
      // Đẩy prompt qua STDIN (né lỗi quoting prompt dài) + shell:true để Windows
      // tìm được claude.cmd. Args chỉ chứa cờ đơn giản nên shell an toàn.
      const { out } = await run(
        CLAUDE,
        ["-p", "--model", "claude-sonnet-4-6"],
        { onLog: (l) => onLog("  " + l.slice(0, 200)), input: prompt, shell: true }
      );
      if (!done) {
        done = true;
        clearTimeout(timer);
        const res = out.trim();
        if (cacheFile && res) { try { fs.writeFileSync(cacheFile, res); } catch { /* ignore */ } }
        resolve(res);
      }
    } catch (e) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    }
  });
}

// Dựng prompt phân tích viral từ kết quả evaluate + transcript.
export function buildViralPrompt(ev) {
  const d = ev.dimensions || {};
  const lines = Object.values(d).map((x) => `- ${x.label}: ${x.score}/100 (${x.detail})`).join("\n");
  return `Bạn là chuyên gia video short viral (TikTok/Reels/Shorts). Dưới đây là dữ liệu kỹ thuật của 1 video short:

ĐIỂM TỔNG: ${ev.overall}/100 — ${ev.verdict}
Thời lượng: ${ev.meta?.duration?.toFixed(0)}s, khung ${ev.meta?.width}x${ev.meta?.height}${ev.meta?.is916 ? " (9:16)" : ""}
Các trục:
${lines}

Nội dung (transcript):
"""
${(ev.transcriptText || "(không có)").slice(0, 3000)}
"""

Hãy phân tích ngắn gọn, thực chiến, bằng tiếng Việt:
1. Điểm mạnh/yếu lớn nhất về khả năng viral.
2. 3 chỉnh sửa cụ thể ưu tiên cao nhất (nói rõ làm gì, ở giây nào).
3. Viết lại HOOK 3 giây đầu mạnh hơn (2-3 phương án).
4. Gợi ý tiêu đề + caption đăng bài.
Trả lời gọn, gạch đầu dòng.`;
}
