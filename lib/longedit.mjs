// 🎬 BIÊN TẬP VIDEO DÀI (YouTube) — bản thể ngang/vuông.
//  • Ghép NHIỀU video (hoặc 1 video dài) → biên tập thành video hoàn chỉnh.
//  • Khung 16:9 (1920x1080) hoặc 1:1 (1080x1080, có TIÊU ĐỀ TRÊN + TIÊU ĐỀ DƯỚI).
//  • Trám cảnh (b-roll), phụ đề động, color grade, làm mịn, khử tạp âm, nhạc nền tự lặp, watermark Mentor.
//  • CẮT THÔNG MINH: bỏ "à/ừ" + đoạn KHÔNG truyền tải tri thức (AI chọn phần đáng giữ).
//  • Giới hạn 10 phút/phần → dài hơn tự TÁCH nhiều phần.
//  • Tạo THUMBNAIL thương hiệu như video short.
import path from "node:path";
import fs from "node:fs";
import { run, WORK, __root, slug } from "./util.mjs";
import { FFMPEG, probe, detectSilences, hasNvenc, toSdrIfHdr } from "./ffmpeg.mjs";
import { transcribeWords, buildAssCaptions, saveAss, applyEditedText, transcriptSegments } from "./transcribe.mjs";
import { assFilter } from "./fonts.mjs";
import { colorGrade, manualColor, smoothFilter, filmLook, voiceCleanFilter, voiceEnhance, logoScaleFilter } from "./effects.mjs";
import { planClipCuts, remapTranscript } from "./fillers.mjs";
import { indexFolder, planBroll } from "./broll.mjs";
import { planAiBroll } from "./aibroll.mjs";
import { askClaude } from "./ai.mjs";
import { parseClips } from "./autoclip.mjs";
import { makeBrandThumb, pickPhoto } from "./thumbcard.mjs";
import { brandLogo, WM as BRAND_WM } from "./brand.mjs";
import { BRAND } from "./presets.mjs";
import { defaultCta } from "./cta.mjs";

const OUT = path.join(WORK, "out");
const FPS = 30;
const BAR_H = 176;                 // cao thanh tiêu đề (1:1)
const BAR_COLOR = "0xA8122D";      // đỏ Mentor

function dimsFor(aspect) { return aspect === "1:1" ? { W: 1080, H: 1080 } : { W: 1920, H: 1080 }; }
function encoder(useGpu) {
  return useGpu ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-b:v", "0"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
}
const fmtMS = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function parseMS(v) {
  if (typeof v === "number") return v;
  const m = String(v || "").match(/(\d+)\s*:\s*(\d+)/);
  if (m) return +m[1] * 60 + +m[2];
  const f = parseFloat(v); return isFinite(f) ? f : null;
}

// ---- Ghép + chuyển cảnh ----
async function concatVideos(inputs, out, onLog, transition = "cut", XF = 0.6, W = 1920, H = 1080, keySec = 0) {
  const args = ["-hide_banner", "-y"];
  for (const f of inputs) args.push("-i", f);
  const n = inputs.length, parts = [];
  inputs.forEach((f, i) => {
    parts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
    parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo:sample_rates=48000[a${i}]`);
  });
  let vOut = "[v0]", aOut = "[a0]";
  if (n > 1 && transition && transition !== "cut") {
    const durs = []; for (const f of inputs) durs.push((await probe(f)).duration || 0);
    let off = 0;
    for (let i = 1; i < n; i++) {
      off += (durs[i - 1] - XF);
      parts.push(`${vOut}[v${i}]xfade=transition=${transition}:duration=${XF}:offset=${Math.max(0, off).toFixed(3)}[vx${i}]`);
      parts.push(`${aOut}[a${i}]acrossfade=d=${XF}[ax${i}]`);
      vOut = `[vx${i}]`; aOut = `[ax${i}]`;
    }
  } else if (n > 1) {
    parts.push(`${inputs.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[v][a]`);
    vOut = "[v]"; aOut = "[a]";
  }
  const useGpu = await hasNvenc();
  const fk = keySec > 0 ? ["-force_key_frames", `expr:gte(t,n_forced*${keySec})`] : [];
  args.push("-filter_complex", parts.join(";"), "-map", vOut, "-map", aOut,
    ...encoder(useGpu), ...fk, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", out);
  await run(FFMPEG, args, { cwd: WORK, onLog: (l) => onLog("    " + l) });
  return out;
}

// ---- Cắt theo keep-ranges ----
async function cutByRanges(input, keep, out, onLog) {
  if (!keep || !keep.length) return input;
  const sel = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
  const useGpu = await hasNvenc();
  await run(FFMPEG, ["-hide_banner", "-y", "-i", input, "-filter_complex",
    // adeclick: xoá tiếng "tách/pop" ở mỗi mối nối sau khi bỏ đoạn chết → nghe liền mạch.
    `[0:v]select='${sel}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${sel}',asetpts=N/SR/TB,adeclick[a]`,
    "-map", "[v]", "-map", "[a]", "-c:v", useGpu ? "h264_nvenc" : "libx264", "-preset", useGpu ? "p4" : "veryfast",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", out], { cwd: WORK, onLog: (l) => onLog("  " + l) });
  return out;
}
function speechSegments(silences, dur, pad = 0.08) {
  const keep = []; let cur = 0;
  for (const s of silences) { const e = Math.max(cur, s.start - pad); if (e - cur > 0.15) keep.push([cur, e]); cur = Math.min(dur, s.end + pad); }
  if (dur - cur > 0.15) keep.push([cur, dur]);
  return keep.length ? keep : [[0, dur]];
}
async function cutSilence(input, id, onLog) {
  const meta = await probe(input);
  const sil = await detectSilences(input, -32, 0.4);
  if (!sil.length) return input;
  const segs = speechSegments(sil, meta.duration);
  onLog(`  giữ ${segs.length} đoạn có tiếng, bỏ ${sil.length} khoảng lặng`);
  return cutByRanges(input, segs, path.join(WORK, `${id}_cut.mp4`), onLog);
}

// ---- Cắt THÔNG MINH bằng AI: giữ đoạn TRI THỨC, bỏ chào hỏi/lan man/lạc đề/lặp ----
function chunkSegs(segments, maxChars = 6000) {
  const chunks = []; let cur = [], len = 0;
  for (const s of segments) { const line = `[${fmtMS(s.start)}] ${s.text}`; if (len + line.length > maxChars && cur.length) { chunks.push(cur); cur = []; len = 0; } cur.push(line); len += line.length + 1; }
  if (cur.length) chunks.push(cur);
  return chunks;
}
function buildKeepPrompt(linesText) {
  return `Đây là transcript CÓ MỐC THỜI GIAN [phút:giây] của một phần video${BRAND.name ? ` của ${BRAND.name}` : ""} (chủ đề: ${BRAND.niche}).
NHIỆM VỤ: chỉ ra các KHOẢNG THỜI GIAN CẦN GIỮ LẠI — những đoạn TRUYỀN TẢI TRI THỨC / giá trị thật cho người nghe.
LOẠI BỎ: chào hỏi xã giao, lan man, lạc đề, lặp lại, câu đệm vô nghĩa ("à, ừ, ờ, kiểu như..."), khoảng chết, câu dẫn dắt rườm rà.
Giữ mạch logic LIỀN LẠC (đừng cắt vụn giữa câu). Thà giữ trọn ý còn hơn cắt cụt.
TRANSCRIPT:
"""
${linesText}
"""
Trả về DUY NHẤT một mảng JSON hợp lệ (không giải thích, không markdown), mỗi phần tử là một khoảng CẦN GIỮ:
[{"start":"m:ss","end":"m:ss"}]
Nếu cả phần này đều đáng giữ, trả về một khoảng bao trọn. Nếu toàn chào hỏi/vô nghĩa, trả về [].`;
}
function mergeRanges(ranges) {
  const r = ranges.filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const cur of r) { if (out.length && cur[0] <= out[out.length - 1][1] + 0.25) out[out.length - 1][1] = Math.max(out[out.length - 1][1], cur[1]); else out.push([cur[0], cur[1]]); }
  return out;
}
// keepRanges trừ đi cutRanges (bỏ à/ừ + lặng nằm trong đoạn giữ)
function subtractIntervals(keep, cuts) {
  const c = mergeRanges(cuts.map((x) => [x[0], x[1]]));
  const out = [];
  for (let [a, b] of keep) {
    let segs = [[a, b]];
    for (const [cs, ce] of c) {
      const next = [];
      for (const [s, e] of segs) {
        if (ce <= s || cs >= e) { next.push([s, e]); continue; }
        if (cs > s) next.push([s, Math.min(cs, e)]);
        if (ce < e) next.push([Math.max(ce, s), e]);
      }
      segs = next;
    }
    for (const [s, e] of segs) if (e - s > 0.4) out.push([s, e]);
  }
  return out;
}
async function smartClean(src, dur, { model, lang, onLog, alsoFillers = true }) {
  onLog("→ Gõ chữ toàn bộ (cho cắt thông minh + phụ đề)...");
  const tr = await transcribeWords(src, { model, lang, onLog: (l) => onLog("  " + l) });
  const segs = tr.segments || [];
  if (!segs.length) throw new Error("Không nghe được lời trong video");
  onLog("→ AI chọn đoạn TRI THỨC cần giữ (bỏ chào hỏi/lan man)...");
  const chunks = chunkSegs(segs);
  let aiKeep = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const ans = await askClaude(buildKeepPrompt(chunks[i].join("\n")), { onLog: () => {}, cache: true });
      for (const r of parseClips(ans)) { const s = parseMS(r.start), e = parseMS(r.end); if (s != null && e != null && e > s) aiKeep.push([Math.max(0, s), Math.min(dur, e)]); }
    } catch (e) { onLog(`  ⚠ AI phần ${i + 1}: ${e.message}`); }
  }
  aiKeep = mergeRanges(aiKeep);
  if (!aiKeep.length) { onLog("  ⚠ AI không chốt được → giữ nguyên toàn bộ, chỉ bỏ đệm."); aiKeep = [[0, dur]]; }
  // bỏ à/ừ + khoảng chết trong các đoạn giữ
  let finalKeep = aiKeep;
  if (alsoFillers) {
    try { const { cuts } = planClipCuts(tr.words || [], 0, dur, { silenceMax: 0.5 }); finalKeep = subtractIntervals(aiKeep, cuts); }
    catch (e) { onLog("  ⚠ bỏ đệm lỗi: " + e.message); }
  }
  finalKeep = mergeRanges(finalKeep);
  const kept = finalKeep.reduce((s, [a, b]) => s + (b - a), 0);
  onLog(`  giữ ${finalKeep.length} đoạn tri thức (${Math.round(kept)}s / ${Math.round(dur)}s gốc).`);
  const cut = path.join(WORK, `smart_${Date.now()}.mp4`);
  await cutByRanges(src, finalKeep, cut, onLog);
  const pre = remapTranscript(tr.words || [], finalKeep, 0, dur);
  return { src: cut, pre, temp: cut };
}

// ---- Khung hình theo tỉ lệ (1:1 vẽ 2 thanh tiêu đề) ----
function buildFrame(aspect, reframe, W, H) {
  if (aspect === "1:1") {
    return `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,`
      + `drawbox=x=0:y=0:w=iw:h=${BAR_H}:color=${BAR_COLOR}@1:t=fill,`
      + `drawbox=x=0:y=${H - BAR_H}:w=iw:h=${BAR_H}:color=${BAR_COLOR}@1:t=fill`;
  }
  return (reframe === "fill"
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
    : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`) + `,setsar=1`;
}
// ASS 2 tiêu đề trên/dưới cho khung 1:1
function buildSquareTitleAss(top, bottom, { W = 1080, H = 1080 } = {}) {
  const esc = (t) => String(t || "").replace(/[{}\\]/g, "").replace(/["“”]/g, "").trim().toUpperCase();
  const t1 = esc(top), t2 = esc(bottom);
  if (!t1 && !t2) return null;
  const mv = Math.round((BAR_H - 62) / 2);
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TTop,Arial,62,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,8,50,50,${mv},1
Style: TBot,Arial,62,&H0000E5FF,&H0000E5FF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,50,50,${mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  const END = "9:59:59.00";
  if (t1) lines.push(`Dialogue: 0,0:00:00.00,${END},TTop,,0,0,0,,${t1}`);
  if (t2) lines.push(`Dialogue: 0,0:00:00.00,${END},TBot,,0,0,0,,${t2}`);
  return head + lines.join("\n") + "\n";
}
function brollNormalizeWH(kind, dur, start, W, H) {
  const fadeD = 0.15, fadeOut = Math.max(0, dur - fadeD).toFixed(3), c = [];
  if (kind === "video") c.push(`trim=0:${dur.toFixed(3)}`, "setpts=PTS-STARTPTS", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, `fps=${FPS}`);
  else c.push(`scale=${Math.round(W * 1.12)}:${Math.round(H * 1.12)}`, `zoompan=z='min(1.12\\,1.001+0.0014*on)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}`);
  c.push("format=yuva420p", `fade=t=in:st=0:d=${fadeD}:alpha=1`, `fade=t=out:st=${fadeOut}:d=${fadeD}:alpha=1`, `setpts=PTS-STARTPTS+${start.toFixed(3)}/TB`);
  return c.join(",");
}

// ---- Tách phần nếu > maxSec (re-encode từng phần → cắt chính xác, không phụ thuộc keyframe) ----
async function splitParts(input, maxSec, outBase, onLog) {
  const meta = await probe(input);
  if (meta.duration <= maxSec + 2) return [input];
  const n = Math.ceil(meta.duration / maxSec);
  onLog(`→ Video ${Math.round(meta.duration)}s > ${(maxSec / 60).toFixed(0)} phút → TÁCH thành ${n} phần...`);
  const useGpu = await hasNvenc();
  const parts = [];
  for (let i = 0; i < n; i++) {
    const ss = i * maxSec;
    const out = `${outBase}-phan${String(i + 1).padStart(2, "0")}.mp4`;
    onLog(`  phần ${i + 1}/${n} (${fmtMS(ss)}–${fmtMS(Math.min(meta.duration, ss + maxSec))})...`);
    await run(FFMPEG, ["-hide_banner", "-y", "-ss", ss.toFixed(2), "-i", input, "-t", maxSec.toFixed(2),
      ...encoder(useGpu), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out],
      { cwd: WORK, onLog: (l) => onLog("    " + l) });
    parts.push(out);
  }
  try { fs.unlinkSync(input); } catch { /* dọn bản gộp */ }
  return parts;
}

// ================= HÀM CHÍNH =================
export async function longEdit(inputs, opts = {}) {
  const {
    onLog = () => {}, id = "long", outPath,
    aspect = "16:9", reframe = "fit", titleTop = "", titleBottom = "",
    removeFillers = false, doCutSilence = true, smartPrune = false,
    doCaptions = true, captionStyle = "karaoke",
    colorLevel = "off", manual = null, smooth = "off", film = false,
    voiceClean = "off", musicPath = null, musicVol = 0.14, normalize = true,
    watermark = true, model = "medium", lang = "vi",
    transition = "cut", introPath = null, outroPath = null, cta = true,
    brollFolder = null, brollFill = "match",
    aiBroll = false, aiBrollCount = 6, aiBrollStyle = "điện ảnh, ánh sáng đẹp, chân thực",
    makeThumb = false, thumbPhotoDir = null, thumbTitle = "", thumbName = BRAND.name,
    maxMinutes = 10,
    editedSegments = null,   // phụ đề sửa tay (từ khối "Sửa phụ đề" trên phần kết quả)
  } = opts;

  if (!inputs || !inputs.length) throw new Error("Chưa có video đầu vào");
  for (const f of inputs) if (!fs.existsSync(f)) throw new Error("Không thấy file: " + f);
  // 🎨 Nguồn HDR (iPhone) → SDR trước khi ghép/dựng để màu không bạc.
  inputs = await Promise.all(inputs.map((f, i) => toSdrIfHdr(f, path.join(WORK, `${id}-sdr${i}.mp4`), { onLog })));
  const { W, H } = dimsFor(aspect);
  onLog(`=== BIÊN TẬP VIDEO DÀI (${aspect}) ===`);
  const temps = [];

  // 1) Ghép input (work res 1920x1080)
  let src = inputs[0];
  if (inputs.length > 1) {
    src = path.join(WORK, `${id}_concat.mp4`); temps.push(src);
    onLog(`→ Ghép ${inputs.length} video${transition !== "cut" ? ` (chuyển cảnh ${transition})` : ""}...`);
    await concatVideos(inputs, src, onLog, transition, 0.6, 1920, 1080);
  }
  let meta0 = await probe(src);
  onLog(`Tổng thời lượng gốc: ${Math.round(meta0.duration)}s (${(meta0.duration / 60).toFixed(1)} phút).`);

  // 2) Làm sạch nội dung
  let pre = null;
  if (smartPrune) {
    try { const r = await smartClean(src, meta0.duration, { model, lang, onLog }); src = r.src; pre = r.pre; temps.push(r.temp); }
    catch (e) { onLog("  ⚠ cắt thông minh lỗi (" + e.message + ") → cắt lặng thường"); if (doCutSilence) { const c = await cutSilence(src, id, onLog); if (c !== src) temps.push(c); src = c; } }
  } else if (removeFillers) {
    onLog("→ Gõ chữ + cắt bỏ tiếng đệm (à/ừ) & khoảng chết...");
    try {
      const tr = await transcribeWords(src, { model, lang, onLog: (l) => onLog("  " + l) });
      const { keep, cuts } = planClipCuts(tr.words || [], 0, meta0.duration, { silenceMax: 0.6 });
      onLog(`  bỏ ${cuts.length} đoạn, giữ ${keep.length} mảnh`);
      const cut = path.join(WORK, `${id}_cut.mp4`); temps.push(cut);
      await cutByRanges(src, keep, cut, onLog); pre = remapTranscript(tr.words || [], keep, 0, meta0.duration); src = cut;
    } catch (e) { onLog("  ⚠ " + e.message); if (doCutSilence) { const c = await cutSilence(src, id, onLog); if (c !== src) temps.push(c); src = c; } }
  } else if (doCutSilence) {
    onLog("→ Cắt khoảng lặng chết..."); const c = await cutSilence(src, id, onLog); if (c !== src) temps.push(c); src = c;
  }

  // 3) Transcript cho phụ đề
  let capTr = (pre && (pre.words || []).length) ? pre : null;
  if (doCaptions && !capTr) {
    onLog("→ Gõ chữ word-level cho phụ đề...");
    try { capTr = await transcribeWords(src, { model, lang, onLog: (l) => onLog("  " + l) }); } catch (e) { onLog("  ⚠ whisper: " + e.message); }
  }
  // ✍️ Áp phụ đề đã sửa tay (nếu có).
  if (editedSegments && capTr && (capTr.words || []).length) {
    capTr = applyEditedText(capTr, editedSegments);
    onLog("  ✍️ đã áp phụ đề sửa tay");
  }
  let assFile = null;
  if (doCaptions && capTr && (capTr.words || []).length) {
    const marginV = aspect === "1:1" ? BAR_H + 24 : 66;
    const fontSize = aspect === "1:1" ? 50 : 58;
    const ass = buildAssCaptions(capTr, { videoW: W, videoH: H, fontSize, marginV, style: captionStyle });
    assFile = path.join(WORK, `${id}.ass`); saveAss(ass, assFile); temps.push(assFile);
  }

  // 4) B-roll plan — 🤖 AI tự tạo (phân tích lời → sinh cảnh minh hoạ) HOẶC từ thư mục.
  let plan = [];
  if (aiBroll && capTr) {
    onLog("→ 🤖 Trám b-roll AI: phân tích lời nói → tạo cảnh minh hoạ (Higgsfield)...");
    try { plan = await planAiBroll(capTr, { count: aiBrollCount, style: aiBrollStyle, id, onLog: (l) => onLog("  " + l) }); }
    catch (e) { onLog("  ⚠ b-roll AI lỗi: " + e.message); plan = []; }
    onLog(`  chèn ${plan.length} cảnh AI`);
  } else if (brollFolder && capTr) {
    onLog("→ Trám b-roll từ thư mục theo lời nói...");
    const lib = await indexFolder(brollFolder);
    onLog(`  thư viện: ${lib.length} file`);
    plan = planBroll(capTr, lib, { fillMode: brollFill, folder: brollFolder });
    onLog(`  chèn ${plan.length} cảnh (${plan.filter((p) => p.matched).length} khớp từ khóa)`);
  }

  // Tiêu đề 1:1
  let titleFile = null;
  if (aspect === "1:1") {
    const ta = buildSquareTitleAss(titleTop, titleBottom, { W, H });
    if (ta) { titleFile = path.join(WORK, `${id}.title.ass`); saveAss(ta, titleFile); temps.push(titleFile); }
  }
  const wm = watermark ? await brandLogo() : null;

  // Chuỗi màu/hiệu ứng
  const post = [];
  const sm = smoothFilter(smooth); if (sm) post.push(sm);
  const cg = (colorLevel && colorLevel !== "off") ? colorGrade(colorLevel) : null; if (cg) post.push(cg);
  const mc = manualColor(manual || {}); if (mc) post.push(mc);
  const fl = film ? filmLook({ vignette: true, grain: 5 }) : null; if (fl) post.push(fl);
  const frame = buildFrame(aspect, reframe, W, H);
  const mainGraph = `[0:v]yadif=0:-1:0,fps=${FPS},${frame}${post.length ? "," + post.join(",") : ""}[styled]`;

  // 5) Dựng — 1 lượt (không b-roll) hoặc 2 lượt (có b-roll)
  // CTA cuối video: nếu không có outro riêng → dùng CTA mặc định (assets/cta.mp4) làm outro.
  const outro = outroPath || (cta ? defaultCta() : null);
  const hasWrap = (introPath && fs.existsSync(introPath)) || (outro && fs.existsSync(outro));
  const preSplit = path.join(WORK, `${id}_full.mp4`); temps.push(preSplit);
  const mainOut = hasWrap ? path.join(WORK, `${id}_main.mp4`) : preSplit;

  const useGpu = await hasNvenc();
  const keySec = Math.max(60, maxMinutes * 60);
  async function renderOverlays(baseFile, baseIsStyled, forceKey) {
    const args = ["-hide_banner", "-y", "-i", baseFile];
    let complex = baseIsStyled ? "[0:v]null[styled]" : mainGraph;
    let v = "[styled]", idx = 1;
    plan.forEach((p, i) => {
      if (p.kind === "image") args.push("-loop", "1", "-t", String(p.dur), "-i", p.file); else args.push("-i", p.file);
      const inIdx = idx++;
      complex += `;[${inIdx}:v]${brollNormalizeWH(p.kind, p.dur, p.start, W, H)}[b${i}]`;
      const s = p.start.toFixed(3), e = (p.start + p.dur).toFixed(3);
      complex += `;${v}[b${i}]overlay=0:0:eof_action=pass:enable='between(t,${s},${e})'[ov${i}]`; v = `[ov${i}]`;
    });
    if (assFile) { complex += `;${v}${assFilter(path.basename(assFile))}[vs]`; v = "[vs]"; }
    if (titleFile) { complex += `;${v}${assFilter(path.basename(titleFile))}[vt]`; v = "[vt]"; }
    if (wm) { const _m = Math.round(BRAND_WM.marginFrac * W); args.push("-loop", "1", "-i", wm); const wIdx = idx++; complex += `;[${wIdx}:v]${logoScaleFilter({ scale: BRAND_WM.scale, opacity: 0.95, targetW: W })}[wm];${v}[wm]overlay=${_m}:${_m}:shortest=1[vw]`; v = "[vw]"; }
    // audio
    let musicIdx = null;
    if (musicPath && fs.existsSync(musicPath)) { args.push("-i", musicPath); musicIdx = idx++; }
    let a = "[0:a]", aGraph = "";
    const vc = voiceCleanFilter(voiceClean); if (vc) { aGraph += `${a}${vc}[vc]`; a = "[vc]"; }
    const ve = voiceEnhance(voiceClean === "studio" ? "studio" : "medium"); if (ve) { aGraph += `${aGraph ? ";" : ""}${a}${ve}[ve]`; a = "[ve]"; }
    if (musicIdx != null) {
      aGraph += `${aGraph ? ";" : ""}[${musicIdx}:a]volume=${musicVol},aloop=loop=-1:size=2e9,aformat=channel_layouts=stereo:sample_rates=48000[mus];`
        + `[mus]${a}sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[mduck];${a}[mduck]amix=inputs=2:normalize=0:duration=first[amx]`; a = "[amx]";
    }
    let aOut = a === "[0:a]" ? "0:a" : a;
    if (normalize) { aGraph += `${aGraph ? ";" : ""}${a}loudnorm=I=-14:TP=-1.5:LRA=11[aout]`; aOut = "[aout]"; }
    if (aGraph) complex += ";" + aGraph;
    const fk = forceKey ? ["-force_key_frames", `expr:gte(t,n_forced*${keySec})`] : [];
    args.push("-filter_complex", complex, "-map", v, "-map", aOut, "-r", String(FPS), ...encoder(useGpu), ...fk,
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", mainOut);
    await run(FFMPEG, args, { cwd: WORK, onLog: (l) => onLog("  " + l) });
  }

  if (!plan.length) {
    onLog("→ Dựng video (1 lượt)...");
    await renderOverlays(src, false, !hasWrap);
  } else {
    onLog("→ Dựng nền (grade/khung) → xuất tạm...");
    const styled = path.join(WORK, `${id}_styled.mp4`); temps.push(styled);
    await run(FFMPEG, ["-hide_banner", "-y", "-i", src, "-filter_complex", mainGraph, "-map", "[styled]", "-map", "0:a",
      "-r", String(FPS), ...encoder(useGpu), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", styled], { cwd: WORK, onLog: (l) => onLog("  " + l) });
    onLog("→ Chèn b-roll + phụ đề + logo → xuất...");
    await renderOverlays(styled, true, !hasWrap);
  }

  // 6) Intro/outro (bọc quanh, cùng tỉ lệ)
  if (hasWrap) {
    const seq = [];
    if (introPath && fs.existsSync(introPath)) seq.push(introPath);
    seq.push(mainOut);
    if (outro && fs.existsSync(outro)) seq.push(outro);
    temps.push(mainOut);
    onLog(`→ Ghép intro/outro (${seq.length} phần)...`);
    await concatVideos(seq, preSplit, onLog, transition, 0.6, W, H, keySec);
  }

  // 7) Tách nếu > maxMinutes
  const base = outPath.replace(/\.mp4$/, "");
  const partFiles = await splitParts(preSplit, Math.max(60, maxMinutes * 60), base, onLog);
  // đổi tên nếu chỉ 1 phần
  let finals = partFiles;
  if (partFiles.length === 1 && partFiles[0] !== outPath) { try { fs.renameSync(partFiles[0], outPath); finals = [outPath]; } catch { finals = partFiles; } }

  // 8) Thumbnail thương hiệu cho từng phần
  const parts = [];
  for (let i = 0; i < finals.length; i++) {
    const f = finals[i];
    const meta = await probe(f);
    let thumbPath = null;
    if (makeThumb && thumbPhotoDir) {
      try {
        const ttl = (thumbTitle || titleTop || titleBottom || "Video").trim() + (finals.length > 1 ? ` (Phần ${i + 1})` : "");
        const photo = pickPhoto(thumbPhotoDir, ttl);
        if (photo) { thumbPath = f.replace(/\.mp4$/, "-thumb.png"); await makeBrandThumb(photo, ttl, thumbPath, { name: thumbName, id: `${id}-t${i}`, onLog }); }
      } catch (e) { onLog("  ⚠ thumbnail lỗi: " + e.message); thumbPath = null; }
    }
    parts.push({ outPath: f, meta, thumbPath });
  }

  for (const t of temps) { try { if (fs.existsSync(t)) fs.unlinkSync(t); } catch { /* dọn */ } }
  onLog(`=== XONG: ${parts.length} phần, ${W}x${H} ===`);
  const transcriptText = capTr ? (capTr.segments || []).map((s) => s.text).join(" ").trim() : "";
  return { aspect, parts, transcriptText, segments: transcriptSegments(capTr) };
}
