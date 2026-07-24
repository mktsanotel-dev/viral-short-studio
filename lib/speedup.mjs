// ⏩ TĂNG TỐC VIDEO dùng chung cho MỌI tác vụ. Hậu xử lý trên video ĐÃ HOÀN CHỈNH
// (phụ đề đã "nướng" vào hình, nhạc đã trộn) → tua nhanh cả hình + tiếng + phụ đề CÙNG NHAU
// nên tự khớp, không cần đụng transcript của từng pipeline.
//   - Hình: setpts=(1/speed)*PTS   - Tiếng: atempo=speed (GIỮ NGUYÊN cao độ, không "chuột").
// Làm IN-PLACE: ghi ra file tạm rồi đè lại đúng đường dẫn cũ → mọi tham chiếu (outPath,
// thumbnail, Lark) đều dùng bản đã tăng tốc.
import path from "node:path";
import fs from "node:fs";
import { run, WORK } from "./util.mjs";
import { FFMPEG, probe, hasNvenc } from "./ffmpeg.mjs";

// Tăng tốc 1 file video (0.5–2.0×) TẠI CHỖ. speed≈1 → giữ nguyên (no-op).
export async function speedUpVideo(file, speed, { onLog = () => {} } = {}) {
  const sp = Math.max(0.5, Math.min(2.0, Number(speed) || 1));
  if (Math.abs(sp - 1) < 0.01) return file;               // giữ nguyên
  if (!file || !fs.existsSync(file)) return file;

  let meta; try { meta = await probe(file); } catch { meta = { hasAudio: true }; }
  const useGpu = await hasNvenc();
  const venc = ["-c:v", useGpu ? "h264_nvenc" : "libx264", "-preset", useGpu ? "p4" : "veryfast", "-pix_fmt", "yuv420p"];
  const tmp = path.join(path.dirname(file), path.basename(file).replace(/\.mp4$/i, "") + `.spd${Date.now()}.mp4`);

  onLog(`⏩ Tăng tốc video ${sp.toFixed(2)}×...`);
  if (meta.hasAudio) {
    await run(FFMPEG, [
      "-hide_banner", "-y", "-i", file,
      "-filter_complex", `[0:v]setpts=${(1 / sp).toFixed(4)}*PTS[v];[0:a]atempo=${sp.toFixed(4)}[a]`,
      "-map", "[v]", "-map", "[a]", ...venc,
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", tmp,
    ], { cwd: WORK, onLog: (l) => onLog("    " + l) });
  } else {
    await run(FFMPEG, [
      "-hide_banner", "-y", "-i", file,
      "-filter:v", `setpts=${(1 / sp).toFixed(4)}*PTS`, ...venc,
      "-an", "-movflags", "+faststart", tmp,
    ], { cwd: WORK, onLog: (l) => onLog("    " + l) });
  }
  // Đè bản tăng tốc lên file gốc (copy rồi xoá tạm — chạy được cả khi khác ổ đĩa).
  try { fs.copyFileSync(tmp, file); fs.unlinkSync(tmp); }
  catch (e) { onLog("  ⚠ thay file tốc độ lỗi: " + e.message); }
  return file;
}

// Áp tốc độ TẠI CHỖ cho MỌI file video trong kết quả job: outPath, clips[], parts[], results[].
// Gọi 1 lần trong mỗi handler TRƯỚC publishOutputs/đăng Lark là mọi khâu dùng bản đã tăng tốc.
export async function speedUpResult(result, speed, onLog = () => {}) {
  const sp = Number(speed) || 1;
  if (!result || Math.abs(sp - 1) < 0.01) return result;
  const files = new Set();
  if (result.outPath) files.add(result.outPath);
  for (const key of ["clips", "parts", "results"]) {
    if (Array.isArray(result[key])) {
      for (const it of result[key]) if (it && it.outPath) files.add(it.outPath);
    }
  }
  for (const f of files) {
    try { await speedUpVideo(f, sp, { onLog }); }
    catch (e) { onLog("  ⚠ tăng tốc lỗi (" + path.basename(f) + "): " + e.message); }
  }
  return result;
}
