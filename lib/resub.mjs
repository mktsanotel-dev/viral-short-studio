// ✍️ SỬA PHỤ ĐỀ TRÊN VIDEO THÀNH PHẨM (bất kỳ) — tab độc lập.
//  • Video CHƯA có phụ đề  → thêm phụ đề mới (Roboto), sạch đẹp.
//  • Video ĐÃ in phụ đề sai → CHE vùng chữ cũ (làm mờ / hộp) rồi in chữ mới đè lên
//    (không xoá được chữ đã "nướng chết", nên che là cách sạch nhất).
import path from "node:path";
import fs from "node:fs";
import { run, WORK } from "./util.mjs";
import { FFMPEG, probe, hasNvenc, toSdrIfHdr } from "./ffmpeg.mjs";
import { transcribeWords, buildAssCaptions, saveAss, applyEditedText, transcriptSegments } from "./transcribe.mjs";
import { assFilter } from "./fonts.mjs";

function encoder(useGpu) {
  return useGpu
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-b:v", "0"]
    : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
}

// BƯỚC 1: nhận diện lời → trả về danh sách câu để người dùng sửa.
export async function detectSubs(videoPath, { model = "medium", lang = "vi", onLog = () => {} } = {}) {
  onLog("→ Nhận diện lời nói (word-level)…");
  const tr = await transcribeWords(videoPath, { model, lang, onLog: (l) => onLog("  " + l) });
  return { segments: transcriptSegments(tr) };
}

// Vị trí dải theo pos + tỉ lệ cao (0..1). Trả về {y, h}.
function bandRegion(pos, frac, H) {
  const h = Math.max(40, Math.round(H * frac));
  const y = pos === "bottom" ? Math.max(0, H - h)
          : pos === "middle" ? Math.max(0, Math.round(H / 2 - h / 2))
          : 0; // top
  return { y, h };
}

// marginV (ASS, anchor đáy) để đặt phụ đề MỚI đúng vùng mong muốn.
function captionMargin(pos, H) {
  return pos === "middle" ? Math.round(H * 0.45)
       : pos === "top" ? Math.round(H * 0.82)
       : Math.round(H * 0.06); // bottom
}

// BƯỚC 2: dựng video với phụ đề đã sửa (tuỳ chọn che chữ cũ).
export async function resubVideo(videoPath, opts = {}) {
  const {
    onLog = () => {}, id = "resub", outPath,
    editedSegments = null,
    captionStyle = "karaoke", captionPos = "bottom",
    coverOld = false, coverPos = "bottom", coverFrac = 0.16, coverMode = "blur",
    model = "medium", lang = "vi",
  } = opts;

  onLog("=== ✍️ SỬA PHỤ ĐỀ TRÊN VIDEO THÀNH PHẨM ===");
  // 🎨 Nếu video thả vào là HDR (iPhone) → SDR để màu không bạc.
  videoPath = await toSdrIfHdr(videoPath, path.join(WORK, `${id}-sdr.mp4`), { onLog });
  const meta = await probe(videoPath);
  const W = meta.width || 1080, H = meta.height || 1920;
  const useGpu = await hasNvenc();

  // 1) Transcript (cache) + áp phụ đề đã sửa
  let tr = await transcribeWords(videoPath, { model, lang, onLog: (l) => onLog("  " + l) });
  if (editedSegments) { tr = applyEditedText(tr, editedSegments); onLog("  ✍️ đã áp phụ đề sửa tay"); }
  if (!tr || !(tr.words || []).length) throw new Error("Không nhận ra lời nói trong video (không có tiếng?).");

  // 2) Dựng ASS phụ đề mới (Roboto), cỡ chữ theo bề ngang video
  const fontSize = Math.max(30, Math.round(W * 0.07));
  const marginV = captionMargin(captionPos, H);
  const ass = buildAssCaptions(tr, { videoW: W, videoH: H, style: captionStyle, fontSize, marginV });
  const assFile = path.join(WORK, `${id}.resub.ass`);
  saveAss(ass, assFile);

  // 3) Chuỗi filter: (che vùng chữ cũ) → in phụ đề mới
  let complex = "";
  if (coverOld) {
    const { y, h } = bandRegion(coverPos, coverFrac, H);
    if (coverMode === "blur") {
      // Làm MỜ đúng dải chứa chữ cũ → chữ cũ nhoè đi, nhìn tự nhiên hơn hộp đen.
      complex =
        `[0:v]split=2[full][reg];` +
        `[reg]crop=${W}:${h}:0:${y},boxblur=18:2[bl];` +
        `[full][bl]overlay=0:${y}[cov];` +
        `[cov]${assFilter(path.basename(assFile))}[vout]`;
      onLog(`  che chữ cũ bằng LÀM MỜ dải ${coverPos} (cao ${h}px)`);
    } else {
      // Hộp tối nửa trong suốt phủ lên chữ cũ.
      complex = `[0:v]drawbox=x=0:y=${y}:w=${W}:h=${h}:color=black@0.82:t=fill,${assFilter(path.basename(assFile))}[vout]`;
      onLog(`  che chữ cũ bằng HỘP TỐI dải ${coverPos} (cao ${h}px)`);
    }
  } else {
    complex = `[0:v]${assFilter(path.basename(assFile))}[vout]`;
  }

  // 4) Render — GIỮ nguyên tiếng gốc (mã hoá AAC để nhận mọi định dạng đầu vào)
  onLog("→ Dựng video với phụ đề mới…");
  await run(FFMPEG, [
    "-hide_banner", "-y", "-i", videoPath,
    "-filter_complex", complex,
    "-map", "[vout]", "-map", "0:a?",
    ...encoder(useGpu), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", outPath,
  ], { cwd: WORK, onLog: (l) => onLog("  " + l) });

  try { fs.unlinkSync(assFile); } catch { /* dọn */ }
  onLog("=== XONG ===");
  const outMeta = await probe(outPath);
  return { outPath, meta: outMeta, segments: transcriptSegments(tr), transcriptText: (tr.segments || []).map((s) => s.text).join(" ").trim() };
}
