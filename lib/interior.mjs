// 🛋️ NỘI THẤT CHO CON — biên tập video nội thất theo yêu cầu riêng:
//  • Lật video (gương ngang)  • Tải video thô  • Thêm voice (ghi âm / file)
//  • Tăng tốc video 1/1.1/1.2  • Tăng tốc + CHỈNH GIỌNG kiểu CapCut (cao độ/tông)
//  • Cắt "à ừ"  • Logo Nội Thất Cho Con  • Hiệu ứng chữ (chữ tay)
//  • Từ khóa cảm xúc/câu chuyện PHÓNG TO GIỮA MÀN
//
// 2 luồng:
//  A) CÓ voice riêng  → voice là timeline; video nền lặp/cắt cho khớp giọng (như lồng tiếng).
//  B) KHÔNG voice riêng → dùng tiếng gốc của video; cắt à ừ + tăng tốc cả hình lẫn tiếng.
import path from "node:path";
import fs from "node:fs";
import { run, WORK, slug } from "./util.mjs";
import { FFMPEG, probe, hasNvenc, toSdrIfHdr } from "./ffmpeg.mjs";
import {
  transcribeWords, buildAssCaptions, saveAss, buildOverlayAss, buildKeywordAss, buildHookAss, applyEditedText, transcriptSegments,
} from "./transcribe.mjs";
import { assFilter } from "./fonts.mjs";
import {
  colorGrade, manualColor, smoothFilter, voiceCleanFilter, voiceEnhance, voicePitchTempo,
  logoScaleFilter, logoPosition, logoPositionXY,
} from "./effects.mjs";
import { planClipCuts, remapTranscript } from "./fillers.mjs";

const FPS = 30;

function encoder(useGpu) {
  return useGpu
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-b:v", "0"]
    : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
}

// Nhân/chia mốc thời gian transcript theo hệ số tốc độ (khi tăng tốc, thời lượng ÷ tempo).
function scaleTranscript(tr, tempo) {
  if (!tr || Math.abs(tempo - 1) < 1e-3) return tr;
  const f = 1 / tempo;
  const mapW = (w) => ({ ...w, start: +(w.start * f).toFixed(3), end: +(w.end * f).toFixed(3) });
  return {
    ...tr,
    words: (tr.words || []).map(mapW),
    segments: (tr.segments || []).map((s) => ({ ...mapW(s), words: (s.words || []).map(mapW) })),
    duration: tr.duration != null ? +(tr.duration * f).toFixed(3) : tr.duration,
  };
}

// Cắt VIDEO+AUDIO theo các khoảng GIỮ LẠI (bỏ à ừ / khoảng chết).
async function cutAVByRanges(input, keep, out, onLog) {
  if (!keep || !keep.length) return input;
  const sel = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
  const useGpu = await hasNvenc();
  await run(FFMPEG, [
    "-hide_banner", "-y", "-i", input,
    "-filter_complex",
    `[0:v]select='${sel}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${sel}',asetpts=N/SR/TB[a]`,
    "-map", "[v]", "-map", "[a]",
    ...encoder(useGpu), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", out,
  ], { cwd: WORK, onLog: (l) => onLog("  " + l) });
  return out;
}

// Cắt AUDIO-only theo khoảng giữ lại (dùng cho voice riêng).
async function cutAudioByRanges(input, keep, out, onLog) {
  if (!keep || !keep.length) return input;
  const sel = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
  await run(FFMPEG, [
    "-hide_banner", "-y", "-i", input,
    "-af", `aselect='${sel}',asetpts=N/SR/TB`,
    "-ac", "1", "-ar", "48000", out,
  ], { cwd: WORK, onLog: (l) => onLog("  " + l) });
  return out;
}

// Chuỗi filter khung hình cho video nền (lật + reframe + màu + mịn).
function videoGraph({ flip, aspect, colorLevel, manual, smooth, W, H }) {
  const parts = [`fps=${FPS}`, `setpts=PTS-STARTPTS`];
  if (flip) parts.push("hflip");
  if (aspect === "916blur") {
    // xử lý riêng bằng split (thêm ở nơi gọi) — ở đây chỉ scale-fit khi fill/keep
  }
  const sm = smooth && smooth !== "off" ? smoothFilter(smooth) : null;
  if (sm) parts.push(sm);
  const cg = colorLevel && colorLevel !== "off" ? colorGrade(colorLevel) : null;
  if (cg) parts.push(cg);
  const mc = manualColor(manual || {});
  if (mc) parts.push(mc);
  return parts.join(",");
}

// Dựng nền 9:16 mờ (giống edit.mjs) — trả về graph hoàn chỉnh từ [0:v] → [vout].
function reframeGraph(aspect, W, H, inner) {
  if (aspect === "916blur") {
    return `[0:v]${inner},split=2[bg][fg];` +
      `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=22[bgb];` +
      `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2[vout]`;
  }
  if (aspect === "916fill") {
    return `[0:v]${inner},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[vout]`;
  }
  // keep: giữ khung gốc (chỉ chuẩn hoá chẵn) — W/H lấy từ video gốc ở nơi gọi.
  return `[0:v]${inner},scale=trunc(iw/2)*2:trunc(ih/2)*2[vout]`;
}

export async function interiorEdit(videoPath, opts = {}) {
  const {
    onLog = () => {}, id = "interior", outPath,
    flip = false,
    aspect = "keep",            // keep | 916blur | 916fill
    videoSpeed = 1,             // 1 / 1.1 / 1.2
    voicePath = null,
    voiceMode = "replace",      // replace | mix | keep (khi có voice riêng)
    voiceSpeed = 1,             // 1 / 1.1 / 1.2 (cho voice riêng)
    voicePitch = 0,             // nửa cung
    voiceTone = "normal",
    voiceVol = 1.0,
    voiceClean = "off",
    cutFillers = true,
    doCaptions = true, captionStyle = "karaoke",
    keywords = "",
    logoPath = null, logoPos = "br", logoScale = 0.16, logoOpacity = 0.95, logoX = null, logoY = null,
    overlayText = null, overlayPos = "bottom",
    hookText = null,
    colorLevel = "off", manual = null, smooth = "off",
    normalize = true,
    model = "medium", lang = "vi",
    preTranscript = null,       // dựng lại giữ transcript (0 token whisper)
    editedSegments = null,      // phụ đề đã sửa tay (mảng câu)
  } = opts;

  onLog("=== 🛋️ NỘI THẤT CHO CON — BẮT ĐẦU ===");
  const useGpu = await hasNvenc();
  // 🎨 Nguồn HDR (iPhone) → SDR trước mọi xử lý để màu không bạc.
  videoPath = await toSdrIfHdr(videoPath, path.join(WORK, `${id}-sdr.mp4`), { onLog });
  const meta0 = await probe(videoPath);
  const temps = [];
  const hasVoice = !!(voicePath && fs.existsSync(voicePath));

  // Khung đích
  const is916 = aspect === "916blur" || aspect === "916fill";
  const W = is916 ? 1080 : (meta0.width || 1080);
  const H = is916 ? 1920 : (meta0.height || 1920);

  let workVideo = videoPath;   // video sẽ đưa vào bước render cuối (đã lật/tăng tốc/reframe)
  let audioFile = null;        // file audio cuối (voice đã xử lý) — null = dùng audio của workVideo
  let tr = preTranscript;      // transcript để dựng phụ đề (đã ở timeline cuối)
  let styledDur = meta0.duration;

  // ---------- LUỒNG A: CÓ VOICE RIÊNG ----------
  if (hasVoice) {
    onLog(`→ Voice riêng: ${path.basename(voicePath)} (chế độ: ${voiceMode})`);
    let voice = voicePath;
    const vmeta = await probe(voice);
    let vtr = null;

    // 1. Cắt à ừ trên VOICE (nếu bật) + lấy transcript voice
    if ((cutFillers || doCaptions) && !preTranscript) {
      onLog("→ Gõ chữ voice (word-level)...");
      try {
        const full = await transcribeWords(voice, { model, lang, onLog: (l) => onLog("  " + l) });
        if (cutFillers) {
          const { keep, cuts } = planClipCuts(full.words || [], 0, vmeta.duration, { silenceMax: 0.6 });
          onLog(`  cắt ${cuts.length} đoạn à/ừ/chết, giữ ${keep.length} mảnh`);
          const cut = path.join(WORK, `${id}_voicecut.wav`); temps.push(cut);
          voice = await cutAudioByRanges(voice, keep, cut, onLog);
          vtr = remapTranscript(full.words || [], keep, 0, vmeta.duration);
        } else {
          vtr = full;
        }
      } catch (e) { onLog("  ⚠ whisper voice lỗi: " + e.message); }
    }

    // 2. Xử lý giọng: khử tạp + chỉnh cao độ/tông + tốc độ + âm lượng
    const aChain = [];
    const vc = voiceCleanFilter(voiceClean); if (vc) aChain.push(vc);
    const ve = voiceEnhance(voiceClean === "studio" ? "studio" : "medium"); if (ve) aChain.push(ve);
    const pt = voicePitchTempo({ pitch: voicePitch, tempo: voiceSpeed, tone: voiceTone });
    if (pt) aChain.push(pt);
    if (Math.abs(voiceVol - 1) > 0.01) aChain.push(`volume=${voiceVol}`);
    const voiceOut = path.join(WORK, `${id}_voice.wav`); temps.push(voiceOut);
    await run(FFMPEG, [
      "-hide_banner", "-y", "-i", voice,
      ...(aChain.length ? ["-af", aChain.join(",")] : []),
      "-ac", "2", "-ar", "48000", voiceOut,
    ], { cwd: WORK, onLog: (l) => onLog("  " + l) });
    audioFile = voiceOut;
    const finalVoiceMeta = await probe(voiceOut);
    styledDur = finalVoiceMeta.duration;
    // transcript khớp voice cuối: chia theo tempo (voiceSpeed)
    if (vtr) tr = scaleTranscript(vtr, voiceSpeed);

    // 3. Video nền: lật + reframe + màu, rồi LẶP/CẮT khớp độ dài voice
    onLog(`→ Video nền: khớp ${styledDur.toFixed(1)}s theo voice (lật=${flip}, tốc độ hình=${videoSpeed})`);
    const inner = videoGraph({ flip, aspect, colorLevel, manual, smooth, W, H })
      + (videoSpeed !== 1 ? `,setpts=${(1 / videoSpeed).toFixed(4)}*PTS` : "");
    const rg = reframeGraph(aspect, W, H, inner);
    const styled = path.join(WORK, `${id}_bg.mp4`); temps.push(styled);
    // -stream_loop để video ngắn tự lặp; -t cắt đúng độ dài voice.
    await run(FFMPEG, [
      "-hide_banner", "-y", "-stream_loop", "-1", "-i", videoPath,
      "-t", String(styledDur.toFixed(3)),
      "-filter_complex", rg, "-map", "[vout]",
      "-an", "-r", String(FPS), ...encoder(useGpu), "-pix_fmt", "yuv420p", styled,
    ], { cwd: WORK, onLog: (l) => onLog("  " + l) });
    workVideo = styled;

  // ---------- LUỒNG B: DÙNG TIẾNG GỐC ----------
  } else {
    // 1. Cắt à ừ trên video gốc (video+audio) + transcript
    let src = videoPath;
    if ((cutFillers || doCaptions) && !preTranscript) {
      onLog("→ Gõ chữ tiếng gốc (word-level)...");
      try {
        const full = await transcribeWords(videoPath, { model, lang, onLog: (l) => onLog("  " + l) });
        if (cutFillers) {
          const { keep, cuts } = planClipCuts(full.words || [], 0, meta0.duration, { silenceMax: 0.6 });
          onLog(`  cắt ${cuts.length} đoạn à/ừ/chết, giữ ${keep.length} mảnh`);
          const cut = path.join(WORK, `${id}_cut.mp4`); temps.push(cut);
          src = await cutAVByRanges(videoPath, keep, cut, onLog);
          tr = remapTranscript(full.words || [], keep, 0, meta0.duration);
        } else {
          tr = full;
        }
      } catch (e) { onLog("  ⚠ whisper lỗi: " + e.message); }
    }
    const cutMeta = await probe(src);

    // 2. Lật + reframe + màu + TĂNG TỐC (hình: setpts, tiếng: rubberband tempo + chỉnh giọng)
    onLog(`→ Dựng hình (lật=${flip}, tốc độ=${videoSpeed}, khung=${aspect})`);
    const inner = videoGraph({ flip, aspect, colorLevel, manual, smooth, W, H })
      + (videoSpeed !== 1 ? `,setpts=${(1 / videoSpeed).toFixed(4)}*PTS` : "");
    const rg = reframeGraph(aspect, W, H, inner);
    // audio: gộp tốc độ (tempo=videoSpeed) + chỉnh giọng (pitch/tông) + khử tạp
    const aChain = [];
    const vc = voiceCleanFilter(voiceClean); if (vc) aChain.push(vc);
    const ve = voiceEnhance(voiceClean === "studio" ? "studio" : "medium"); if (ve) aChain.push(ve);
    const pt = voicePitchTempo({ pitch: voicePitch, tempo: videoSpeed, tone: voiceTone });
    if (pt) aChain.push(pt);
    else if (videoSpeed !== 1) aChain.push(`atempo=${videoSpeed}`);
    const styled = path.join(WORK, `${id}_styled.mp4`); temps.push(styled);
    await run(FFMPEG, [
      "-hide_banner", "-y", "-i", src,
      "-filter_complex", rg,
      ...(aChain.length ? ["-af", aChain.join(",")] : []),
      "-map", "[vout]", "-map", "0:a?",
      "-r", String(FPS), ...encoder(useGpu), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", styled,
    ], { cwd: WORK, onLog: (l) => onLog("  " + l) });
    workVideo = styled;
    styledDur = (await probe(styled)).duration;
    if (tr) tr = scaleTranscript(tr, videoSpeed);
  }

  // ---------- Ghi đè phụ đề đã sửa tay (nếu có) ----------
  if (editedSegments && tr && (tr.words || []).length) {
    tr = applyEditedText(tr, editedSegments);
    onLog("  ✍️ đã áp phụ đề sửa tay");
  }

  // ---------- Dựng các lớp chữ (phụ đề · từ khóa · hook · chữ tay) ----------
  const layers = [];
  if (doCaptions && tr && (tr.words || []).length) {
    const ass = buildAssCaptions(tr, { videoW: W, videoH: H, style: captionStyle, marginV: Math.round(H * 0.20) });
    const f = path.join(WORK, `${id}.cap.ass`); saveAss(ass, f); temps.push(f);
    layers.push(path.basename(f));
    onLog("  phụ đề Roboto ✔");
  }
  if (keywords && tr && (tr.words || []).length) {
    const kass = buildKeywordAss(keywords, tr, { videoW: W, videoH: H });
    if (kass) { const f = path.join(WORK, `${id}.kw.ass`); saveAss(kass, f); temps.push(f); layers.push(path.basename(f)); onLog("  từ khóa giữa màn ✔"); }
  }
  if (hookText && String(hookText).trim()) {
    const hass = buildHookAss(hookText, { videoW: W, videoH: H, dur: Math.min(styledDur, 3) });
    if (hass) { const f = path.join(WORK, `${id}.hook.ass`); saveAss(hass, f); temps.push(f); layers.push(path.basename(f)); }
  }
  if (overlayText && String(overlayText).trim()) {
    const oass = buildOverlayAss(overlayText, { videoW: W, videoH: H, dur: styledDur, pos: overlayPos });
    if (oass) { const f = path.join(WORK, `${id}.ovl.ass`); saveAss(oass, f); temps.push(f); layers.push(path.basename(f)); }
  }

  // ---------- Render cuối: chữ + logo + (audio voice nếu có) ----------
  onLog("→ Render cuối (chữ + logo)...");
  const args = ["-hide_banner", "-y", "-i", workVideo];
  let audioMapExtra = null;
  if (audioFile) { args.push("-i", audioFile); audioMapExtra = "1:a"; }

  let complex = "";
  let v = "[0:v]";
  // nối các lớp ass
  let first = true;
  for (const base of layers) {
    const inLabel = first ? "[0:v]" : v;
    const outLabel = `[t${layers.indexOf(base)}]`;
    complex += `${first ? "" : ";"}${inLabel}${assFilter(base)}${outLabel}`;
    v = outLabel; first = false;
  }
  // logo overlay (input riêng)
  let logoIdx = null;
  if (logoPath && fs.existsSync(logoPath)) {
    args.push("-loop", "1", "-i", logoPath);
    logoIdx = audioFile ? 2 : 1;
    const src = complex ? v : "[0:v]";
    complex += `${complex ? ";" : ""}[${logoIdx}:v]${logoScaleFilter({ scale: logoScale, opacity: logoOpacity, targetW: W })}[lg]`;
    const logoXY = (logoX != null && logoY != null) ? logoPositionXY(logoX, logoY) : logoPosition(logoPos, Math.round(W * 0.03));
    complex += `;${src}[lg]overlay=${logoXY}:shortest=1[vl]`;
    v = "[vl]";
  }
  const vOut = complex ? v : "[0:v]";

  // audio: normalize nếu cần
  let aOut = audioMapExtra || "0:a?";
  if (normalize) {
    const aIn = audioFile ? "[1:a]" : "[0:a]";
    complex += `${complex ? ";" : ""}${aIn}loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
    aOut = "[aout]";
  }

  const mapArgs = [];
  if (complex) mapArgs.push("-filter_complex", complex, "-map", vOut);
  else mapArgs.push("-map", "0:v");
  mapArgs.push("-map", aOut);

  await run(FFMPEG, [
    ...args, ...mapArgs,
    "-r", String(FPS), ...encoder(useGpu), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", outPath,
  ], { cwd: WORK, onLog: (l) => onLog("  " + l) });

  // dọn tạm
  for (const t of temps) { try { fs.unlinkSync(t); } catch { /* bỏ qua */ } }

  onLog("=== XONG ===");
  const meta = await probe(outPath);
  const transcriptText = tr ? (tr.segments || []).map((s) => s.text).join(" ").trim() : "";
  // trả về segments để UI cho SỬA PHỤ ĐỀ rồi dựng lại
  const segments = transcriptSegments(tr); // tách 1 câu/dòng (khớp applyEditedText khi sửa)
  return { outPath, meta, transcriptText, segments, sourceVideo: videoPath, voicePath: voicePath || null };
}
