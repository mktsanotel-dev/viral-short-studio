// Sound effects: tạo sẵn tiếng "whoosh" chuyển cảnh (1 lần) vào assets/.
// Dùng ffmpeg tổng hợp: nhiễu trắng + lọc + fade nhanh → tiếng vút.
import path from "node:path";
import fs from "node:fs";
import { run, ASSETS } from "./util.mjs";
import { FFMPEG } from "./ffmpeg.mjs";

const WHOOSH = path.join(ASSETS, "whoosh.wav");

export async function ensureWhoosh() {
  if (fs.existsSync(WHOOSH)) return WHOOSH;
  await run(FFMPEG, [
    "-hide_banner", "-y",
    "-f", "lavfi", "-i", "anoisesrc=color=white:d=0.45:amplitude=0.6:r=44100",
    "-af",
    // quét cao tần → tạo cảm giác "vút"; fade vào nhanh, ra chậm
    "highpass=f=250,lowpass=f=8000," +
    "afade=t=in:st=0:d=0.06,afade=t=out:st=0.12:d=0.33," +
    "volume=2.2",
    "-ac", "2", "-ar", "44100", WHOOSH,
  ]);
  return WHOOSH;
}

export { WHOOSH };
