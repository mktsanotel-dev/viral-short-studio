// 🎬 KÊNH CHO THUÊ — video CHỈ có VOICE + CẢNH (không có mặt người nói).
//  • Voice: file / ghi âm / VĂN BẢN→GIỌNG AI; lọc ồn, bỏ à/ừ ngắt quãng, tốc độ 1 / 1.1 / 1.2.
//  • Cảnh: trám NHIỀU cảnh khác nhau LINH ĐỘNG từ 1 thư mục (xoay vòng, không lặp liền).
//  • Màu: "chill" + HSL sáng da màu cam.
//  • Nhạc nền: PHỐI NHIỀU đoạn nhạc khác nhau trong 1 video (crossfade), nhường giọng.
//  • Kèm: phụ đề Roboto (+ sửa phụ đề), từ khóa phóng to giữa màn, hook, logo.
import path from "node:path";
import fs from "node:fs";
import { run, WORK, slug } from "./util.mjs";
import { FFMPEG, probe, hasNvenc } from "./ffmpeg.mjs";
import {
  transcribeWords, buildAssCaptions, buildKeywordAss, buildHookAss, saveAss,
  applyEditedText, transcriptSegments,
} from "./transcribe.mjs";
import { assFilter } from "./fonts.mjs";
import { chillGrade, logoScaleFilter, logoPosition, logoPositionXY } from "./effects.mjs";
import { cleanVoice } from "./voiceclean.mjs";
import { textToSpeech } from "./tts.mjs";

const FPS = 30;
const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v)$/i;
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|bmp)$/i;

function encoder(useGpu) {
  return useGpu
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-b:v", "0"]
    : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
}
function dims(aspect) {
  if (aspect === "11") return { W: 1080, H: 1080 };
  if (aspect === "169") return { W: 1920, H: 1080 };
  return { W: 1080, H: 1920 }; // 9:16 mặc định
}
// Trộn thứ tự (xoay cảnh cho linh động). Không phụ thuộc Math.random ổn định giữa lần chạy.
function shuffle(arr, seed = 7) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function listScenes(folder) {
  const out = [];
  for (const f of fs.readdirSync(folder)) {
    const full = path.join(folder, f);
    try { if (!fs.statSync(full).isFile()) continue; } catch { continue; }
    if (VIDEO_EXT.test(f)) out.push({ file: full, kind: "video" });
    else if (IMAGE_EXT.test(f)) out.push({ file: full, kind: "image" });
  }
  return out;
}

// 🎞️ MONTAGE: phủ đủ D giây bằng nhiều cảnh khác nhau (xoay vòng), crop khung + màu chill.
async function buildMontage(scenes, D, { id, W, H, sceneDur = 3.6, colorPreset, useGpu, onLog }) {
  if (!scenes.length) throw new Error("Thư mục cảnh trống (không có video/ảnh).");
  const N = Math.max(1, Math.min(80, Math.ceil(D / sceneDur)));
  const bag = shuffle(scenes);
  const seq = [];
  for (let i = 0; i < N; i++) seq.push(bag[i % bag.length]);
  onLog(`→ Dựng montage: ${N} cảnh (từ ${scenes.length} file), mỗi cảnh ~${sceneDur}s → phủ ${D.toFixed(1)}s`);

  const args = ["-hide_banner", "-y"];
  seq.forEach((s) => {
    if (s.kind === "image") args.push("-loop", "1", "-t", String(sceneDur), "-i", s.file);
    else args.push("-stream_loop", "-1", "-t", String(sceneDur), "-i", s.file);
  });
  let fc = "";
  seq.forEach((_, i) => {
    fc += `[${i}:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS}[v${i}];`;
  });
  fc += seq.map((_, i) => `[v${i}]`).join("") + `concat=n=${N}:v=1:a=0[cat]`;
  const grade = colorPreset && colorPreset !== "off" ? chillGrade(colorPreset) : null;
  fc += grade ? `;[cat]${grade}[vout]` : `;[cat]null[vout]`;

  const out = path.join(WORK, `${id}_montage.mp4`);
  args.push("-filter_complex", fc, "-map", "[vout]", "-t", D.toFixed(3),
    "-an", "-r", String(FPS), ...encoder(useGpu), "-pix_fmt", "yuv420p", out);
  await run(FFMPEG, args, { cwd: WORK, onLog: (l) => onLog("  " + l) });
  return out;
}

// 🎵 NHẠC NỀN nhiều đoạn: crossfade nối các bài → lặp/cắt đúng D → fade cuối.
async function buildMusicBed(musicPaths, D, { id, crossfade = 1.5, onLog }) {
  const list = (musicPaths || []).filter((m) => m && fs.existsSync(m));
  if (!list.length) return null;
  onLog(`→ Phối nhạc nền: ${list.length} đoạn (crossfade ${crossfade}s) → phủ ${D.toFixed(1)}s`);
  const playlist = path.join(WORK, `${id}_playlist.m4a`);

  if (list.length === 1) {
    await run(FFMPEG, ["-hide_banner", "-y", "-i", list[0], "-vn", "-ar", "48000", "-ac", "2", "-c:a", "aac", playlist], { cwd: WORK, onLog: () => {} });
  } else {
    const args = ["-hide_banner", "-y"];
    list.forEach((m) => args.push("-i", m));
    let fc = "", cur = "[0:a]";
    for (let i = 1; i < list.length; i++) {
      const out = i === list.length - 1 ? "[aout]" : `[a${i}]`;
      fc += `${cur}[${i}:a]acrossfade=d=${crossfade}:c1=tri:c2=tri${out};`;
      cur = out;
    }
    fc = fc.replace(/;$/, "");
    args.push("-filter_complex", fc, "-map", "[aout]", "-ar", "48000", "-ac", "2", "-c:a", "aac", playlist);
    await run(FFMPEG, args, { cwd: WORK, onLog: () => {} });
  }
  // Lặp playlist cho đủ D rồi cắt + fade cuối 2s.
  const bed = path.join(WORK, `${id}_bed.m4a`);
  const fadeSt = Math.max(0, D - 2);
  await run(FFMPEG, ["-hide_banner", "-y", "-stream_loop", "-1", "-i", playlist,
    "-t", D.toFixed(3), "-af", `afade=t=out:st=${fadeSt.toFixed(2)}:d=2`,
    "-ar", "48000", "-ac", "2", "-c:a", "aac", bed], { cwd: WORK, onLog: () => {} });
  try { fs.unlinkSync(playlist); } catch { /* dọn */ }
  return bed;
}

export async function rentalVideo(opts = {}) {
  const {
    onLog = () => {}, id = "rental", outPath,
    // VOICE
    voicePath = null, ttsText = null, ttsVoice = "hoaimy",
    voiceClean = "studio", enhance = true, cutFillers = true,
    voiceSpeed = 1, voiceGain = 0,
    // SCENES
    scenesFolder = null, sceneDur = 3.6, aspect = "916", colorPreset = "chill",
    // MUSIC
    musicPaths = [], musicVol = 0.16, crossfade = 1.5,
    // CHỮ
    doCaptions = true, captionStyle = "karaoke", keywords = "", hookText = null,
    editedSegments = null,
    // LOGO
    logoPath = null, logoPos = "br", logoScale = 0.16, logoOpacity = 0.95, logoX = null, logoY = null,
    normalize = true, model = "medium", lang = "vi",
  } = opts;

  onLog("=== 🎬 KÊNH CHO THUÊ — BẮT ĐẦU ===");
  const useGpu = await hasNvenc();
  const { W, H } = dims(aspect);
  const temps = [];

  // 1) Nguồn giọng: văn bản→giọng AI, hoặc file/ghi âm.
  let rawVoice = voicePath;
  if (!rawVoice && ttsText && String(ttsText).trim()) {
    onLog("→ Tạo giọng AI từ văn bản…");
    const tts = await textToSpeech(ttsText, { voice: ttsVoice, outPath: path.join(WORK, `${id}_tts.mp3`), onLog: (l) => onLog("  " + l) });
    rawVoice = tts.path; temps.push(rawVoice);
  }
  if (!rawVoice || !fs.existsSync(rawVoice)) throw new Error("Chưa có giọng đọc (chọn file, ghi âm, hoặc nhập văn bản để tạo giọng AI).");

  // 2) Làm sạch giọng (bỏ à/ừ + khoảng chết, giảm ồn, đánh bóng, tốc độ 1/1.1/1.2, chuẩn âm).
  onLog("→ Làm sạch giọng…");
  const cleaned = await cleanVoice(rawVoice, {
    onLog: (l) => onLog("  " + l), id,
    outPath: path.join(WORK, `${id}_voice.mp3`),
    cutFillers, denoise: voiceClean, enhance,
    tempo: voiceSpeed, volumeGain: voiceGain, normalize: true,
    model, lang,
  });
  temps.push(cleaned.outPath);
  const D = cleaned.meta.duration || 1;

  // 3) Phụ đề: nghe LẠI giọng đã sạch (khớp đúng thời lượng cuối).
  let tr = null;
  if (doCaptions || keywords) {
    onLog("→ Nhận diện lời (cho phụ đề)…");
    try { tr = await transcribeWords(cleaned.outPath, { model, lang, onLog: (l) => onLog("  " + l) }); }
    catch (e) { onLog("  ⚠ whisper lỗi: " + e.message); }
    if (editedSegments && tr) { tr = applyEditedText(tr, editedSegments); onLog("  ✍️ đã áp phụ đề sửa tay"); }
  }

  // 4) Montage cảnh phủ đúng độ dài giọng.
  if (!scenesFolder || !fs.existsSync(scenesFolder)) throw new Error("Chưa chọn THƯ MỤC CẢNH (b-roll).");
  const scenes = listScenes(scenesFolder);
  const montage = await buildMontage(scenes, D, { id, W, H, sceneDur, colorPreset, useGpu, onLog });
  temps.push(montage);

  // 5) Nhạc nền nhiều đoạn.
  const bed = await buildMusicBed(musicPaths, D, { id, crossfade, onLog });
  if (bed) temps.push(bed);

  // 6) Các lớp chữ (phụ đề · từ khóa · hook).
  const layers = [];
  if (doCaptions && tr && (tr.words || []).length) {
    const ass = buildAssCaptions(tr, { videoW: W, videoH: H, style: captionStyle, marginV: Math.round(H * 0.18) });
    const f = path.join(WORK, `${id}.cap.ass`); saveAss(ass, f); temps.push(f); layers.push(path.basename(f));
    onLog("  phụ đề Roboto ✔");
  }
  if (keywords && tr && (tr.words || []).length) {
    const kass = buildKeywordAss(keywords, tr, { videoW: W, videoH: H });
    if (kass) { const f = path.join(WORK, `${id}.kw.ass`); saveAss(kass, f); temps.push(f); layers.push(path.basename(f)); onLog("  từ khóa giữa màn ✔"); }
  }
  if (hookText && String(hookText).trim()) {
    const hass = buildHookAss(hookText, { videoW: W, videoH: H, dur: Math.min(D, 3) });
    if (hass) { const f = path.join(WORK, `${id}.hook.ass`); saveAss(hass, f); temps.push(f); layers.push(path.basename(f)); }
  }

  // 7) Render cuối: montage + chữ + logo; audio = giọng (+ nhạc nền nhường giọng).
  onLog("→ Render cuối (ghép giọng + nhạc + chữ + logo)…");
  const args = ["-hide_banner", "-y", "-i", montage, "-i", cleaned.outPath];
  let idx = 2, bedIdx = null, logoIdx = null;
  if (bed) { args.push("-i", bed); bedIdx = idx++; }
  if (logoPath && fs.existsSync(logoPath)) { args.push("-loop", "1", "-i", logoPath); logoIdx = idx++; }

  let complex = "", v = "[0:v]", first = true;
  layers.forEach((base, i) => {
    const inL = first ? "[0:v]" : v;
    complex += `${first ? "" : ";"}${inL}${assFilter(base)}[l${i}]`;
    v = `[l${i}]`; first = false;
  });
  if (logoIdx != null) {
    complex += `${complex ? ";" : ""}[${logoIdx}:v]${logoScaleFilter({ scale: logoScale, opacity: logoOpacity, targetW: W })}[lg]`;
    const xy = (logoX != null && logoY != null) ? logoPositionXY(logoX, logoY) : logoPosition(logoPos, Math.round(W * 0.03));
    const src = complex ? v : "[0:v]";
    complex += `;${src}[lg]overlay=${xy}:shortest=1[vl]`;
    v = "[vl]";
  }
  const vOut = complex ? v : "[0:v]";

  // Audio: giọng chính; nhạc nền nhường giọng (sidechaincompress) rồi trộn.
  let aOut = "1:a";
  if (bedIdx != null) {
    complex += `${complex ? ";" : ""}[${bedIdx}:a]volume=${musicVol}[bg];` +
      `[bg][1:a]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[duck];` +
      `[1:a][duck]amix=inputs=2:normalize=0:duration=first[amx]`;
    aOut = "[amx]";
    if (normalize) { complex += `;[amx]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`; aOut = "[aout]"; }
  }

  const mapArgs = complex ? ["-filter_complex", complex, "-map", vOut] : ["-map", "0:v"];
  mapArgs.push("-map", aOut);
  await run(FFMPEG, [...args, ...mapArgs,
    "-r", String(FPS), ...encoder(useGpu), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", outPath,
  ], { cwd: WORK, onLog: (l) => onLog("  " + l) });

  for (const t of temps) { try { fs.unlinkSync(t); } catch { /* dọn */ } }
  onLog("=== XONG ===");
  const meta = await probe(outPath);
  return {
    outPath, meta,
    segments: transcriptSegments(tr),
    transcriptText: tr ? (tr.segments || []).map((s) => s.text).join(" ").trim() : "",
    duration: D, scenes: scenes.length,
  };
}
