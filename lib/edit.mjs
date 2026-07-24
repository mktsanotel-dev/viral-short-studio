// Pipeline dàn dựng lại video short thành bản viral đặc sắc:
// cắt lặng/bỏ đệm → grade + chỉnh màu tay → chuyển động + punch-zoom → TRÁM B-ROLL (thư mục/AI)
// → phụ đề → flash/slide chuyển cảnh → SFX whoosh → logo → progress bar → nhạc + chuẩn âm.
import path from "node:path";
import fs from "node:fs";
import { run, WORK, __root } from "./util.mjs";
import { brandLogo, WM as BRAND_WM } from "./brand.mjs";
import { appendCta, defaultCta } from "./cta.mjs";
import { FFMPEG, probe, detectSilences, detectScenes, hasNvenc, toSdrIfHdr } from "./ffmpeg.mjs";
import { transcribeWords, buildAssCaptions, saveAss, buildHookAss, buildOverlayAss, applyEditedText, transcriptSegments } from "./transcribe.mjs";
import { assFilter } from "./fonts.mjs";
import { colorGrade, manualColor, motionZoompan, filmLook, progressBar, brollNormalize, flashEnable, logoScaleFilter, logoPosition, logoPositionXY, smoothFilter, voiceCleanFilter, voiceEnhance } from "./effects.mjs";
import { indexFolder, planBroll } from "./broll.mjs";
import { planClipCuts, remapTranscript } from "./fillers.mjs";
import { ensureWhoosh } from "./sfx.mjs";
import { planAiBroll } from "./aibroll.mjs";

const TARGET_W = 1080, TARGET_H = 1920, FPS = 30;

function speechSegments(silences, dur, pad = 0.08) {
  const keep = [];
  let cursor = 0;
  for (const s of silences) {
    const segEnd = Math.max(cursor, s.start - pad);
    if (segEnd - cursor > 0.15) keep.push([cursor, segEnd]);
    cursor = Math.min(dur, s.end + pad);
  }
  if (dur - cursor > 0.15) keep.push([cursor, dur]);
  return keep.length ? keep : [[0, dur]];
}

// Cắt video theo danh sách khoảng GIỮ LẠI.
async function cutByRanges(input, keep, out, onLog) {
  if (!keep || !keep.length) return input;
  const sel = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
  const useGpu = await hasNvenc();
  await run(FFMPEG, [
    "-hide_banner", "-y", "-i", input,
    "-filter_complex",
    // adeclick: xoá tiếng "tách/pop" ở mỗi mối nối sau khi bỏ đoạn chết → nghe liền mạch.
    `[0:v]select='${sel}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${sel}',asetpts=N/SR/TB,adeclick[a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", useGpu ? "h264_nvenc" : "libx264", "-preset", useGpu ? "p4" : "veryfast",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", out,
  ], { onLog: (l) => onLog("  " + l) });
  return out;
}

// Cắt CHỈ khoảng lặng (khi không có transcript). Mạnh tay hơn: -32dB, 0.35s.
async function cutSilence(input, id, { onLog }) {
  const meta = await probe(input);
  const silences = await detectSilences(input, -32, 0.35);
  if (!silences.length) { onLog("  (không có khoảng lặng đáng kể — bỏ qua)"); return input; }
  const segs = speechSegments(silences, meta.duration);
  onLog(`  giữ ${segs.length} đoạn có tiếng, bỏ ${silences.length} khoảng lặng`);
  return cutByRanges(input, segs, path.join(WORK, `${id}_cut.mp4`), onLog);
}

// Chuỗi filter "dựng nền chính": khử interlace → reframe 9:16 → grade → chỉnh màu tay → chuyển động → film.
function buildMainGraph({ reframe, colorLevel, manual, smooth, punch, shake, film, sceneCuts }) {
  let graph = `[0:v]yadif=0:-1:0,fps=30,setpts=PTS-STARTPTS[dei];`;
  if (reframe === "blur") {
    graph +=
      `[dei]split=2[bg][fg];` +
      `[bg]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H},gblur=sigma=22[bgb];` +
      `[fg]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2[r];`;
  } else if (reframe === "fill") {
    graph += `[dei]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H}[r];`;
  } else {
    graph += `[dei]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2[r];`;
  }
  const post = [];
  // Làm mịn TRƯỚC grade (khử nhiễu rồi mới tăng tương phản/nét)
  const sm = smooth && smooth !== "off" ? smoothFilter(smooth) : null;
  if (sm) post.push(sm);
  const cg = colorLevel && colorLevel !== "off" ? colorGrade(colorLevel) : null;
  if (cg) post.push(cg);
  const mc = manualColor(manual || {});
  if (mc) post.push(mc);
  if (punch || shake) post.push(motionZoompan({ sceneCuts, shake, punch }));
  const fl = film ? filmLook({ vignette: true, grain: 6 }) : null;
  if (fl) post.push(fl);
  graph += `[r]${post.length ? post.join(",") : "null"}[mv]`;
  return { graph, out: "[mv]" };
}

// Nhánh audio: (giữ giọng/khử tạp âm) → nhạc ducking + SFX whoosh + chuẩn âm.
function buildAudioFull({ base, musicIdx, musicPath, musicVol, sfxItems, sfxVol, normalize, voiceClean }) {
  let graph = "";
  // KHỬ ỒN giọng TRƯỚC, rồi ĐÁNH BÓNG (làm rõ / studio) — bám theo mức khử ồn đã chọn.
  let src = base;
  const vc = voiceCleanFilter(voiceClean);
  if (vc) { graph += `${base}${vc}[vc]`; src = "[vc]"; }
  const ve = voiceEnhance(voiceClean === "studio" ? "studio" : "medium");
  if (ve) { graph += `${graph ? ";" : ""}${src}${ve}[ve]`; src = "[ve]"; }
  let cur = src;
  if (musicPath && musicIdx != null) {
    graph += `${graph ? ";" : ""}` +
      `[${musicIdx}:a]volume=${musicVol},aloop=loop=-1:size=2e9[mloop];` +
      `[mloop]${src}sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[mduck];` +
      `${src}[mduck]amix=inputs=2:normalize=0:duration=first[amx]`;
    cur = "[amx]";
  }
  if (sfxItems && sfxItems.length) {
    const labels = [];
    sfxItems.forEach((s, i) => {
      const ms = Math.max(0, Math.round(s.t * 1000));
      graph += `${graph ? ";" : ""}[${s.idx}:a]adelay=${ms}|${ms},volume=${sfxVol}[sx${i}]`;
      labels.push(`[sx${i}]`);
    });
    graph += `;${cur}${labels.join("")}amix=inputs=${1 + labels.length}:normalize=0:duration=first[amx2]`;
    cur = "[amx2]";
  }
  let aOut = cur === "[0:a]" ? "0:a" : cur;
  if (normalize) {
    graph += `${graph ? ";" : ""}${cur}loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
    aOut = "[aout]";
  }
  return { audioGraph: graph, aOut };
}

// Render cuối: chèn b-roll + flash + phụ đề + hook + logo + progress + audio.
async function renderFinal(o) {
  const {
    baseFile, mainGraph, mainOut, plan = [], brollTransition = "fade",
    flashExpr, assFile, hookFile, overlayFile, progress, styledDur,
    logo, watermarkPath, sfxFile, sfxTimes = [], sfxVol = 0.6,
    musicPath, musicVol, normalize, voiceClean, encV, outPath, onLog,
  } = o;

  const args = ["-hide_banner", "-y", "-i", baseFile];
  let complex, v;
  if (mainGraph) { complex = mainGraph; v = mainOut; }
  else { complex = `[0:v]null[base0]`; v = "[base0]"; }

  let idx = 1;
  plan.forEach((p, i) => {
    if (p.kind === "image") args.push("-loop", "1", "-t", String(p.dur), "-i", p.file);
    else args.push("-i", p.file);
    const inIdx = idx++;
    complex += `;[${inIdx}:v]${brollNormalize({ kind: p.kind, dur: p.dur, start: p.start })}[b${i}]`;
    const s = p.start.toFixed(3), e = (p.start + p.dur).toFixed(3);
    const xexpr = brollTransition === "slide"
      ? `x='if(between(t,${s},${(p.start + 0.25).toFixed(3)}),(1-(t-${s})/0.25)*W,0)'`
      : "x=0";
    complex += `;${v}[b${i}]overlay=${xexpr}:y=0:eof_action=pass:enable='between(t,${s},${e})'[ov${i}]`;
    v = `[ov${i}]`;
  });

  if (flashExpr) { complex += `;${v}drawbox=x=0:y=0:w=iw:h=ih:color=white@0.5:t=fill:enable='${flashExpr}'[vf]`; v = "[vf]"; }
  if (assFile) { complex += `;${v}${assFilter(path.basename(assFile))}[vs]`; v = "[vs]"; }
  if (hookFile) { complex += `;${v}${assFilter(path.basename(hookFile))}[vh]`; v = "[vh]"; }
  if (overlayFile) { complex += `;${v}${assFilter(path.basename(overlayFile))}[vo2]`; v = "[vo2]"; }

  if (logo && logo.path) {
    args.push("-loop", "1", "-i", logo.path);
    const lIdx = idx++;
    complex += `;[${lIdx}:v]${logoScaleFilter({ scale: logo.scale, opacity: logo.opacity, targetW: TARGET_W })}[lg]`;
    const logoXY = (logo.x != null && logo.y != null) ? logoPositionXY(logo.x, logo.y) : logoPosition(logo.pos);
    complex += `;${v}[lg]overlay=${logoXY}:shortest=1[vl]`;
    v = "[vl]";
  }
  // WATERMARK logo Mentor — LUÔN góc TRÊN-TRÁI, cỡ nhỏ cố định.
  if (watermarkPath) {
    const _wm = Math.round(BRAND_WM.marginFrac * TARGET_W);
    args.push("-loop", "1", "-i", watermarkPath);
    const wIdx = idx++;
    complex += `;[${wIdx}:v]${logoScaleFilter({ scale: BRAND_WM.scale, opacity: 0.95, targetW: TARGET_W })}[wm]`;
    complex += `;${v}[wm]overlay=${_wm}:${_wm}:shortest=1[vwm]`;
    v = "[vwm]";
  }
  if (progress) { complex += `;${v}${progressBar(styledDur)}[vp]`; v = "[vp]"; }

  let musicIdx = null;
  if (musicPath) { args.push("-i", musicPath); musicIdx = idx++; }
  const sfxItems = [];
  if (sfxFile && sfxTimes.length) {
    for (const t of sfxTimes) { args.push("-i", sfxFile); sfxItems.push({ idx: idx++, t }); }
  }
  const { audioGraph, aOut } = buildAudioFull({ base: "[0:a]", musicIdx, musicPath, musicVol, sfxItems, sfxVol, normalize, voiceClean });
  if (audioGraph) complex += ";" + audioGraph;

  args.push("-filter_complex", complex, "-map", v, "-map", aOut,
    "-r", String(FPS), ...encV, "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", outPath);
  await run(FFMPEG, args, { cwd: WORK, onLog: (l) => onLog("  " + l) });
}

export async function autoEdit(input, opts = {}) {
  const {
    onLog = () => {}, id = "job", outPath,
    doCutSilence = true, removeFillers = false, reframe = "blur",
    doCaptions = true, captionStyle = "karaoke",
    colorLevel = "off", manual = null, smooth = "off", punch = true, shake = true, film = false,
    progress = true, flash = true, brollTransition = "fade",
    brollFolder = null, brollFill = "match",
    aiBroll = false, aiBrollCount = 6, aiBrollStyle = "điện ảnh, ánh sáng đẹp, chân thực",
    logoPath = null, logoPos = "br", logoScale = 0.16, logoOpacity = 0.9, logoX = null, logoY = null,
    sfx = false, sfxVol = 0.6,
    musicPath = null, musicVol = 0.18, normalize = true, voiceClean = "off",
    model = "small", lang = "vi",
    preTranscript = null, hookText = null,
    editedSegments = null,   // ✍️ phụ đề đã sửa tay → áp vào transcript trước khi burn
    overlayText = null, overlayPos = "bottom",
    watermark = true,   // logo Mentor góc trên-trái (bật mặc định nếu có file)
    cta = true, ctaPath = null,   // CTA cuối video (mọi video phải có) — ctaPath riêng hoặc assets/cta.mp4
  } = opts;
  const watermarkPath = watermark ? await brandLogo() : null;

  // 🎨 Nguồn HDR (iPhone) → SDR trước MỌI xử lý để màu không bạc/nhợt.
  input = await toSdrIfHdr(input, path.join(WORK, `${id}-sdr.mp4`), { onLog });

  onLog("=== BẮT ĐẦU DÀN DỰNG ===");
  let src = input;
  let pre = preTranscript;

  // 1. Cắt: ưu tiên bỏ TIẾNG ĐỆM + khoảng chết (sạch hơn), nếu không thì cắt lặng.
  if (removeFillers && !pre) {
    onLog("→ Bước 1: gõ chữ + cắt bỏ tiếng đệm (à/ừ/ờ) & khoảng chết...");
    const meta0 = await probe(input);
    try {
      const trFull = await transcribeWords(input, { model, lang, onLog: (l) => onLog("  " + l) });
      const { keep, cuts } = planClipCuts(trFull.words || [], 0, meta0.duration, { silenceMax: 0.5 });
      onLog(`  bỏ ${cuts.length} đoạn (đệm + chết), giữ ${keep.length} mảnh`);
      src = await cutByRanges(input, keep, path.join(WORK, `${id}_cut.mp4`), onLog);
      pre = remapTranscript(trFull.words || [], keep, 0, meta0.duration);
    } catch (e) {
      onLog("  ⚠ không cắt đệm được (" + e.message + ") → cắt lặng thường");
      if (doCutSilence) src = await cutSilence(input, id, { onLog });
    }
  } else if (doCutSilence) {
    onLog("→ Bước 1: cắt khoảng lặng chết...");
    src = await cutSilence(input, id, { onLog });
  }

  // 2. Điểm cắt cảnh (punch-zoom + flash)
  onLog("→ Bước 2: phát hiện điểm nhấn/cắt cảnh...");
  const sceneCuts = await detectScenes(src, 0.32);
  onLog(`  ${sceneCuts.length} điểm nhấn`);

  // 3. Transcript (phụ đề + b-roll)
  let tr = null, assFile = null;
  const needTranscript = doCaptions || !!brollFolder || aiBroll;
  if (needTranscript) {
    if (pre && (pre.words || []).length) { onLog("→ Bước 3: dùng transcript đã tính sẵn..."); tr = pre; }
    else {
      onLog("→ Bước 3: gõ chữ word-level...");
      try { tr = await transcribeWords(src, { model, lang, onLog: (l) => onLog("  " + l) }); }
      catch (e) { onLog("  ⚠ whisper lỗi: " + e.message); }
    }
  }
  // ✍️ Áp phụ đề đã sửa tay (nếu có) trước khi burn.
  if (editedSegments && tr && (tr.words || []).length) {
    tr = applyEditedText(tr, editedSegments);
    onLog("  ✍️ đã áp phụ đề sửa tay");
  }
  if (doCaptions && tr) {
    const ass = buildAssCaptions(tr, { videoW: TARGET_W, videoH: TARGET_H, style: captionStyle });
    assFile = path.join(WORK, `${id}.ass`);
    saveAss(ass, assFile);
    onLog(`  phụ đề: ${path.basename(assFile)}`);
  }

  // 4. Trám b-roll: AI tự tạo (Higgsfield) hoặc thư mục của người dùng
  let plan = [];
  if (aiBroll && tr) {
    onLog("→ Bước 4: trám b-roll AI (Higgsfield) tự tạo...");
    try { plan = await planAiBroll(tr, { count: aiBrollCount, style: aiBrollStyle, id, onLog: (l) => onLog("  " + l) }); }
    catch (e) { onLog("  ⚠ b-roll AI lỗi: " + e.message); }
  } else if (brollFolder && tr) {
    onLog("→ Bước 4: trám b-roll từ thư mục theo lời nói...");
    const lib = await indexFolder(brollFolder);
    onLog(`  thư viện: ${lib.length} file`);
    plan = planBroll(tr, lib, { fillMode: brollFill, folder: brollFolder });
    onLog(`  chèn ${plan.length} cảnh (${plan.filter((p) => p.matched).length} khớp từ khóa)`);
  }

  // 5. Chuẩn bị render
  const useGpu = await hasNvenc();
  const styledDur = (await probe(src)).duration;
  // MƯỢT TỪ ĐẦU ĐẾN CUỐI: KHÔNG ép hiệu ứng/flash/zoom ở giây 3 (thứ gây "vấp").
  // Chỉ giữ hook chữ (hiện 3s đầu, fade êm) + các hiệu ứng do người dùng bật (nếu có).
  const HOOK_DUR = 3.0;
  const hasHook = !!(hookText && String(hookText).trim());
  const main = buildMainGraph({ reframe, colorLevel, manual, smooth, punch, shake, film, sceneCuts });
  const flashExpr = flash ? flashEnable(sceneCuts) : null;

  let hookFile = null;
  if (hasHook) {
    const hookAss = buildHookAss(hookText, { videoW: TARGET_W, videoH: TARGET_H, dur: Math.min(styledDur, HOOK_DUR) });
    if (hookAss) { hookFile = path.join(WORK, `${id}.hook.ass`); saveAss(hookAss, hookFile); onLog(`  hook (chữ, fade êm): "${String(hookText).trim()}"`); }
  }

  // Chữ tay (text overlay do người dùng gõ) — hiện suốt short ở vị trí chọn.
  let overlayFile = null;
  if (overlayText && String(overlayText).trim()) {
    const ovlAss = buildOverlayAss(overlayText, { videoW: TARGET_W, videoH: TARGET_H, dur: styledDur, pos: overlayPos });
    if (ovlAss) { overlayFile = path.join(WORK, `${id}.ovl.ass`); saveAss(ovlAss, overlayFile); onLog(`  chữ tay (${overlayPos}): "${String(overlayText).trim()}"`); }
  }

  // SFX: whoosh tại mốc vào b-roll (hoặc điểm cắt nếu không có b-roll)
  let sfxFile = null, sfxTimes = [];
  if (sfx) {
    try { sfxFile = await ensureWhoosh(); } catch (e) { onLog("  ⚠ không tạo được SFX: " + e.message); }
    if (sfxFile) {
      sfxTimes = plan.length ? plan.map((p) => p.start) : sceneCuts.slice(0, 8);
      sfxTimes = [...new Set(sfxTimes.map((t) => +Number(t).toFixed(2)))].filter((t) => t > 0.05).slice(0, 12);
    }
  }

  const logo = logoPath ? { path: logoPath, pos: logoPos, scale: logoScale, opacity: logoOpacity, x: logoX, y: logoY } : null;
  const encV = useGpu
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-b:v", "0"]
    : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];

  const common = { plan, brollTransition, flashExpr, assFile, hookFile, overlayFile, progress, styledDur, logo, watermarkPath, sfxFile, sfxTimes, sfxVol, musicPath, musicVol, normalize, voiceClean, encV, outPath, onLog };

  if (!plan.length) {
    onLog("→ Bước 5: dựng hiệu ứng → xuất bản (1 lượt)...");
    await renderFinal({ baseFile: src, mainGraph: main.graph, mainOut: main.out, ...common });
  } else {
    onLog("→ Bước 5A: dựng nền chính (grade + màu + chuyển động)...");
    const styled = path.join(WORK, `${id}_styled.mp4`);
    await run(FFMPEG, ["-hide_banner", "-y", "-i", src,
      "-filter_complex", main.graph, "-map", main.out, "-map", "0:a",
      "-r", String(FPS), ...encV, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", styled,
    ], { cwd: WORK, onLog: (l) => onLog("  " + l) });
    onLog("→ Bước 5B: chèn b-roll + chuyển cảnh + phụ đề + logo → xuất bản...");
    await renderFinal({ baseFile: styled, mainGraph: null, ...common });
  }

  // CTA cuối video (mọi video phải có CTA) — ghép clip CTA vào cuối.
  const ctaFinal = cta ? (ctaPath || defaultCta()) : null;
  if (ctaFinal) {
    const pre = outPath.replace(/\.mp4$/, "_precta.mp4");
    try { fs.renameSync(outPath, pre); await appendCta(pre, ctaFinal, outPath, { W: TARGET_W, H: TARGET_H, captions: doCaptions, cutFillers: true, captionStyle, model, lang, onLog }); fs.unlinkSync(pre); }
    catch (e) { onLog("  ⚠ ghép CTA lỗi: " + e.message); if (fs.existsSync(pre) && !fs.existsSync(outPath)) fs.renameSync(pre, outPath); }
  }

  onLog("=== XONG ===");
  const meta = await probe(outPath);
  const transcriptText = tr ? (tr.segments || []).map((s) => s.text).join(" ").trim() : "";
  return { outPath, meta, broll: plan.length, scenes: sceneCuts.length, transcriptText, segments: transcriptSegments(tr) };
}
