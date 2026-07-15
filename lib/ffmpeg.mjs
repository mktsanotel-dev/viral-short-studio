// Bọc ffmpeg/ffprobe: đọc metadata, phát hiện cắt cảnh, khoảng lặng, âm lượng.
import { run } from "./util.mjs";

const FFMPEG = process.env.VSS_FFMPEG || "ffmpeg";
const FFPROBE = process.env.VSS_FFPROBE || "ffprobe";

// Có GPU NVENC DÙNG ĐƯỢC THẬT không? (test-encode 1 frame — driver cũ sẽ trượt về CPU)
let _nvenc = null;
export async function hasNvenc() {
  if (_nvenc !== null) return _nvenc;
  try {
    const { out } = await run(FFMPEG, ["-hide_banner", "-encoders"]);
    if (!/h264_nvenc/.test(out)) { _nvenc = false; return _nvenc; }
    // Thử encode thật 1 frame: nếu driver không đủ mới, lệnh này sẽ lỗi.
    await run(FFMPEG, [
      "-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
      "-c:v", "h264_nvenc", "-f", "null", "-",
    ]);
    _nvenc = true;
  } catch {
    _nvenc = false; // encoder có nhưng driver không chạy được → dùng CPU
  }
  return _nvenc;
}

export async function probe(file) {
  const { out } = await run(FFPROBE, [
    "-v", "quiet", "-print_format", "json",
    "-show_format", "-show_streams", file,
  ]);
  const data = JSON.parse(out);
  const v = (data.streams || []).find((s) => s.codec_type === "video") || {};
  const a = (data.streams || []).find((s) => s.codec_type === "audio");
  const dur = parseFloat(data.format?.duration || v.duration || 0) || 0;
  let fps = 0;
  if (v.avg_frame_rate && v.avg_frame_rate.includes("/")) {
    const [n, d] = v.avg_frame_rate.split("/").map(Number);
    fps = d ? n / d : 0;
  }
  const w = v.width || 0;
  const h = v.height || 0;
  return {
    duration: dur,
    width: w,
    height: h,
    fps: Math.round(fps * 100) / 100,
    aspect: h ? Math.round((w / h) * 1000) / 1000 : 0,
    isVertical: h > w,
    is916: h > w && Math.abs(w / h - 9 / 16) < 0.06,
    vcodec: v.codec_name || "",
    acodec: a?.codec_name || "",
    hasAudio: !!a,
    bitrate: parseInt(data.format?.bit_rate || 0) || 0,
    sizeMB: Math.round((parseInt(data.format?.size || 0) / 1048576) * 10) / 10,
  };
}

// Phát hiện cắt cảnh: trả về mảng mốc thời gian (giây).
export async function detectScenes(file, threshold = 0.35) {
  const times = [];
  try {
    const { err } = await run(FFMPEG, [
      "-hide_banner", "-i", file,
      "-filter:v", `select='gt(scene,${threshold})',showinfo`,
      "-f", "null", "-",
    ]);
    const re = /pts_time:([0-9.]+)/g;
    let m;
    while ((m = re.exec(err))) times.push(parseFloat(m[1]));
  } catch {
    /* bỏ qua, coi như không có cảnh */
  }
  return times;
}

// Phát hiện khoảng lặng: trả về mảng {start,end}.
export async function detectSilences(file, noiseDb = -30, minDur = 0.4) {
  const silences = [];
  try {
    const { err } = await run(FFMPEG, [
      "-hide_banner", "-i", file,
      "-af", `silencedetect=noise=${noiseDb}dB:d=${minDur}`,
      "-f", "null", "-",
    ]);
    const starts = [...err.matchAll(/silence_start:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]));
    const ends = [...err.matchAll(/silence_end:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]));
    for (let i = 0; i < starts.length; i++) {
      silences.push({ start: starts[i], end: ends[i] ?? starts[i] });
    }
  } catch {
    /* bỏ qua */
  }
  return silences;
}

// Đo âm lượng tổng hợp (LUFS) qua ebur128.
export async function measureLoudness(file) {
  try {
    const { err } = await run(FFMPEG, [
      "-hide_banner", "-i", file, "-af", "ebur128=framelog=verbose",
      "-f", "null", "-",
    ]);
    const I = [...err.matchAll(/I:\s*(-?[0-9.]+)\s*LUFS/g)].pop();
    const LRA = [...err.matchAll(/LRA:\s*(-?[0-9.]+)\s*LU/g)].pop();
    return {
      integratedLUFS: I ? parseFloat(I[1]) : null,
      range: LRA ? parseFloat(LRA[1]) : null,
    };
  } catch {
    return { integratedLUFS: null, range: null };
  }
}

// Trích 1 khung hình làm thumbnail.
export async function thumbnail(file, outJpg, atSec = 1) {
  await run(FFMPEG, [
    "-hide_banner", "-y", "-ss", String(atSec), "-i", file,
    "-frames:v", "1", "-q:v", "3", "-vf", "scale=360:-1", outJpg,
  ]);
  return outJpg;
}

export { FFMPEG, FFPROBE };
