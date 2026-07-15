// Hoàn thiện video ĐÃ render (khi XEM TRƯỚC / TẢI) trong MỘT LƯỢT ffmpeg duy nhất:
//  - CHỈNH MÀU (sáng/tương phản/bão hòa) khớp xem-trực-tiếp trên trình duyệt
//  - LOGO (vị trí/cỡ/mờ) + NHẠC nền (ducking dưới giọng)
//  - Nối VIDEO CTA vào cuối bằng CHUYỂN CẢNH kiểu CapCut (xfade)
// Làm 1 lượt để tiếng-hình luôn khớp (không có file trung gian gây lệch).
import path from "node:path";
import fs from "node:fs";
import { run, WORK } from "./util.mjs";
import { FFMPEG, probe, hasNvenc } from "./ffmpeg.mjs";
import { logoScaleFilter, logoPositionXY } from "./effects.mjs";

const TW = 1080, TH = 1920, FPS = 30, XF = 0.6;

function encoder(useGpu) {
  return useGpu
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-b:v", "0"]
    : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
}
function colorEq(color) {
  if (!color) return null;
  const b = Number(color.brightness) || 0, c = Number(color.contrast) || 0, s = Number(color.saturation) || 0;
  if (!b && !c && !s) return null;
  return `eq=brightness=${(b / 200).toFixed(3)}:contrast=${(1 + c / 100).toFixed(3)}:saturation=${(1 + s / 100).toFixed(3)}`;
}

export async function finalizeVideo(videoPath, outPath, { color = null, logo = null, music = null, cta = null, transition = "fade", onLog = () => {} } = {}) {
  const eq = colorEq(color);
  const hasLogo = logo && logo.path && fs.existsSync(logo.path);
  const hasMusic = music && music.path && fs.existsSync(music.path);
  const hasCta = cta && cta.path && fs.existsSync(cta.path);
  if (!eq && !hasLogo && !hasMusic && !hasCta) { onLog("(không có chỉnh sửa — giữ nguyên)"); return videoPath; }

  const meta = await probe(videoPath);
  const mainDur = meta.duration || 1;
  const W = meta.width || TW;
  const useGpu = await hasNvenc();

  const args = ["-hide_banner", "-y", "-i", videoPath];
  let idx = 1;
  const parts = [];

  // ---- VIDEO nhánh chính ----
  let v = "[0:v]";
  if (eq) { parts.push(`${v}${eq}[cg]`); v = "[cg]"; }
  if (hasLogo) {
    args.push("-loop", "1", "-i", logo.path);
    const lIdx = idx++;
    parts.push(`[${lIdx}:v]${logoScaleFilter({ scale: logo.scale ?? 0.16, opacity: logo.opacity ?? 0.9, targetW: W })}[lg]`);
    parts.push(`${v}[lg]overlay=${logoPositionXY(logo.x ?? 92, logo.y ?? 92)}:shortest=1[vmain]`);
    v = "[vmain]";
  }

  // ---- AUDIO nhánh chính: GIỌNG giữ nguyên (full) + NHẠC theo đúng slider ----
  // Trộn thẳng theo âm lượng chọn (dễ kiểm soát), có ducking NHẸ để giọng luôn nổi,
  // alimiter chống vỡ tiếng. Ép stereo/48k để hết lỗi "channel element duplicate".
  let a = "[0:a]";
  if (hasMusic) {
    args.push("-i", music.path);
    const mIdx = idx++;
    const vol = Math.max(0, Math.min(1.5, music.vol ?? 0.3));
    parts.push(`[0:a]aformat=channel_layouts=stereo:sample_rates=48000,asplit=2[vA][vB]`);
    parts.push(`[${mIdx}:a]volume=${vol.toFixed(3)},aloop=loop=-1:size=2e9,aformat=channel_layouts=stereo:sample_rates=48000[mv]`);
    parts.push(`[mv][vB]sidechaincompress=threshold=0.08:ratio=4:attack=20:release=300[mduck]`);
    parts.push(`[vA][mduck]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[amain]`);
    a = "[amain]";
  }

  let vOut, aOut;
  if (hasCta) {
    args.push("-i", cta.path);
    const cIdx = idx++;
    parts.push(`[${cIdx}:v]scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH},setsar=1,fps=${FPS}[cv]`);
    // audio CTA (im lặng nếu CTA không tiếng)
    let ca;
    if (cta.hasAudio ?? (await probe(cta.path)).hasAudio) {
      parts.push(`[${cIdx}:a]aresample=48000,aformat=channel_layouts=stereo[ca]`); ca = "[ca]";
    } else {
      const cm = await probe(cta.path);
      args.push("-f", "lavfi", "-t", String((cm.duration || 3).toFixed(2)), "-i", "anullsrc=r=48000:cl=stereo");
      const nIdx = idx++;
      parts.push(`[${nIdx}:a]aformat=channel_layouts=stereo[ca]`); ca = "[ca]";
    }
    // chuẩn hoá video chính về đúng khung + đưa audio chính về 48k stereo trước khi ghép
    parts.push(`${v}scale=${TW}:${TH}:force_original_aspect_ratio=decrease,pad=${TW}:${TH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[vm]`);
    parts.push(`${a}aresample=48000,aformat=channel_layouts=stereo[am]`);
    if (transition && transition !== "cut") {
      const off = Math.max(0.1, mainDur - XF).toFixed(3);
      parts.push(`[vm][cv]xfade=transition=${transition}:duration=${XF}:offset=${off}[vo]`);
      parts.push(`[am][ca]acrossfade=d=${XF}[ao]`);
    } else {
      parts.push(`[vm][am][cv][ca]concat=n=2:v=1:a=1[vo][ao]`);
    }
    vOut = "[vo]"; aOut = "[ao]";
  } else {
    vOut = v; aOut = a;
  }

  const mapV = vOut === "[0:v]" ? "0:v" : vOut;
  const mapA = aOut === "[0:a]" ? "0:a" : aOut;
  // Video chỉ RE-ENCODE khi thực sự đổi (màu/logo/CTA). Nếu chỉ thêm nhạc → COPY nguyên
  // → giữ đúng video sạch của bản render, không sinh lỗi NAL, lại nhanh hơn.
  const videoTouched = !!eq || hasLogo || hasCta;
  const vArgs = videoTouched ? [...encoder(useGpu), "-pix_fmt", "yuv420p", "-r", String(FPS)] : ["-c:v", "copy"];
  args.push("-filter_complex", parts.join(";"), "-map", mapV, "-map", mapA,
    ...vArgs, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", outPath);
  onLog(`nướng ${eq ? "màu " : ""}${hasLogo ? "logo " : ""}${hasMusic ? "nhạc " : ""}${hasCta ? "+CTA(" + (transition || "cắt") + ")" : ""}...`);
  await run(FFMPEG, args, { cwd: WORK, onLog: (l) => onLog("  " + l) });
  return outPath;
}
