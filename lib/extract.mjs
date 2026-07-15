// Bóc ý tưởng từ video viral: tải bằng yt-dlp, gõ chữ, phân tích hook + cấu trúc + nhịp.
import path from "node:path";
import fs from "node:fs";
import { run, WORK, slug } from "./util.mjs";
import { evaluate } from "./evaluate.mjs";

const YTDLP = process.env.VSS_YTDLP || "yt-dlp";

// Tải video từ URL về work/. Trả về đường dẫn file.
export async function download(url, { onLog = () => {}, id = "dl" } = {}) {
  const outTpl = path.join(WORK, `${id}.%(ext)s`);
  onLog("→ Tải video bằng yt-dlp...");
  await run(
    YTDLP,
    [
      "-f", "mp4/bestvideo[ext=mp4]+bestaudio/best",
      "--merge-output-format", "mp4",
      "--no-playlist",
      "-o", outTpl,
      url,
    ],
    { onLog: (l) => onLog("  " + l) }
  );
  // tìm file vừa tải
  const files = fs.readdirSync(WORK).filter((f) => f.startsWith(id + ".") && /\.(mp4|mkv|webm|mov)$/i.test(f));
  if (!files.length) throw new Error("Không tìm thấy file tải về");
  return path.join(WORK, files.sort()[0]);
}

// Bóc ý tưởng: phân tích kỹ thuật + tách hook/cấu trúc từ transcript.
export async function extractIdeas(file, { onLog = () => {}, lang = "vi", model = "small" } = {}) {
  const ev = await evaluate(file, { onLog, doTranscript: true, model, lang });
  const tr = ev._transcript;

  // Hook = 3s đầu của transcript
  let hookText = "";
  let bodyBeats = [];
  if (tr && tr.segments?.length) {
    hookText = tr.segments.filter((s) => s.start <= 4).map((s) => s.text).join(" ").trim();
    // Chia "nhịp" theo segment (mỗi câu = 1 beat)
    bodyBeats = tr.segments.map((s) => ({
      t: Math.round(s.start),
      text: s.text,
    }));
  }

  return {
    file,
    meta: ev.meta,
    overall: ev.overall,
    signals: ev.signals,
    hook: hookText || "(không nghe được lời mở đầu)",
    beats: bodyBeats,
    transcript: ev.transcriptText,
    structure: {
      durationSec: Math.round(ev.meta.duration),
      cutsPerMin: ev.signals.cutsPerMin,
      wpm: ev.signals.wpm,
      is916: ev.meta.is916,
    },
  };
}

export { YTDLP };
