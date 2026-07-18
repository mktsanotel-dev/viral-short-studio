// 🔊 VĂN BẢN → GIỌNG AI (Text-to-Speech) bằng edge-tts.
// Dùng bộ giọng neural của Microsoft Edge: MIỄN PHÍ, KHÔNG cần API key.
// Giọng tiếng Việt tự nhiên: vi-VN-HoaiMyNeural (nữ) · vi-VN-NamMinhNeural (nam).
// LƯU Ý: cần INTERNET (edge-tts gọi dịch vụ đọc của Microsoft).
import path from "node:path";
import fs from "node:fs";
import { run, WORK, PY, slug } from "./util.mjs";
import { probe } from "./ffmpeg.mjs";

const UP = path.join(WORK, "uploads");

// 🎭 BỘ GIỌNG ĐỌC TIẾNG VIỆT — 12 lựa chọn.
// Microsoft chỉ có ĐÚNG 2 giọng Việt gốc (Hoài My, Nam Minh), nên để đa dạng ta:
//   1) Tạo BIẾN THỂ từ 2 giọng gốc bằng cao độ/tốc độ nền (rate/pitch) → khác hẳn chất giọng.
//   2) Thêm nhóm giọng ĐA NGÔN NGỮ (Multilingual) của Microsoft — đọc được tiếng Việt,
//      chất giọng khác hẳn (đã test đọc tiếng Việt OK).
// Mỗi mục: voice = giọng edge-tts thật; rate/pitch = mức NỀN, cộng thêm slider của người dùng.
export const TTS_VOICES = [
  // --- Giọng Việt gốc: phát âm chuẩn & tự nhiên nhất ---
  { id: "hoaimy",       label: "Hoài My — nữ, chuẩn",        voice: "vi-VN-HoaiMyNeural",  rate: 0,   pitch: 0,   group: "Giọng Việt gốc (tự nhiên nhất)" },
  { id: "hoaimy-tram",  label: "Hoài My — nữ, trầm ấm",      voice: "vi-VN-HoaiMyNeural",  rate: -5,  pitch: -9,  group: "Giọng Việt gốc (tự nhiên nhất)" },
  { id: "hoaimy-tre",   label: "Hoài My — nữ, trẻ trung",    voice: "vi-VN-HoaiMyNeural",  rate: 6,   pitch: 12,  group: "Giọng Việt gốc (tự nhiên nhất)" },
  { id: "hoaimy-be",    label: "Hoài My — bé gái",           voice: "vi-VN-HoaiMyNeural",  rate: 4,   pitch: 26,  group: "Giọng Việt gốc (tự nhiên nhất)" },
  { id: "namminh",      label: "Nam Minh — nam, chuẩn",      voice: "vi-VN-NamMinhNeural", rate: 0,   pitch: 0,   group: "Giọng Việt gốc (tự nhiên nhất)" },
  { id: "namminh-tram", label: "Nam Minh — nam, trầm ấm",    voice: "vi-VN-NamMinhNeural", rate: -6,  pitch: -11, group: "Giọng Việt gốc (tự nhiên nhất)" },
  { id: "namminh-mc",   label: "Nam Minh — MC năng động",    voice: "vi-VN-NamMinhNeural", rate: 18,  pitch: 3,   group: "Giọng Việt gốc (tự nhiên nhất)" },
  { id: "namminh-be",   label: "Nam Minh — bé trai",         voice: "vi-VN-NamMinhNeural", rate: 4,   pitch: 24,  group: "Giọng Việt gốc (tự nhiên nhất)" },

  // --- Giọng đa ngôn ngữ: chất giọng KHÁC HẲN, vẫn đọc tiếng Việt (nghe thử trước khi dùng) ---
  { id: "ava",       label: "Ava — nữ, ấm & kể chuyện",   voice: "en-US-AvaMultilingualNeural",     rate: 0, pitch: 0, group: "Giọng đa ngôn ngữ (chất khác lạ)" },
  { id: "emma",      label: "Emma — nữ, nhẹ nhàng",       voice: "en-US-EmmaMultilingualNeural",    rate: 0, pitch: 0, group: "Giọng đa ngôn ngữ (chất khác lạ)" },
  { id: "andrew",    label: "Andrew — nam, điềm đạm",     voice: "en-US-AndrewMultilingualNeural",  rate: 0, pitch: 0, group: "Giọng đa ngôn ngữ (chất khác lạ)" },
  { id: "brian",     label: "Brian — nam, trầm",          voice: "en-US-BrianMultilingualNeural",   rate: 0, pitch: 0, group: "Giọng đa ngôn ngữ (chất khác lạ)" },
];

// Tra cứu preset. Nhận id preset (vd "hoaimy-tram") HOẶC id giọng edge-tts thật.
function resolveVoice(idOrVoice) {
  const p = TTS_VOICES.find((v) => v.id === idOrVoice);
  if (p) return { voice: p.voice, baseRate: p.rate || 0, basePitch: p.pitch || 0 };
  return { voice: idOrVoice || "vi-VN-HoaiMyNeural", baseRate: 0, basePitch: 0 };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
  voice = "hoaimy",
  rate = 0, pitch = 0, volume = 0,
  outPath = null, onLog = () => {},
} = {}) {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("Chưa có văn bản để đọc");
  fs.mkdirSync(UP, { recursive: true });

  // Preset (vd "namminh-tram") → giọng thật + mức nền; cộng thêm slider người dùng.
  const rv = resolveVoice(voice);
  const edgeVoice = rv.voice;
  const finalRate = clamp(rv.baseRate + (Number(rate) || 0), -50, 100);
  const finalPitch = clamp(rv.basePitch + (Number(pitch) || 0), -50, 50);
  const finalVolume = clamp(Number(volume) || 0, -50, 50);

  // Ghi văn bản ra file UTF-8 rồi cho edge-tts đọc bằng -f
  // → tránh lỗi dấu tiếng Việt / văn bản dài trên dòng lệnh.
  const stamp = Date.now();
  const txtFile = path.join(WORK, `tts-${stamp}.txt`);
  fs.writeFileSync(txtFile, clean, "utf-8");

  const out = outPath || path.join(UP, `${stamp}-giong-ai-${slug(clean.slice(0, 24)) || "voice"}.mp3`);

  onLog(`🔊 Đang tạo giọng AI (${voice} → ${edgeVoice}, tốc độ ${signed(finalRate, "%")}, cao độ ${signed(finalPitch, "Hz")})… ${clean.length} ký tự`);
  // edge-tts gọi dịch vụ ONLINE của Microsoft nên có thể rớt mạng HOẶC bị CHẶN TỐC ĐỘ
  // (rate-limit) khi tạo nhiều lần liên tiếp → TỰ ĐỘNG THỬ LẠI với thời gian chờ TĂNG DẦN.
  const MAX_TRY = 4;
  let lastErr = null;
  try {
    for (let attempt = 1; attempt <= MAX_TRY; attempt++) {
      try {
        // QUAN TRỌNG: --rate/--pitch/--volume phải dùng dạng "--pitch=-11Hz" (có dấu =).
        // Nếu tách rời ("--pitch", "-11Hz") thì argparse của Python hiểu "-11Hz" là
        // MỘT THAM SỐ MỚI (vì bắt đầu bằng dấu -) → lỗi "expected one argument".
        await run(PY, [
          "-m", "edge_tts",
          "--voice", edgeVoice,
          "-f", txtFile,
          `--rate=${signed(finalRate, "%")}`,
          `--pitch=${signed(finalPitch, "Hz")}`,
          `--volume=${signed(finalVolume, "%")}`,
          "--write-media", out,
        ], { onLog: () => {} });
        if (fs.existsSync(out) && fs.statSync(out).size >= 500) { lastErr = null; break; }
        lastErr = new Error("file giọng tạo ra rỗng");
      } catch (e) { lastErr = e; }
      if (lastErr && attempt < MAX_TRY) {
        const wait = 1200 * Math.pow(2, attempt - 1); // 1.2s → 2.4s → 4.8s
        onLog(`  ⚠ lần ${attempt}/${MAX_TRY} chưa được (mạng chập chờn / bị chặn tốc độ) → chờ ${(wait / 1000).toFixed(1)}s rồi thử lại…`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  } finally {
    try { fs.unlinkSync(txtFile); } catch { /* dọn */ }
  }
  if (lastErr) {
    // Thông báo THÂN THIỆN (giấu traceback Python) — nguyên nhân hay gặp nhất là rate-limit tạm thời.
    throw new Error(
      "Tạo giọng AI chưa được — dịch vụ giọng của Microsoft đang bận hoặc chặn tốc độ tạm thời " +
      "(hay xảy ra khi tạo nhiều giọng liên tiếp). Hãy CHỜ 1–2 PHÚT rồi bấm tạo lại. " +
      "Nếu vẫn lỗi: kiểm tra kết nối internet."
    );
  }

  if (!fs.existsSync(out) || fs.statSync(out).size < 500) {
    throw new Error("Giọng AI tạo ra rỗng — kiểm tra kết nối mạng hoặc nội dung văn bản.");
  }
  const meta = await probe(out).catch(() => ({ duration: 0 }));
  onLog(`✔ Đã tạo giọng AI: ${path.basename(out)} (${(meta.duration || 0).toFixed(1)}s)`);
  return { path: out, duration: meta.duration || 0, voice, edgeVoice };
}
