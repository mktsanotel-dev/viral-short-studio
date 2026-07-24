// 🎙️ SHORT LỒNG VOICE — ghép NHIỀU video short ngắn thành 1 short 9:16, LỒNG GIỌNG ĐỌC (voice-over).
// Voice-over là AUDIO CHÍNH & là timeline: phụ đề bám theo voice, video ghép LẶP/CẮT cho khớp độ dài voice.
// Tính năng như short viral: reframe 9:16, trám b-roll theo lời voice, color grade, hook, nhạc nền, watermark.
import path from "node:path";
import fs from "node:fs";
import { run, WORK, __root } from "./util.mjs";
import { FFMPEG, probe, hasNvenc, toSdrIfHdr } from "./ffmpeg.mjs";
import { transcribeWords, buildAssCaptions, saveAss, buildHookAss, applyEditedText, transcriptSegments } from "./transcribe.mjs";
import { assFilter } from "./fonts.mjs";
import { colorGrade, manualColor, smoothFilter, filmLook, progressBar, brollNormalize, logoScaleFilter, voiceEnhance, voiceCleanFilter } from "./effects.mjs";
import { indexFolder, planBroll } from "./broll.mjs";

const OUT = path.join(WORK, "out");
const TW = 1080, TH = 1920, FPS = 30;

import { brandLogo, WM as BRAND_WM } from "./brand.mjs";
import { appendCta, defaultCta } from "./cta.mjs";
function encoder(useGpu) {
  return useGpu ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-b:v", "0"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
}

// Ghép nhiều clip → 1 video 9:16 (1080x1920, cắt đầy). transition!="cut" → xfade.
async function concat9(clips, out, onLog, transition = "cut", XF = 0.4) {
  const args = ["-hide_banner", "-y"];
  for (const f of clips) args.push("-i", f);
  const n = clips.length, parts = [];
  clips.forEach((f, i) => {
    parts.push(`[${i}:v]scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH},setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
    parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo:sample_rates=48000[a${i}]`);
  });
  let vOut = "[v0]", aOut = "[a0]";
  if (n > 1 && transition && transition !== "cut") {
    const durs = []; for (const f of clips) durs.push((await probe(f)).duration || 0);
    let off = 0;
    for (let i = 1; i < n; i++) {
      off += (durs[i - 1] - XF);
      parts.push(`${vOut}[v${i}]xfade=transition=${transition}:duration=${XF}:offset=${Math.max(0, off).toFixed(3)}[vx${i}]`);
      parts.push(`${aOut}[a${i}]acrossfade=d=${XF}[ax${i}]`);
      vOut = `[vx${i}]`; aOut = `[ax${i}]`;
    }
  } else if (n > 1) {
    parts.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[v][a]`);
    vOut = "[v]"; aOut = "[a]";
  }
  const useGpu = await hasNvenc();
  args.push("-filter_complex", parts.join(";"), "-map", vOut, "-map", aOut,
    ...encoder(useGpu), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", out);
  await run(FFMPEG, args, { cwd: WORK, onLog: (l) => onLog("    " + l) });
  return out;
}

// ================= HÀM CHÍNH =================
// clips: mảng đường dẫn video (hình ảnh/bối cảnh). voicePath: file giọng đọc (mp3/wav/m4a).
export async function voiceShort(clips, voicePath, opts = {}) {
  const {
    onLog = () => {}, id = "vs", outPath,
    voiceVol = 1.0, musicPath = null, musicVol = 0.12, normalize = true,
    voiceClean = "studio",   // 🎚️ khử ồn + đánh bóng giọng (như thu phòng)
    colorLevel = "off", manual = null, smooth = "off", film = false,
    doCaptions = true, captionStyle = "karaoke", hookText = null, progress = false,
    brollFolder = null, brollFill = "match", watermark = true,
    transition = "cut", model = "medium", lang = "vi", cta = true, ctaPath = null,
    editedSegments = null,   // ✍️ phụ đề đã sửa tay
  } = opts;

  if (!clips || !clips.length) throw new Error("Chưa có video bối cảnh");
  for (const f of clips) if (!fs.existsSync(f)) throw new Error("Không thấy file: " + f);
  // 🎨 Nguồn HDR (iPhone) → SDR trước khi ghép để màu không bạc.
  clips = await Promise.all(clips.map((c, i) => toSdrIfHdr(c, path.join(WORK, `${id}-sdr${i}.mp4`), { onLog })));
  if (!voicePath || !fs.existsSync(voicePath)) throw new Error("Chưa có file giọng đọc (voice)");

  onLog("=== SHORT LỒNG VOICE (9:16) ===");
  const temps = [];
  const vmeta = await probe(voicePath);
  const Dvoice = vmeta.duration || 1;
  onLog(`Giọng đọc dài ${Dvoice.toFixed(1)}s → video sẽ khớp đúng độ dài này.`);

  // 1) Ghép các clip bối cảnh → base 9:16
  let base = clips[0];
  if (clips.length > 1) {
    base = path.join(WORK, `${id}_base.mp4`); temps.push(base);
    onLog(`→ Ghép ${clips.length} clip bối cảnh${transition !== "cut" ? ` (chuyển cảnh ${transition})` : ""}...`);
    await concat9(clips, base, onLog, transition);
  } else {
    // 1 clip: chuẩn hoá về 9:16
    base = path.join(WORK, `${id}_base.mp4`); temps.push(base);
    await concat9([clips[0]], base, onLog, "cut");
  }

  // 2) Gõ chữ GIỌNG ĐỌC (voice) → phụ đề + trám b-roll bám theo voice
  let voiceTr = null;
  if (doCaptions || brollFolder) {
    onLog("→ Gõ chữ giọng đọc (voice) cho phụ đề + b-roll...");
    try { voiceTr = await transcribeWords(voicePath, { model, lang, onLog: (l) => onLog("  " + l) }); }
    catch (e) { onLog("  ⚠ whisper voice lỗi: " + e.message); }
  }
  // ✍️ Áp phụ đề đã sửa tay (nếu có).
  if (editedSegments && voiceTr && (voiceTr.words || []).length) {
    voiceTr = applyEditedText(voiceTr, editedSegments);
    onLog("  ✍️ đã áp phụ đề sửa tay");
  }
  let assFile = null;
  if (doCaptions && voiceTr && (voiceTr.words || []).length) {
    const ass = buildAssCaptions(voiceTr, { videoW: TW, videoH: TH, style: captionStyle });
    assFile = path.join(WORK, `${id}.ass`); saveAss(ass, assFile); temps.push(assFile);
  }

  // 3) B-roll plan theo lời voice
  let plan = [];
  if (brollFolder && voiceTr) {
    onLog("→ Trám b-roll theo lời giọng đọc...");
    const lib = await indexFolder(brollFolder);
    onLog(`  thư viện: ${lib.length} file`);
    plan = planBroll(voiceTr, lib, { fillMode: brollFill, folder: brollFolder });
    onLog(`  chèn ${plan.length} cảnh (${plan.filter((p) => p.matched).length} khớp từ khóa)`);
  }

  // Hook chữ to đầu video
  let hookFile = null;
  if (hookText && String(hookText).trim()) {
    const ha = buildHookAss(hookText, { videoW: TW, videoH: TH, dur: Math.min(Dvoice, 3.0) });
    if (ha) { hookFile = path.join(WORK, `${id}.hook.ass`); saveAss(ha, hookFile); temps.push(hookFile); }
  }
  const wm = watermark ? await brandLogo() : null;

  // 4) Dựng: video LẶP cho đủ Dvoice + grade + b-roll + phụ đề + hook + watermark; AUDIO = voice + nhạc
  const post = [];
  const sm = smoothFilter(smooth); if (sm) post.push(sm);
  const cg = (colorLevel && colorLevel !== "off") ? colorGrade(colorLevel) : null; if (cg) post.push(cg);
  const mc = manualColor(manual || {}); if (mc) post.push(mc);
  const fl = film ? filmLook({ vignette: true, grain: 5 }) : null; if (fl) post.push(fl);

  const useGpu = await hasNvenc();
  // input0 = base (LẶP vô hạn), input1 = voice
  const args = ["-hide_banner", "-y", "-stream_loop", "-1", "-i", base, "-i", voicePath];
  let complex = `[0:v]fps=${FPS}${post.length ? "," + post.join(",") : ""}[styled]`;
  let v = "[styled]", idx = 2;
  plan.forEach((p, i) => {
    if (p.kind === "image") args.push("-loop", "1", "-t", String(p.dur), "-i", p.file); else args.push("-i", p.file);
    const inIdx = idx++;
    complex += `;[${inIdx}:v]${brollNormalize({ kind: p.kind, dur: p.dur, start: p.start })}[b${i}]`;
    const s = p.start.toFixed(3), e = (p.start + p.dur).toFixed(3);
    complex += `;${v}[b${i}]overlay=0:0:eof_action=pass:enable='between(t,${s},${e})'[ov${i}]`; v = `[ov${i}]`;
  });
  if (assFile) { complex += `;${v}${assFilter(path.basename(assFile))}[vsub]`; v = "[vsub]"; }
  if (hookFile) { complex += `;${v}${assFilter(path.basename(hookFile))}[vh]`; v = "[vh]"; }
  if (progress) { complex += `;${v}${progressBar(Dvoice)}[vp]`; v = "[vp]"; }
  if (wm) { const _m = Math.round(BRAND_WM.marginFrac * TW); args.push("-loop", "1", "-i", wm); const wIdx = idx++; complex += `;[${wIdx}:v]${logoScaleFilter({ scale: BRAND_WM.scale, opacity: 0.95, targetW: TW })}[wm];${v}[wm]overlay=${_m}:${_m}:shortest=1[vw]`; v = "[vw]"; }

  // Audio: giọng đọc (input1) → KHỬ ỒN → ĐÁNH BÓNG (studio) → + nhạc nền (tự lặp, ducking) + chuẩn âm
  const _vc = voiceCleanFilter(voiceClean);
  const _ve = voiceEnhance(voiceClean === "studio" ? "studio" : "medium");
  let a = "[1:a]", aGraph = `[1:a]volume=${voiceVol.toFixed(2)}${_vc ? "," + _vc : ""}${_ve ? "," + _ve : ""},aformat=channel_layouts=stereo:sample_rates=48000[vv]`; a = "[vv]";
  let musicIdx = null;
  if (musicPath && fs.existsSync(musicPath)) { args.push("-i", musicPath); musicIdx = idx++; }
  if (musicIdx != null) {
    aGraph += `;[${musicIdx}:a]volume=${musicVol},aloop=loop=-1:size=2e9,aformat=channel_layouts=stereo:sample_rates=48000[mus];`
      + `[mus]${a}sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[mduck];${a}[mduck]amix=inputs=2:normalize=0:duration=first[amx]`; a = "[amx]";
  }
  let aOut = a;
  if (normalize) { aGraph += `;${a}loudnorm=I=-14:TP=-1.5:LRA=11[aout]`; aOut = "[aout]"; }
  complex += ";" + aGraph;

  args.push("-filter_complex", complex, "-map", v, "-map", aOut, "-t", Dvoice.toFixed(3), "-r", String(FPS),
    ...encoder(useGpu), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", outPath);
  onLog(`→ Dựng short lồng voice (${plan.length ? plan.length + " b-roll, " : ""}khớp ${Dvoice.toFixed(1)}s)...`);
  await run(FFMPEG, args, { cwd: WORK, onLog: (l) => onLog("  " + l) });

  // CTA cuối video (mọi video phải có CTA)
  const ctaFinal = cta ? (ctaPath || defaultCta()) : null;
  if (ctaFinal) {
    const pre = outPath.replace(/\.mp4$/, "_precta.mp4");
    try { fs.renameSync(outPath, pre); await appendCta(pre, ctaFinal, outPath, { W: TW, H: TH, captions: doCaptions, cutFillers: true, captionStyle, model, lang, onLog }); fs.unlinkSync(pre); }
    catch (e) { onLog("  ⚠ ghép CTA lỗi: " + e.message); if (fs.existsSync(pre) && !fs.existsSync(outPath)) fs.renameSync(pre, outPath); }
  }

  for (const t of temps) { try { if (fs.existsSync(t)) fs.unlinkSync(t); } catch { /* dọn */ } }
  const meta = await probe(outPath);
  onLog(`=== XONG: ${meta.width}x${meta.height}, ${Math.round(meta.duration)}s ===`);
  const transcriptText = voiceTr ? (voiceTr.segments || []).map((s) => s.text).join(" ").trim() : "";
  return { outPath, meta, transcriptText, segments: transcriptSegments(voiceTr) };
}
