// 🧠 BỘ NÃO SĂN KHOẢNH KHẮC — video dài → nhiều short viral tự động.
// Luồng: gõ chữ TOÀN video (1 lần) → Claude chấm & chọn các ĐOẠN ĐẮT GIÁ
// (vừa có triết lý/insight, vừa viral) → mỗi đoạn: cắt + bỏ tiếng đệm (à/ừ/ờ)
// + đắp hook chữ to + phụ đề động + hiệu ứng → xuất short + file caption gợi ý.
import path from "node:path";
import fs from "node:fs";
import { run, WORK, slug, __root } from "./util.mjs";
import { FFMPEG, probe, hasNvenc, toSdrIfHdr } from "./ffmpeg.mjs";
import { transcribeWords, transcriptSegments, splitIntoLines } from "./transcribe.mjs";
import { autoEdit } from "./edit.mjs";
import { planClipCuts, remapTranscript } from "./fillers.mjs";
import { askClaude } from "./ai.mjs";
import { makeThumbnail } from "./thumb.mjs";
import { makeBrandThumb, pickPhoto } from "./thumbcard.mjs";
import { evaluate } from "./evaluate.mjs";
import { DEFAULTS, BRAND } from "./presets.mjs";

const OUT = path.join(WORK, "out");
fs.mkdirSync(OUT, { recursive: true });

const fmtMS = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Nhãn thời gian GIỜ ĐỊA PHƯƠNG (máy = GMT+7) cho tên thư mục — KHÔNG dùng toISOString (ra UTC lệch).
function runStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function parseMS(v) {
  if (typeof v === "number") return v;
  const m = String(v || "").match(/(\d+)\s*:\s*(\d+)/);
  if (m) return +m[1] * 60 + +m[2];
  const f = parseFloat(v);
  return isFinite(f) ? f : null;
}

// Đọc "chất riêng" thương hiệu HMH (nếu wiki có) để chấm bám triết lý.
// __root = thư mục tool (output/2026-.../) → lùi 2 cấp ra gốc HOA BRAIN.
function brandRubric() {
  const brain = path.dirname(path.dirname(__root));
  for (const rel of ["wiki/overview.md", "index.md"]) {
    try {
      const p = path.join(brain, rel);
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8").slice(0, 1200);
    } catch { /* bỏ qua */ }
  }
  return "";
}

// Cắt transcript thành các mảnh ~maxChars để đưa cho Claude (video dài).
function chunkSegments(segments, maxChars = 6500) {
  const chunks = [];
  let cur = [], len = 0;
  for (const s of segments) {
    const line = `[${fmtMS(s.start)}] ${s.text}`;
    if (len + line.length > maxChars && cur.length) { chunks.push(cur); cur = []; len = 0; }
    cur.push(line); len += line.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export function buildSelectPrompt(linesText, brand = "", floor = 50) {
  return `Bạn là biên tập viên video short (TikTok/Reels/YouTube Shorts)${BRAND.name ? ` cho ${BRAND.name}` : ""} — chủ đề: ${BRAND.niche}.
Dưới đây là một phần transcript CÓ MỐC THỜI GIAN [phút:giây] của video dài quay tại chương trình đào tạo.
${brand ? `\nBỐI CẢNH THƯƠNG HIỆU (để chấm đúng "chất"):\n"""${brand}"""\n` : ""}
NHIỆM VỤ: tìm những ĐOẠN ĐẮT GIÁ nhất để cắt thành video short. Một đoạn đắt giá phải THỎA CẢ BA:
(A) GIÁ TRỊ/TRIẾT LÝ: chứa một insight, một góc nhìn "aha", một nguyên lý khiến người xem NGỘ ra điều gì đó (trong ${BRAND.niche}) — TỰ ĐỨNG ĐỘC LẬP, không cần ngữ cảnh trước đó.
(B) VIRAL: có câu mở mạnh hoặc một "punch line" đáng chia sẻ, dễ khiến người xem tag/chia sẻ.
(C) CẢM XÚC (TIÊU CHÍ CHÍNH — ưu tiên cao): đoạn phải KHIẾN NGƯỜI XEM RUNG ĐỘNG — xúc động, truyền cảm hứng, nổi da gà, cay mắt, hoặc bừng tỉnh. Cảm xúc mạnh nhất thường nằm ở: một CÂU CHUYỆN CÁ NHÂN/trải nghiệm thật, sự tổn thương/thành thật, một sự thật phũ phàng nói thẳng, hoặc một mạch DẪN LÊN CAO TRÀO rồi chốt bằng một câu đắt. ƯU TIÊN đoạn có cảm xúc thật hơn đoạn chỉ "đúng mà khô".

QUY TẮC:
- Mỗi đoạn thường 20–90 giây, ĐƯỢC PHÉP DÀI HƠN nếu cần để TRỌN Ý (đừng cắt cụt).
- BẮT ĐẦU ở đầu một câu, KẾT THÚC ở CÂU CHỐT TRỌN VẸN — một kết "có hậu"/đủ ý (câu tổng kết, bài học rút ra, lời khuyên). TUYỆT ĐỐI không kết giữa chừng một ý đang dang dở.
- Thà ÍT mà CHẤT. Bỏ qua đoạn chào hỏi, lan man, ví dụ vụn, quảng cáo.
- KHÔNG chọn hai đoạn trùng nội dung.
- Với MỖI đoạn, chỉ ra CÂU CAO TRÀO: câu đắt nhất/lay động nhất trong đoạn (chép NGUYÊN VĂN từ transcript) và mốc [m:ss] nơi câu đó bắt đầu — đây là điểm sẽ được nhấn (zoom/nhạc dâng).

TRANSCRIPT:
"""
${linesText}
"""

Trả về DUY NHẤT một mảng JSON hợp lệ (không kèm giải thích, không markdown), mỗi phần tử:
{"start":"m:ss","end":"m:ss","score":<0-100 gộp cả triết lý+viral+cảm xúc>,"emotion":"<tông cảm xúc 1-3 chữ: vd xúc động / hào hùng / trăn trở / bừng tỉnh>","emotionScore":<0-100 mức lay động>,"climax":"<câu cao trào chép nguyên văn>","climaxTime":"m:ss","title":"<tiêu đề ngắn giật tít>","hook":"<hook 3-8 chữ IN lên đầu video>","caption":"<caption đăng bài + 2-3 hashtag>","philosophy":"<triết lý/insight đoạn này trao>","reason":"<vì sao đáng viral + vì sao chạm cảm xúc>"}
Chọn ít nhất 1 đoạn NẾU phần này có bất kỳ nội dung nào có ý nghĩa (score >= ${floor}). Chỉ trả [] khi TOÀN là chào hỏi/ồn/vô nghĩa.`;
}

// Bóc mảng JSON từ text Claude (chịu được rào ```json, chữ thừa, ngoặc lồng).
export function parseClips(text) {
  if (!text) return [];
  let t = String(text).replace(/```json/gi, "```").replace(/```/g, "").trim();
  // 1) Thử: từ '[' đầu tiên, khớp ']' theo ĐỘ SÂU ngoặc (bỏ qua ] nằm trong chuỗi).
  const arr = extractBalancedArray(t);
  if (arr) { try { return JSON.parse(arr); } catch { /* xuống vá */ } }
  // 2) Thử nguyên chuỗi (nếu Claude trả object đơn hoặc mảng sạch).
  try { const j = JSON.parse(t); return Array.isArray(j) ? j : [j]; } catch { /* vá */ }
  // 3) Vá thô: lấy từng object {...} (kể cả khi mảng hỏng dấu phẩy).
  const out = [];
  const re = /\{[^{}]*\}/g; let m;
  while ((m = re.exec(t))) { try { out.push(JSON.parse(m[0])); } catch { /* skip */ } }
  return out;
}

// Trích chuỗi "[...]" cân ngoặc đầu tiên (tôn trọng chuỗi & escape).
function extractBalancedArray(t) {
  const a = t.indexOf("[");
  if (a === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "[") depth++;
      else if (ch === "]") { depth--; if (depth === 0) return t.slice(a, i + 1); }
    }
  }
  return null;
}

// Chuẩn hoá + lọc + khử trùng lặp (đoạn chồng lấn > 40% → giữ điểm cao hơn).
export function normalizeClips(raw, dur, { minScore = 68, minSec = 8, maxSec = 140, maxClips = 30 } = {}) {
  const cand = [];
  for (const c of raw || []) {
    let s = parseMS(c.start), e = parseMS(c.end);
    if (s == null || e == null) continue;
    s = Math.max(0, s); e = Math.min(dur, e);
    if (e - s > maxSec) e = s + maxSec;   // trần rộng, snapClip sẽ canh cuối câu
    if (e - s < minSec) continue;
    const score = Number(c.score) || 0;
    if (score < minScore) continue;
    cand.push({
      start: +s.toFixed(2), end: +e.toFixed(2), score,
      title: (c.title || "").toString().slice(0, 120).trim() || "Khoảnh khắc đắt giá",
      hook: (c.hook || "").toString().slice(0, 40).trim(),
      caption: (c.caption || "").toString().trim(),
      philosophy: (c.philosophy || "").toString().trim(),
      reason: (c.reason || "").toString().trim(),
      // Cảm xúc (đợt 5): tông + mức lay động + câu cao trào (để nhấn về sau).
      emotion: (c.emotion || "").toString().slice(0, 30).trim(),
      emotionScore: Number(c.emotionScore) || 0,
      climax: (c.climax || "").toString().slice(0, 240).trim(),
      climaxTime: parseMS(c.climaxTime),
    });
  }
  cand.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of cand) {
    const overlap = kept.some((k) => {
      const ov = Math.min(c.end, k.end) - Math.max(c.start, k.start);
      return ov > 0 && ov / Math.min(c.end - c.start, k.end - k.start) > 0.4;
    });
    if (!overlap) kept.push(c);
    if (kept.length >= maxClips) break;
  }
  // xuất theo thứ tự thời gian cho dễ theo dõi
  return kept.sort((a, b) => a.start - b.start);
}

// Phương án DỰ PHÒNG khi Claude không trả đoạn nào: chia video theo CÂU thành
// các cửa sổ ~40–70s (kết ở ranh giới câu), để anh luôn có short mà cắt.
export function heuristicClips(segments, dur, { maxClips = 8, target = 55, hardMax = 80 } = {}) {
  const out = [];
  let win = [];
  const flush = () => {
    if (!win.length) return;
    const s = win[0].start, e = win[win.length - 1].end;
    if (e - s < 12) { win = []; return; }
    const text = win.map((x) => x.text).join(" ").replace(/\s+/g, " ").trim();
    const firstWords = text.split(/\s+/).slice(0, 6).join(" ");
    out.push({
      start: +s.toFixed(2), end: +Math.min(dur, e).toFixed(2), score: 60,
      title: text.slice(0, 70).trim() || "Khoảnh khắc trong chương trình",
      hook: firstWords.toUpperCase().slice(0, 38),
      caption: text.slice(0, 200).trim(),
      philosophy: "", reason: "Chọn tự động theo mật độ lời nói (AI không chấm được).",
    });
    win = [];
  };
  for (const seg of segments) {
    win.push(seg);
    const len = win[win.length - 1].end - win[0].start;
    if (len >= target) flush();
    else if (len >= hardMax) flush();
  }
  flush();
  return out.slice(0, maxClips);
}

// Cắt thô 1 đoạn (giữ các keep-range, bỏ đệm + khoảng chết) → file mp4 sạch.
async function roughCut(input, keep, outPath, onLog) {
  const vSel = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
  const useGpu = await hasNvenc();
  await run(FFMPEG, [
    "-hide_banner", "-y", "-i", input,
    "-filter_complex",
    `[0:v]select='${vSel}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${vSel}',asetpts=N/SR/TB[a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", useGpu ? "h264_nvenc" : "libx264", "-preset", useGpu ? "p4" : "veryfast",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", outPath,
  ], { onLog: (l) => onLog("    " + l) });
  return outPath;
}

// Canh đoạn theo RANH GIỚI CÂU: bắt đầu ở đầu câu, KẾT ở cuối câu trọn vẹn (có hậu).
// Không cắt cứng giữa câu → đủ ý. Cho phép dài hơn để trọn ý (tới maxSec).
export function snapClip(segments, aiStart, aiEnd, dur, { tailPad = 0.45, minSec = 12, maxSec = 140 } = {}) {
  if (!segments.length) return { start: Math.max(0, aiStart), end: Math.min(dur, aiEnd) };
  // start = đầu câu gần nhất KHÔNG muộn hơn aiStart (lùi về đầu câu).
  let startSeg = segments[0];
  for (const s of segments) { if (s.start <= aiStart + 1.0) startSeg = s; else break; }
  const start = Math.max(0, startSeg.start - 0.15);
  // end = cuối CÂU chứa/kế tiếp aiEnd (kéo cho trọn câu).
  let endSeg = segments[segments.length - 1];
  for (const s of segments) { if (s.end >= aiEnd - 0.6) { endSeg = s; break; } }
  let end = Math.min(dur, endSeg.end + tailPad);
  // Nếu quá dài, lùi về cuối câu gần maxSec nhất (vẫn trọn câu).
  if (end - start > maxSec) {
    let cut = start + maxSec;
    for (let k = segments.length - 1; k >= 0; k--) {
      if (segments[k].end <= start + maxSec && segments[k].end > start + minSec) { cut = segments[k].end + tailPad; break; }
    }
    end = Math.min(dur, cut);
  }
  if (end - start < minSec) end = Math.min(dur, start + minSec);
  return { start: +start.toFixed(2), end: +end.toFixed(2) };
}

// Trích 1 MẠCH LIỀN [start,end] — KHÔNG cắt vụn bên trong → tiếng khớp hình tuyệt đối.
// Seek chính xác + ép CFR 30fps + resample audio async để video/audio luôn cùng độ dài.
async function extractSpan(input, start, dur, out, onLog) {
  const useGpu = await hasNvenc();
  await run(FFMPEG, [
    "-hide_banner", "-y",
    "-ss", start.toFixed(3), "-i", input, "-t", dur.toFixed(3),
    "-map", "0:v:0", "-map", "0:a:0",
    "-vsync", "cfr", "-r", "30",
    "-af", "aresample=async=1:min_hard_comp=0.100:first_pts=0",
    "-c:v", useGpu ? "h264_nvenc" : "libx264", "-preset", useGpu ? "p4" : "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    out,
  ], { onLog: (l) => onLog("    " + l) });
  return out;
}

// Đổi TỐC ĐỘ 1 clip (0.5–2.0×): video setpts + audio atempo. Dùng cho pacing (nhanh/chậm).
async function applySpeed(input, speed, out, onLog) {
  const sp = Math.max(0.5, Math.min(2.0, Number(speed) || 1));
  const useGpu = await hasNvenc();
  await run(FFMPEG, [
    "-hide_banner", "-y", "-i", input,
    "-filter_complex", `[0:v]setpts=${(1 / sp).toFixed(4)}*PTS[v];[0:a]atempo=${sp.toFixed(4)}[a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", useGpu ? "h264_nvenc" : "libx264", "-preset", useGpu ? "p4" : "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", out,
  ], { onLog: (l) => onLog("    " + l) });
  return out;
}

// Co giãn mốc phụ đề theo tốc độ (2× → mốc chia đôi) để karaoke khớp video đã đổi tốc độ.
function scaleTranscript(pre, speed) {
  const f = 1 / (Number(speed) || 1);
  return {
    words: (pre.words || []).map((w) => ({ start: +(w.start * f).toFixed(3), end: +(w.end * f).toFixed(3), word: w.word })),
    segments: (pre.segments || []).map((s) => ({ start: +(s.start * f).toFixed(3), end: +(s.end * f).toFixed(3), text: s.text })),
    duration: +((pre.duration || 0) * f).toFixed(3),
  };
}

// Dời transcript về mốc 0 cho đoạn [start,end], GIỮ NGUYÊN mọi từ (không bỏ đệm) → khớp tiếng.
export function shiftTranscript(words, segments, start, end) {
  const w = (words || []).filter((x) => x.end > start && x.start < end)
    .map((x) => ({ start: +(Math.max(start, x.start) - start).toFixed(3), end: +(Math.min(end, x.end) - start).toFixed(3), word: x.word }));
  const seg = (segments || []).filter((s) => s.end > start && s.start < end)
    .map((s) => ({ start: +(Math.max(start, s.start) - start).toFixed(3), end: +(Math.min(end, s.end) - start).toFixed(3), text: s.text }));
  return { words: w, segments: seg, duration: +(end - start).toFixed(3) };
}

// ---- Hàm chính ----
export async function autoClip(input, opts = {}) {
  const {
    onLog = () => {}, id = "ac", model = "medium", lang = "vi",
    minScore = 68, maxClips = 30, burnHook = true,
    // tuỳ chọn biên tập truyền thẳng xuống autoEdit
    reframe = DEFAULTS.reframeShort, captionStyle = DEFAULTS.captionStyle, colorLevel = DEFAULTS.colorLevel,
    punch = DEFAULTS.punch, shake = DEFAULTS.shake, film = DEFAULTS.film, progress = DEFAULTS.progress, flash = DEFAULTS.flash,
    scoreClips = DEFAULTS.scoreClips,
    normalize = true, musicPath = null, brollFolder = null, brollFill = "match",
    manual = null, smooth = "off", voiceClean = "off", brollTransition = "fade", aiBroll = false, aiBrollCount = 6,
    logoPath = null, logoPos = "br", logoScale = 0.16, logoOpacity = 0.9, logoX = null, logoY = null,
    sfx = false, sfxVol = 0.6, makeThumb = true, ctaPath = null,
    thumbStyle = "frame", thumbPhotoDir = null, thumbName = BRAND.name,
    musicVol = 0.18,
  } = opts;

  const meta0 = await probe(input);
  onLog(`=== BỘ NÃO SĂN KHOẢNH KHẮC ===`);
  onLog(`Video dài ${Math.round(meta0.duration)}s (${(meta0.duration / 60).toFixed(1)} phút).`);

  // Mỗi LẦN CẮT = một THƯ MỤC RIÊNG trong work/out (ngày-giờ-tên video) cho gọn gàng.
  const RUN_OUT = path.join(OUT, "cat-tu-dong", `${runStamp()}-${slug(path.basename(input).replace(/\.[^.]+$/, "")) || "video"}`);
  fs.mkdirSync(RUN_OUT, { recursive: true });
  onLog(`📁 Thư mục xuất lần này: ${path.basename(RUN_OUT)}`);

  // 🎨 Nguồn HDR (iPhone/BT.2020) → tone-map sang SDR NGAY trên bản gốc 10-bit (chất lượng cao nhất)
  // rồi mới cắt/dựng → hết bạc màu. Giữ đường dẫn GỐC để lưu vào transcript (cho lớp Tinh chỉnh).
  const origInput = input;
  input = await toSdrIfHdr(input, path.join(WORK, `${id}-sdr.mp4`), { onLog });

  // 1) Gõ chữ toàn video (1 lần duy nhất)
  onLog("→ Bước 1/4: gõ chữ toàn bộ video (word-level)... có thể lâu với video dài.");
  const tr = await transcribeWords(input, { model, lang, onLog: (l) => onLog("  " + l) });
  const words = tr.words || [];
  const segments = tr.segments || [];
  onLog(`  xong: ${words.length} từ, ${segments.length} câu.`);
  if (!segments.length) throw new Error("Không nghe được lời trong video (transcript rỗng).");

  // Lưu transcript ĐẦY ĐỦ ra file → để lớp Tinh chỉnh dựng lại 1 short (đổi mốc cắt / sửa
  // phụ đề) mà KHÔNG phải gõ chữ lại. Bám theo id job nên mỗi lần cắt có 1 file riêng.
  const transcriptFile = path.join(RUN_OUT, `${id}-transcript.json`);
  try {
    fs.writeFileSync(transcriptFile, JSON.stringify({ source: origInput, duration: meta0.duration, words, segments }));
    onLog(`  💾 lưu transcript để tinh chỉnh: ${path.basename(transcriptFile)}`);
  } catch (e) { onLog("  ⚠ không lưu được transcript: " + e.message); }

  // 2) Claude chấm & chọn đoạn (chia mảnh cho video dài)
  onLog("→ Bước 2/4: AI chấm & chọn đoạn đắt giá (triết lý + viral)...");
  const brand = brandRubric();
  const chunks = chunkSegments(segments);
  onLog(`  chia transcript thành ${chunks.length} phần để phân tích.`);
  const floor = Math.min(50, Number(minScore) || 68);
  let raw = [];
  for (let i = 0; i < chunks.length; i++) {
    onLog(`  phân tích phần ${i + 1}/${chunks.length}...`);
    try {
      const ans = await askClaude(buildSelectPrompt(chunks[i].join("\n"), brand, floor), { onLog: (l) => onLog("    " + l), cache: true });
      const got = parseClips(ans);
      onLog(`    → AI trả ${(ans || "").length} ký tự, đọc được ${got.length} ứng viên.`);
      if (!got.length && ans) onLog(`    (mẫu AI: ${String(ans).replace(/\s+/g, " ").slice(0, 160)})`);
      raw = raw.concat(got);
    } catch (e) { onLog("    ⚠ AI lỗi phần này: " + e.message); }
  }

  // Chốt đoạn: thử ngưỡng anh chọn, RỖNG thì tự hạ dần rồi mới dùng dự phòng.
  let clips = normalizeClips(raw, meta0.duration, { minScore, maxClips });
  if (!clips.length && raw.length) {
    for (const ms of [minScore - 10, 45, 30, 0]) {
      clips = normalizeClips(raw, meta0.duration, { minScore: ms, maxClips });
      if (clips.length) { onLog(`  (hạ ngưỡng xuống ${ms} → có ${clips.length} đoạn)`); break; }
    }
  }
  if (!clips.length) {
    onLog("  ⚠ AI không chọn được đoạn nào → DÙNG DỰ PHÒNG: chia theo câu nói.");
    clips = heuristicClips(segments, meta0.duration, { maxClips: Math.min(maxClips, 8) });
  }
  onLog(`  CHỐT ${clips.length} đoạn để dựng short.`);
  if (!clips.length) throw new Error("Video hầu như không có lời nói liền mạch để cắt (transcript quá thưa). Kiểm tra tiếng trong video có rõ không, hoặc thử video khác.");

  // 3+4) Dựng từng short: cắt sạch đệm → biên tập viral → xuất + caption
  const useGpu = await hasNvenc();
  onLog(`→ Bước 3/4: dựng ${clips.length} short (${useGpu ? "GPU" : "CPU"})...`);
  const results = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const tag = `[${i + 1}/${clips.length}]`;
    onLog(`\n${tag} "${c.title}"  (${fmtMS(c.start)}–${fmtMS(c.end)}, điểm ${c.score})`);
    try {
      // Canh theo câu (đủ ý, kết có hậu) rồi trích MẠCH LIỀN → tiếng khớp hình tuyệt đối.
      const span = snapClip(segments, c.start, c.end, meta0.duration);
      const rough = path.join(WORK, `${id}-c${i}-rough.mp4`);
      onLog(`  ✂ trích mạch liền ${fmtMS(span.start)}–${fmtMS(span.end)} (${(span.end - span.start).toFixed(0)}s, canh trọn câu)...`);
      await extractSpan(input, span.start, span.end - span.start, rough, onLog);

      const pre = shiftTranscript(words, segments, span.start, span.end);
      const base = slug(c.title) || `clip-${i + 1}`;
      const outPath = path.join(RUN_OUT, `${String(i + 1).padStart(2, "0")}-${base}-${Date.now()}.mp4`);

      // KHÔNG nướng logo/nhạc ở đây — để anh chỉnh SAU rồi bám khi tải (finalize).
      const r = await autoEdit(rough, {
        onLog: (l) => onLog("  " + l), id: `${id}-c${i}`, outPath,
        doCutSilence: false, // mạch liền, không cắt trong
        reframe, doCaptions: true, captionStyle,
        colorLevel, manual, smooth, voiceClean, punch, shake, film, progress, flash, brollTransition,
        brollFolder, brollFill, aiBroll, aiBrollCount, normalize,
        sfx, sfxVol,
        // Nhạc nền upfront: nếu anh chèn nhạc ở tab Cắt tự động → BÁM vào từng short
        // (autoEdit tự aloop=loop=-1 nên nhạc ngắn hơn video sẽ TỰ LẶP).
        musicPath: musicPath || null, musicVol,
        preTranscript: pre,
        hookText: burnHook ? (c.hook || c.title) : null,
        ctaPath,   // CTA cuối video (③ CTA hoặc assets/cta.mp4) — mọi short đều có CTA
      });
      // cập nhật mốc nguồn theo span đã canh (để .txt + UI hiển thị đúng)
      c.start = span.start; c.end = span.end;

      // 📊 ĐIỂM KỸ THUẬT (6 trục: hook/nhịp/giữ chân/âm thanh/định dạng/phụ đề) cho short vừa dựng.
      // KHÁC "Điểm nội dung" (c.score do AI chấm triết lý+viral+cảm xúc). Tái dùng transcript
      // đã có (pre) → KHÔNG gõ chữ lại. Fail an toàn: lỗi thì bỏ điểm này, không chặn short.
      let tech = null;
      if (scoreClips) {
        try {
          tech = await evaluate(outPath, { doTranscript: false, preTranscript: pre, onLog: () => {} });
          onLog(`  📊 điểm kỹ thuật: ${tech.overall}/100 — ${tech.verdict}`);
        } catch (e) { onLog("  ⚠ chấm điểm kỹ thuật lỗi: " + e.message); }
      }

      // Thumbnail: bản THƯƠNG HIỆU (nền đỏ + ảnh anh Hóa + tiêu đề) nếu có thư mục ảnh,
      // ngược lại dùng bản trích khung từ short.
      let thumbPath = null;
      if (makeThumb) {
        try {
          if (thumbStyle === "brand" && thumbPhotoDir) {
            const photo = pickPhoto(thumbPhotoDir, c.title || c.hook || String(i));
            if (!photo) throw new Error("thư mục ảnh trống hoặc không đọc được: " + thumbPhotoDir);
            thumbPath = outPath.replace(/\.mp4$/, "-thumb.png");
            await makeBrandThumb(photo, c.title || c.hook || thumbName || "", thumbPath, { name: thumbName, id: `${id}-c${i}`, onLog });
          } else {
            thumbPath = outPath.replace(/\.mp4$/, "-thumb.jpg");
            const dd = r.meta.duration || 6;
            await makeThumbnail(outPath, c.hook || c.title, thumbPath, { id: `${id}-c${i}`, atSec: Math.min(dd - 0.5, Math.max(5, dd * 0.35)) });
          }
          onLog(`  🖼️ thumbnail: ${path.basename(thumbPath)}`);
        } catch (e) { onLog("  ⚠ thumbnail lỗi: " + e.message); thumbPath = null; }
      }

      // File caption gợi ý cạnh video
      const txt = `TIÊU ĐỀ: ${c.title}
HOOK (chữ đầu video): ${c.hook}

CAPTION ĐĂNG BÀI:
${c.caption}

TRIẾT LÝ / INSIGHT: ${c.philosophy}
CẢM XÚC: ${c.emotion || "?"}${c.emotionScore ? ` (${c.emotionScore}/100)` : ""}
CÂU CAO TRÀO: ${c.climax || "?"}${c.climaxTime != null ? ` [${fmtMS(c.climaxTime)}]` : ""}
VÌ SAO VIRAL: ${c.reason}
ĐIỂM NỘI DUNG (AI chấm triết lý+viral+cảm xúc): ${c.score}/100${tech ? `
ĐIỂM KỸ THUẬT (6 trục hook/nhịp/giữ chân/âm thanh/định dạng/phụ đề): ${tech.overall}/100 — ${tech.verdict}` : ""}
Nguồn: ${fmtMS(c.start)}–${fmtMS(c.end)} của video gốc
`;
      fs.writeFileSync(outPath.replace(/\.mp4$/, ".txt"), txt, "utf-8");
      try { fs.unlinkSync(rough); } catch { /* dọn tạm */ }

      onLog(`  ✅ xong: ${path.basename(outPath)} (${r.meta.duration.toFixed(0)}s)`);
      // Câu cao trào: đổi mốc tuyệt đối (video gốc) → tương đối trong short (để đánh dấu timeline / nhấn sau).
      const climaxAtSec = (c.climaxTime != null && c.climaxTime >= span.start && c.climaxTime <= span.end)
        ? +(c.climaxTime - span.start).toFixed(2) : null;
      results.push({
        ...c, outPath, txtPath: outPath.replace(/\.mp4$/, ".txt"), thumbPath, duration: r.meta.duration,
        // Dữ liệu cho lớp Tinh chỉnh: mốc trong video GỐC + phụ đề đã dời về 0.
        sourceStart: span.start, sourceEnd: span.end, segments: transcriptSegments(pre),
        climaxAtSec,
        // Điểm kỹ thuật (song song điểm nội dung c.score) — để UI hiện 2 điểm.
        techScore: tech ? tech.overall : null,
        techVerdict: tech ? tech.verdict : null,
      });
    } catch (e) {
      onLog(`  ❌ lỗi đoạn này: ${e.message}`);
      results.push({ ...c, error: e.message });
    }
  }

  onLog(`\n=== XONG: ${results.filter((r) => !r.error).length}/${clips.length} short ===`);
  return {
    source: input,
    sourceDuration: meta0.duration,
    durationSec: Math.round(meta0.duration),
    totalWords: words.length,
    picked: clips.length,
    outDir: RUN_OUT,
    clips: results,
    // Cho lớp Tinh chỉnh: file transcript + bộ hiệu ứng đã dùng (để seed panel sửa).
    transcriptFile,
    editOpts: { reframe, captionStyle, colorLevel, punch, shake, film, progress, voiceClean, smooth, burnHook },
  };
}

// Đổi text phụ đề đã sửa vào transcript đã dời-về-0.
// - Câu KHÔNG đổi: giữ nguyên timing word-level gốc (karaoke chuẩn xác).
// - Câu ĐÃ sửa: chia đều các từ mới trong khoảng thời gian của câu (để karaoke vẫn chạy).
// - Câu để TRỐNG: bỏ (ẩn phụ đề đoạn đó).
function applyEditedSegments(shifted, editedTexts) {
  if (!editedTexts) return shifted;
  const words = [], segs = [];
  // DÙNG CHUNG splitIntoLines với transcriptSegments (hiển thị) → khớp index từng dòng người sửa.
  splitIntoLines(shifted).forEach((s, i) => {
    const orig = (s.text || "").trim();
    const edited = editedTexts[i] != null ? String(editedTexts[i]).trim() : orig;
    if (!edited) return; // câu bị xoá → ẩn
    if (edited === orig) {
      words.push(...(shifted.words || []).filter((w) => w.end > s.start - 0.01 && w.start < s.end + 0.01));
      segs.push({ start: s.start, end: s.end, text: orig });
    } else {
      const toks = edited.split(/\s+/).filter(Boolean);
      const span = Math.max(0.2, s.end - s.start);
      const per = span / toks.length;
      toks.forEach((w, k) => words.push({ start: +(s.start + k * per).toFixed(3), end: +(s.start + (k + 1) * per).toFixed(3), word: w }));
      segs.push({ start: s.start, end: s.end, text: edited });
    }
  });
  return { words, segments: segs, duration: shifted.duration };
}

// 🔁 DỰNG LẠI 1 SHORT theo tinh chỉnh: đổi mốc cắt (trim), sửa phụ đề, bật/tắt hiệu ứng.
// KHÔNG gõ chữ lại (đọc transcript đã lưu), KHÔNG nướng logo/nhạc (để lớp finalize làm sau).
export async function reclip(opts = {}) {
  const {
    onLog = () => {}, id = "rc", source, transcriptFile,
    start, end, segments: editedTexts = null,
    reframe = "blur", captionStyle = "karaoke", colorLevel = "off",
    punch = false, film = false, progress = true, doCaptions = true,
    voiceClean = "off", smooth = "off", hookText = null,
    speed = 1, overlayText = null, overlayPos = "bottom",
  } = opts;

  if (!source || !fs.existsSync(source)) throw new Error("không thấy video nguồn để dựng lại");
  const meta0 = await probe(source);
  const s = Math.max(0, Math.min(meta0.duration - 0.5, Number(start)));
  const e = Math.max(s + 1, Math.min(meta0.duration, Number(end)));

  let words = [], segs = [];
  try {
    if (transcriptFile && fs.existsSync(transcriptFile)) {
      const t = JSON.parse(fs.readFileSync(transcriptFile, "utf-8"));
      words = t.words || []; segs = t.segments || [];
    }
  } catch (err) { onLog("⚠ đọc transcript lỗi: " + err.message); }

  let pre = shiftTranscript(words, segs, s, e);
  pre = applyEditedSegments(pre, editedTexts);

  let rough = path.join(WORK, `${id}-rough.mp4`);
  onLog(`✂ trích lại ${fmtMS(s)}–${fmtMS(e)} (${(e - s).toFixed(1)}s) từ video gốc...`);
  await extractSpan(source, s, e - s, rough, onLog);

  // Đổi tốc độ (nếu ≠ 1×): re-encode nhanh/chậm + co giãn mốc phụ đề để karaoke vẫn khớp.
  const sp = Math.max(0.5, Math.min(2.0, Number(speed) || 1));
  if (Math.abs(sp - 1) > 0.01) {
    onLog(`⏩ đổi tốc độ ${sp.toFixed(2)}×...`);
    const spun = path.join(WORK, `${id}-speed.mp4`);
    await applySpeed(rough, sp, spun, onLog);
    try { fs.unlinkSync(rough); } catch { /* dọn */ }
    rough = spun;
    pre = scaleTranscript(pre, sp);
  }

  // Ghi bản dựng lại vào ĐÚNG thư mục lần cắt (cạnh transcript), không rải ra out gốc.
  const runDir = (transcriptFile && fs.existsSync(transcriptFile)) ? path.dirname(transcriptFile) : OUT;
  const outPath = path.join(runDir, `refine-${id}-${Date.now()}.mp4`);
  const r = await autoEdit(rough, {
    onLog: (l) => onLog(l), id: `${id}-e`, outPath,
    doCutSilence: false, reframe, doCaptions: doCaptions !== false, captionStyle,
    colorLevel, punch, shake: false, film, progress, flash: false,
    voiceClean, smooth, normalize: true,
    preTranscript: pre, hookText: hookText || null,
    overlayText: overlayText || null, overlayPos: overlayPos || "bottom",
  });
  try { fs.unlinkSync(rough); } catch { /* dọn tạm */ }

  return {
    outPath, meta: r.meta,
    sourceStart: s, sourceEnd: e, duration: +(r.meta.duration || (e - s)).toFixed(2),
    segments: transcriptSegments(pre),
  };
}
