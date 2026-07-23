// Gọi Claude và ÉP trả JSON hợp lệ. Claude hay bọc ```json ... ``` hoặc kèm lời dẫn →
// bóc tách + thử lại với nhắc nhở nghiêm hơn (spec #15: "AI trả kết quả sai định dạng").
import { askClaude } from "../ai.mjs";

// Cắt khối {..}/[..] cân bằng ngoặc đầu tiên (bỏ qua ngoặc trong chuỗi).
function balancedSlice(t) {
  const open = t[0];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return t.slice(0, i + 1); }
  }
  return null;
}

export function extractJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/[[{]/);
  if (start > 0) t = t.slice(start);
  try { return JSON.parse(t); } catch { /* thử cắt cân bằng */ }
  const bal = balancedSlice(t);
  if (bal) { try { return JSON.parse(bal); } catch { /* bỏ */ } }
  return null;
}

// Gọi askClaude → parse JSON; sai thì thử lại (tối đa `retries` lần) với nhắc nghiêm hơn.
export async function askJSON(prompt, { onLog = () => {}, cache = false, retries = 2 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const p = attempt === 0
      ? prompt
      : prompt + "\n\n⚠ LẦN TRƯỚC BẠN TRẢ SAI ĐỊNH DẠNG. Hãy trả về DUY NHẤT một JSON hợp lệ, " +
        "KHÔNG kèm bất kỳ chữ nào khác, KHÔNG markdown, KHÔNG dùng ```.";
    let text;
    try {
      text = await askClaude(p, { onLog, cache: cache && attempt === 0 });
    } catch (e) { lastErr = e; onLog("  ⚠ AI lỗi: " + e.message); continue; }
    const json = extractJSON(text);
    if (json) return json;
    lastErr = new Error("AI trả về không phải JSON hợp lệ");
    onLog(`  ⚠ AI trả sai định dạng JSON (lần ${attempt + 1}/${retries + 1}) → thử lại...`);
  }
  throw lastErr || new Error("AI không trả JSON hợp lệ sau nhiều lần thử");
}
