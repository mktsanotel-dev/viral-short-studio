// BƯỚC 2-3 (spec): phân tích video gốc = tách tiếng → transcript → tín hiệu kỹ thuật
// → điểm cắt cảnh + keyframe → AI rút thông điệp/hook/luận điểm/CTA/dữ kiện cần giữ.
import path from "node:path";
import { WORK } from "../util.mjs";
import { probe, toSdrIfHdr, detectScenes, thumbnail } from "../ffmpeg.mjs";
import { transcribeWords } from "../transcribe.mjs";
import { evaluate } from "../evaluate.mjs";
import { askJSON } from "./ai-json.mjs";
import { analysisPrompt } from "./prompts.mjs";

// Chọn tối đa n mốc thời gian đại diện (ưu tiên điểm cắt cảnh, thiếu thì chia đều).
function pickTimes(scenes, dur, n = 6) {
  const s = (scenes || []).filter((t) => t > 0.3 && t < dur - 0.3);
  if (s.length >= n) {
    const step = s.length / n, out = [];
    for (let i = 0; i < n; i++) out.push(+s[Math.floor(i * step)].toFixed(2));
    return out;
  }
  const out = [...s];
  const need = n - out.length;
  for (let i = 1; i <= need; i++) out.push(+((dur * i) / (need + 1)).toFixed(2));
  return [...new Set(out)].sort((a, b) => a - b).slice(0, n);
}

function normalizeAnalysis(ai = {}) {
  const arr = (x) => (Array.isArray(x) ? x.filter(Boolean).map(String) : x ? [String(x)] : []);
  return {
    chuDe: ai.chuDe || ai.chu_de || "",
    thongDiepCotLoi: ai.thongDiepCotLoi || ai.thong_diep || "",
    doiTuong: ai.doiTuong || "",
    hook: ai.hook || "",
    luanDiem: arr(ai.luanDiem),
    duKienGiu: arr(ai.duKienGiu),
    camXuc: ai.camXuc || "",
    cta: ai.cta || "",
    phongCach: ai.phongCach || "",
    phuDeStyle: ai.phuDeStyle || "",
    canhQuanTrong: arr(ai.canhQuanTrong),
    phanCoTheThay: arr(ai.phanCoTheThay),
  };
}

export async function analyzeSource(file, { onLog = () => {}, id = "rmk", model = "medium", lang = "vi", customRequest = "" } = {}) {
  onLog("→ Chuẩn hoá nguồn (tone-map HDR→SDR nếu cần)...");
  const sourceSdr = await toSdrIfHdr(file, path.join(WORK, `${id}-src-sdr.mp4`), { onLog });

  onLog("→ Đọc thông tin video...");
  const meta = await probe(sourceSdr);
  if (!meta.hasAudio) throw new Error("Video không có âm thanh — không thể phân tích lời thoại.");

  onLog("→ Gõ chữ (transcript, có thể lâu với video dài)...");
  const transcript = await transcribeWords(sourceSdr, { model, lang, onLog: (l) => onLog("  " + l) });
  const transcriptText = (transcript.segments || []).map((s) => s.text).join(" ").trim();
  if (!transcriptText) throw new Error("Không nhận diện được lời nói trong video.");

  onLog("→ Phân tích tín hiệu kỹ thuật (nhịp/cắt/âm)...");
  const ev = await evaluate(sourceSdr, { onLog: () => {}, doTranscript: false, preTranscript: transcript, model, lang });

  onLog("→ Phát hiện cảnh + trích keyframe...");
  const sceneCuts = await detectScenes(sourceSdr).catch(() => []);
  const keyTimes = pickTimes(sceneCuts, meta.duration, 6);
  const keyframes = [];
  for (let i = 0; i < keyTimes.length; i++) {
    const kf = path.join(WORK, `${id}-kf${i}.jpg`);
    try { await thumbnail(sourceSdr, kf, keyTimes[i]); keyframes.push({ t: keyTimes[i], path: kf }); } catch { /* bỏ khung lỗi */ }
  }

  onLog("→ AI phân tích thông điệp cốt lõi...");
  const ai = await askJSON(
    analysisPrompt({ transcriptText, meta, signals: ev.signals, sceneCount: sceneCuts.length, customRequest }),
    { onLog, cache: true }
  );

  // Chia transcript thành "cảnh nội dung" theo câu (đủ cho UI review + storyboard gốc).
  const scenes = (transcript.segments || []).map((s, i) => ({
    stt: i + 1, start: +(s.start || 0).toFixed(2), end: +(s.end || 0).toFixed(2), text: s.text,
  }));

  return {
    sourceSdr,
    transcript,
    transcriptText,
    meta: { width: meta.width, height: meta.height, duration: meta.duration, is916: meta.is916, isHDR: false },
    signals: ev.signals,
    evalOverall: ev.overall,
    sceneCuts,
    keyframes: keyframes.map((k) => ({ t: k.t, path: k.path })),
    scenes,
    ...normalizeAnalysis(ai),
  };
}
