// 🔊 VĂN BẢN → GIỌNG AI (Text-to-Speech) bằng edge-tts.
// Dùng bộ giọng neural của Microsoft Edge: MIỄN PHÍ, KHÔNG cần API key.
// Giọng tiếng Việt tự nhiên: vi-VN-HoaiMyNeural (nữ) · vi-VN-NamMinhNeural (nam).
// LƯU Ý: cần INTERNET (edge-tts gọi dịch vụ đọc của Microsoft).
import path from "node:path";
import fs from "node:fs";
import { run, WORK, PY, slug } from "./util.mjs";
import { probe } from "./ffmpeg.mjs";

const UP = path.join(WORK, "uploads");

// Danh sách giọng cho giao diện chọn.
export const TTS_VOICES = [
  { id: "vi-VN-HoaiMyNeural", label: "🇻🇳 Hoài My (nữ, thân thiện)" },
  { id: "vi-VN-NamMinhNeural", label: "🇻🇳 Nam Minh (nam, thân thiện)" },
  { id: "en-US-AriaNeural", label: "🇺🇸 Aria (nữ, tiếng Anh)" },
  { id: "en-US-GuyNeural", label: "🇺🇸 Guy (nam, tiếng Anh)" },
];

// Chuẩn hoá tham số dạng phần trăm/Hz mà edge-tts yêu cầu (luôn có dấu + hoặc -).
function signed(v, unit) {
  const n = Math.round(Number(v) || 0);
  return `${n >= 0 ? "+" : "-"}${Math.abs(n)}${unit}`;
}

// Tạo file giọng đọc từ văn bản.
//  text: nội dung cần đọc (tiếng Việt có dấu OK).
//  voice: id giọng. rate: -50..100 (%). pitch: -50..50 (Hz). volume: -50..50 (%).
// Trả về { path, duration, voice }.
export async function textToSpeech(text, {
  voice = "vi-VN-HoaiMyNeural",
  rate = 0, pitch = 0, volume = 0,
  outPath = null, onLog = () => {},
} = {}) {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("Chưa có văn bản để đọc");
  fs.mkdirSync(UP, { recursive: true });

  // Ghi văn bản ra file UTF-8 rồi cho edge-tts đọc bằng -f
  // → tránh lỗi dấu tiếng Việt / văn bản dài trên dòng lệnh.
  const stamp = Date.now();
  const txtFile = path.join(WORK, `tts-${stamp}.txt`);
  fs.writeFileSync(txtFile, clean, "utf-8");

  const out = outPath || path.join(UP, `${stamp}-giong-ai-${slug(clean.slice(0, 24)) || "voice"}.mp3`);

  onLog(`🔊 Đang tạo giọng AI (${voice})… ${clean.length} ký tự`);
  try {
    await run(PY, [
      "-m", "edge_tts",
      "--voice", voice,
      "-f", txtFile,
      "--rate", signed(rate, "%"),
      "--pitch", signed(pitch, "Hz"),
      "--volume", signed(volume, "%"),
      "--write-media", out,
    ], { onLog: (l) => onLog("  " + l) });
  } catch (e) {
    throw new Error(
      "Tạo giọng AI lỗi (edge-tts cần INTERNET). Chi tiết: " + e.message
    );
  } finally {
    try { fs.unlinkSync(txtFile); } catch { /* dọn */ }
  }

  if (!fs.existsSync(out) || fs.statSync(out).size < 500) {
    throw new Error("Giọng AI tạo ra rỗng — kiểm tra kết nối mạng hoặc nội dung văn bản.");
  }
  const meta = await probe(out).catch(() => ({ duration: 0 }));
  onLog(`✔ Đã tạo giọng AI: ${path.basename(out)} (${(meta.duration || 0).toFixed(1)}s)`);
  return { path: out, duration: meta.duration || 0, voice };
}
