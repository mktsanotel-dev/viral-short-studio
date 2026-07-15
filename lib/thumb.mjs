// Tạo ảnh THUMBNAIL cho video: trích 1 khung + đắp tiêu đề TO (ASS) → ảnh JPG.
import path from "node:path";
import fs from "node:fs";
import { run, WORK } from "./util.mjs";
import { FFMPEG, probe } from "./ffmpeg.mjs";
import { buildThumbAss, saveAss } from "./transcribe.mjs";
import { assFilter } from "./fonts.mjs";

// videoPath: video nguồn (thường là short đã dựng, đã 9:16 + logo).
// title: chữ in lên thumbnail. atSec: giây trích khung (mặc định 35% thời lượng).
// withText: có đắp chữ hay không (false = chỉ lấy khung sạch).
export async function makeThumbnail(videoPath, title, outJpg, { id = "thumb", atSec = null, withText = true } = {}) {
  const meta = await probe(videoPath);
  const at = atSec != null ? atSec : Math.max(0.5, meta.duration * 0.35);
  const w = meta.width || 1080, h = meta.height || 1920;

  const args = ["-hide_banner", "-y", "-ss", String(at.toFixed(2)), "-i", videoPath];
  let vf = "";
  let assBase = null;
  if (withText) {
    const ass = buildThumbAss(title, { videoW: w, videoH: h });
    if (ass) {
      assBase = `${id}.thumb.ass`;
      saveAss(ass, path.join(WORK, assBase));
      // nhấn nét + tương phản nhẹ cho ảnh bìa bắt mắt, rồi đắp chữ
      vf = `eq=contrast=1.08:saturation=1.12,unsharp=5:5:0.6:5:5:0,${assFilter(assBase)}`;
    }
  }
  if (vf) args.push("-vf", vf);
  args.push("-frames:v", "1", "-q:v", "2", outJpg);

  await run(FFMPEG, args, { cwd: WORK });
  try { if (assBase) fs.unlinkSync(path.join(WORK, assBase)); } catch { /* dọn */ }
  return outJpg;
}
