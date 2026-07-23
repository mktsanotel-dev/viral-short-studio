// 🎙️ XỬ LÝ GIỌNG (audio-only): bỏ à/ừ + khoảng chết, giảm ồn, tăng âm lượng, chỉnh tốc độ.
// Nhận 1 file GIỌNG (mp3/wav/m4a…) hoặc video CÓ TIẾNG → xuất 1 file giọng ĐÃ LÀM SẠCH (mp3).
// Tái dùng đúng bộ lọc của các tab khác (fillers + voiceCleanFilter + voiceEnhance) để chất
// lượng đồng nhất; KHÔNG đụng tới video — chỉ lo phần tiếng.
import path from "node:path";
import fs from "node:fs";
import { run, WORK } from "./util.mjs";
import { FFMPEG, probe } from "./ffmpeg.mjs";
import { transcribeWords } from "./transcribe.mjs";
import { planClipCuts } from "./fillers.mjs";
import { voiceCleanFilter, voiceEnhance } from "./effects.mjs";

export async function cleanVoice(input, opts = {}) {
  const {
    onLog = () => {}, id = "voice", outPath,
    cutFillers = true,     // bỏ tiếng đệm à/ừ + khoảng chết
    silenceMax = 0.6,      // khoảng lặng dài hơn (giây) thì cắt
    denoise = "studio",    // giảm ồn: off | low | medium | high | studio
    enhance = false,       // đánh bóng cho rõ chữ (EQ + nén nhẹ)
    normalize = true,      // chuẩn âm -14 LUFS (đều to/nhỏ)
    volumeGain = 0,        // tăng âm lượng thủ công (dB), áp SAU chuẩn âm
    tempo = 1.0,           // tốc độ: 1.0 / 1.1 / 1.2 …
    model = "medium", lang = "vi",
  } = opts;

  if (!input || !fs.existsSync(input)) throw new Error("Không thấy file giọng đầu vào");
  const out = outPath || path.join(WORK, `${id}-voice-clean.mp3`);
  const meta = await probe(input);
  if (!meta.hasAudio) throw new Error("File không có tiếng — hãy chọn file giọng hoặc video có tiếng.");

  onLog("=== 🎙️ XỬ LÝ GIỌNG ===");

  // 1) Cắt à/ừ + khoảng chết dựa trên mốc TỪNG TỪ (whisper) — chỉ khi bật.
  let sel = null;
  if (cutFillers) {
    onLog("🔎 Nhận diện lời để tìm à/ừ + khoảng chết...");
    try {
      const tr = await transcribeWords(input, { model, lang, onLog: (l) => onLog("  " + l) });
      const { keep, cuts } = planClipCuts(tr.words || [], 0, meta.duration, { silenceMax });
      if (keep && keep.length && cuts && cuts.length) {
        sel = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join("+");
        const removed = cuts.reduce((s, [a, b]) => s + (b - a), 0);
        onLog(`  ✂️ bỏ ${cuts.length} đoạn đệm/khoảng chết (~${removed.toFixed(1)}s).`);
      } else onLog("  ✓ không có à/ừ / khoảng chết đáng kể để cắt.");
    } catch (e) { onLog("  ⚠ nhận diện lời lỗi: " + e.message + " → bỏ qua cắt à/ừ."); }
  }

  // 2) Chuỗi lọc âm thanh (thứ tự: cắt → giảm ồn → đánh bóng → tốc độ → chuẩn âm → tăng âm lượng).
  const af = [];
  if (sel) af.push(`aselect='${sel}'`, "asetpts=N/SR/TB");
  const dn = voiceCleanFilter(denoise); if (dn) af.push(dn);
  if (enhance) { const en = voiceEnhance(typeof enhance === "string" ? enhance : "studio"); if (en) af.push(en); }
  const t = Math.max(0.5, Math.min(2, Number(tempo) || 1));
  if (Math.abs(t - 1) > 0.001) af.push(`atempo=${t.toFixed(3)}`); // atempo giữ nguyên cao độ, có sẵn mọi build
  if (normalize) af.push("loudnorm=I=-14:TP=-1.5:LRA=11");
  const g = Number(volumeGain) || 0;
  if (Math.abs(g) > 0.01) { af.push(`volume=${g}dB`); if (g > 0) af.push("alimiter=limit=0.97"); } // chặn vỡ tiếng khi đẩy to
  if (!af.length) af.push("anull");

  onLog(`🎚️ Lọc: giảm ồn=${denoise}${enhance ? " · đánh bóng" : ""}${t !== 1 ? ` · tốc độ ${t}x` : ""}${normalize ? " · chuẩn -14 LUFS" : ""}${g ? ` · ${g > 0 ? "+" : ""}${g}dB` : ""}`);
  await run(FFMPEG, [
    "-hide_banner", "-y", "-i", input,
    "-af", af.join(","),
    "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", out,
  ], { cwd: WORK, onLog: (l) => onLog("  " + l) });

  const outMeta = await probe(out);
  onLog(`✅ Xong giọng sạch: ${out} (${outMeta.duration.toFixed(1)}s)`);
  return { outPath: out, meta: outMeta, srcDuration: meta.duration };
}
