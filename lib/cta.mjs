// 🎯 CTA CUỐI VIDEO — mọi video PHẢI có CTA cuối. Ghép clip CTA vào cuối (chuẩn hoá đúng khung + fade).
// CTA mặc định: assets/cta.mp4 (thả file vào là mọi video tự có CTA). Có thể truyền ctaPath riêng để đè.
import path from "node:path";
import fs from "node:fs";
import { run, WORK, __root } from "./util.mjs";
import { FFMPEG, probe, hasNvenc } from "./ffmpeg.mjs";
import { transcribeWords, buildAssCaptions, saveAss } from "./transcribe.mjs";
import { assFilter } from "./fonts.mjs";
import { planClipCuts, remapTranscript } from "./fillers.mjs";

export function defaultCta() {
  const f = path.join(__root, "assets", "cta.mp4");
  try { return fs.existsSync(f) ? f : null; } catch { return null; }
}

function encoder(useGpu) {
  return useGpu ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-b:v", "0"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
}

// Cắt VIDEO+AUDIO của CTA theo các khoảng GIỮ LẠI (bỏ à/ừ + khoảng chết) rồi nối liền mạch.
async function cutAV(input, keep, out, useGpu, onLog) {
  const sel = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
  await run(FFMPEG, ["-hide_banner", "-y", "-i", input,
    "-filter_complex", `[0:v]select='${sel}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${sel}',asetpts=N/SR/TB[a]`,
    "-map", "[v]", "-map", "[a]", ...encoder(useGpu), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", out],
    { cwd: WORK, onLog: (l) => onLog("    " + l) });
  return out;
}

// Ghép CTA vào CUỐI video (chuẩn hoá CTA về đúng WxH). transition="fade"|... ; "cut"=nối thẳng.
// Trả về out (video đã có CTA). Nếu không có cta → trả nguyên video.
export async function appendCta(video, cta, out, { W = 1080, H = 1920, transition = "fade", XF = 0.5, captions = false, cutFillers = false, captionStyle = "karaoke", model = "medium", lang = "vi", onLog = () => {} } = {}) {
  if (!cta || !fs.existsSync(cta)) return video;
  const mainDur = (await probe(video)).duration || 1;
  const ctaHasAudio = (await probe(cta)).hasAudio;
  const useGpu = await hasNvenc();

  // 📝 + ✂️ Xử lý CTA GIỐNG video chính: gõ chữ (CACHE theo file) → CẮT à/ừ + khoảng chết (nếu bật)
  //           → dựng phụ đề khớp bản đã cắt. Chỉ khi CTA có tiếng nói.
  let ctaAss = null, cutTmp = null;
  if ((captions || cutFillers) && ctaHasAudio) {
    try {
      let tr = await transcribeWords(cta, { model, lang, onLog: () => {} });
      if (tr && (tr.words || []).length) {
        if (cutFillers) {
          const cdur = (await probe(cta)).duration || 0;
          const { keep, cuts } = planClipCuts(tr.words || [], 0, cdur);
          if (cuts.length && keep.length) {
            onLog(`  ✂️ CTA: cắt ${cuts.length} đoạn à/ừ + khoảng chết`);
            cutTmp = path.join(WORK, `cta-cut-${Date.now()}.mp4`);
            await cutAV(cta, keep, cutTmp, useGpu, onLog);
            cta = cutTmp;
            tr = remapTranscript(tr.words || [], keep, 0, cdur);
          }
        }
        if (captions) {
          saveAss(buildAssCaptions(tr, { videoW: W, videoH: H, style: captionStyle }), path.join(WORK, (ctaAss = `cta-sub-${Date.now()}.ass`)));
          onLog("  📝 thêm phụ đề cho phần CTA");
        }
      }
    } catch (e) { onLog("  ⚠ xử lý CTA lỗi: " + e.message); ctaAss = null; }
  }

  const args = ["-hide_banner", "-y", "-i", video, "-i", cta];
  const parts = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p[v0]`,
    `[0:a]aresample=48000,aformat=channel_layouts=stereo:sample_rates=48000[a0]`,
    `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p${ctaAss ? "," + assFilter(ctaAss) : ""}[v1]`,
  ];
  // CTA có thể không có tiếng → thêm nguồn im lặng
  let a1 = "[a1]", extra = [];
  if (ctaHasAudio) parts.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo:sample_rates=48000[a1]`);
  else { const cdur = (await probe(cta)).duration || 3; extra = ["-f", "lavfi", "-t", cdur.toFixed(2), "-i", "anullsrc=r=48000:cl=stereo"]; args.splice(4, 0, ...extra); parts.push(`[2:a]aformat=channel_layouts=stereo[a1]`); }

  let vOut, aOut;
  if (transition && transition !== "cut") {
    const off = Math.max(0.1, mainDur - XF).toFixed(3);
    parts.push(`[v0][v1]xfade=transition=${transition}:duration=${XF}:offset=${off}[vo]`);
    parts.push(`[a0]${a1}acrossfade=d=${XF}[ao]`);
    vOut = "[vo]"; aOut = "[ao]";
  } else {
    parts.push(`[v0][a0][v1]${a1}concat=n=2:v=1:a=1[vo][ao]`);
    vOut = "[vo]"; aOut = "[ao]";
  }
  onLog(`  🎯 ghép CTA cuối video (${transition})...`);
  args.push("-filter_complex", parts.join(";"), "-map", vOut, "-map", aOut,
    ...encoder(useGpu), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", out);
  await run(FFMPEG, args, { cwd: WORK, onLog: (l) => onLog("    " + l) });
  try { if (ctaAss) fs.unlinkSync(path.join(WORK, ctaAss)); } catch { /* dọn ASS tạm */ }
  try { if (cutTmp) fs.unlinkSync(cutTmp); } catch { /* dọn CTA đã cắt */ }
  return out;
}
