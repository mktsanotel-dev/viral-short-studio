// Chấm điểm khả năng viral của video short dựa trên tín hiệu kỹ thuật + transcript.
// 6 trục: Hook 3s · Nhịp cắt · Giữ chân · Âm thanh · Định dạng · Phụ đề/Nội dung.
import { probe, detectScenes, detectSilences, measureLoudness } from "./ffmpeg.mjs";
import { transcribeWords } from "./transcribe.mjs";
import { clamp } from "./util.mjs";

// preTranscript: transcript đã gõ sẵn (word-level, mốc TƯƠNG ĐỐI theo file này) — nếu có
// thì KHÔNG gõ lại whisper. Dùng khi chấm điểm kỹ thuật cho short vừa cắt (đã có transcript).
export async function evaluate(file, { onLog = () => {}, doTranscript = true, model = "small", lang = "vi", preTranscript = null } = {}) {
  onLog("→ Đọc thông tin video (ffprobe)...");
  const meta = await probe(file);
  onLog(`  ${meta.width}x${meta.height} · ${meta.duration.toFixed(1)}s · ${meta.fps}fps · ${meta.is916 ? "9:16 ✓" : "KHÔNG 9:16"}`);

  onLog("→ Phát hiện cắt cảnh...");
  const scenes = await detectScenes(file);
  onLog(`  ${scenes.length} điểm cắt cảnh`);

  onLog("→ Phân tích khoảng lặng...");
  const silences = meta.hasAudio ? await detectSilences(file) : [];
  onLog("→ Đo âm lượng (LUFS)...");
  const loud = meta.hasAudio ? await measureLoudness(file) : { integratedLUFS: null, range: null };

  let transcript = preTranscript && (preTranscript.words || []).length ? preTranscript : null;
  if (!transcript && doTranscript && meta.hasAudio) {
    onLog("→ Gõ chữ (whisper) để chấm hook & nội dung...");
    try {
      transcript = await transcribeWords(file, { model, lang, onLog: (l) => onLog("  " + l) });
    } catch (e) {
      onLog("  ⚠ Không gõ được chữ: " + e.message);
    }
  }

  const dur = meta.duration || 0.001;
  const D = {};

  // ---- 1. HOOK 3s: có chuyển động sớm + có lời/chữ trong 3s đầu ----
  const scenesIn3 = scenes.filter((t) => t <= 3).length;
  const wordsIn3 = transcript ? (transcript.words || []).filter((w) => w.start <= 3).length : null;
  const silentStart = silences.some((s) => s.start <= 0.2 && s.end >= 1.2);
  let hook = 45;
  hook += clamp(scenesIn3 * 15, 0, 30); // có cắt/chuyển động sớm
  if (wordsIn3 !== null) hook += clamp(wordsIn3 * 4, 0, 25); // có nói ngay
  if (silentStart) hook -= 25; // mở đầu lặng = mất người xem
  hook = clamp(Math.round(hook), 0, 100);
  D.hook = {
    score: hook,
    label: "Hook 3 giây đầu",
    detail: `${scenesIn3} chuyển cảnh + ${wordsIn3 ?? "?"} từ trong 3s đầu${silentStart ? ", MỞ ĐẦU BỊ LẶNG" : ""}`,
    tips: [
      silentStart && "Cắt bỏ đoạn lặng đầu — phải có hình động/lời nói ngay giây 0.",
      scenesIn3 === 0 && "Thêm zoom/chuyển cảnh trong 1.5s đầu để chống lướt.",
      wordsIn3 === 0 && "Đặt câu hook bằng lời hoặc chữ to ngay giây đầu.",
    ].filter(Boolean),
  };

  // ---- 2. NHỊP CẮT: số cắt / phút, lý tưởng short 20-45 cuts/phút ----
  const cutsPerMin = scenes.length / (dur / 60);
  let pacing;
  if (cutsPerMin >= 18 && cutsPerMin <= 55) pacing = 90;
  else if (cutsPerMin >= 10) pacing = 70;
  else if (cutsPerMin >= 5) pacing = 55;
  else pacing = 35;
  D.pacing = {
    score: pacing,
    label: "Nhịp cắt / chuyển cảnh",
    detail: `${cutsPerMin.toFixed(1)} chuyển cảnh mỗi phút`,
    tips: [
      cutsPerMin < 10 && "Nhịp chậm — thêm cắt, zoom-punch hoặc b-roll mỗi 2-4s.",
      cutsPerMin > 60 && "Nhịp quá dồn — có thể gây rối, giãn bớt vài cảnh.",
    ].filter(Boolean),
  };

  // ---- 3. GIỮ CHÂN: tỉ lệ lặng + đoạn tĩnh dài ----
  const totalSilence = silences.reduce((a, s) => a + (s.end - s.start), 0);
  const silenceRatio = meta.hasAudio ? totalSilence / dur : 0;
  const longGaps = silences.filter((s) => s.end - s.start >= 1.2).length;
  let retention = 90;
  retention -= clamp(silenceRatio * 120, 0, 45);
  retention -= clamp(longGaps * 8, 0, 30);
  if (dur > 90) retention -= 15; // short quá dài dễ tụt giữ chân
  retention = clamp(Math.round(retention), 0, 100);
  D.retention = {
    score: retention,
    label: "Giữ chân người xem",
    detail: `${(silenceRatio * 100).toFixed(0)}% thời lượng là khoảng lặng · ${longGaps} khoảng chết ≥1.2s · dài ${dur.toFixed(0)}s`,
    tips: [
      longGaps > 0 && `Dùng "Cắt khoảng lặng" để xoá ${longGaps} khoảng chết → nhịp gọn hơn.`,
      dur > 90 && "Video dài — cân nhắc rút còn 30-60s cho short.",
    ].filter(Boolean),
  };

  // ---- 4. ÂM THANH: mức LUFS + độ đồng đều ----
  let audio;
  const lufs = loud.integratedLUFS;
  if (!meta.hasAudio) {
    audio = 20;
  } else if (lufs === null) {
    audio = 60;
  } else {
    // Mục tiêu MXH ~ -14 LUFS. Càng lệch càng trừ.
    const dist = Math.abs(lufs - -14);
    audio = clamp(Math.round(95 - dist * 4), 30, 100);
  }
  D.audio = {
    score: audio,
    label: "Âm thanh",
    detail: !meta.hasAudio ? "KHÔNG có tiếng" : `${lufs ?? "?"} LUFS (mục tiêu ~ -14) · dải động ${loud.range ?? "?"} LU`,
    tips: [
      !meta.hasAudio && "Thêm giọng nói/nhạc — video câm khó viral.",
      lufs !== null && lufs < -18 && "Âm quá nhỏ — chuẩn hoá lên ~ -14 LUFS (bật 'Chuẩn âm').",
      lufs !== null && lufs > -10 && "Âm quá to/dễ vỡ — hạ về ~ -14 LUFS.",
    ].filter(Boolean),
  };

  // ---- 5. ĐỊNH DẠNG: 9:16 + thời lượng + độ phân giải ----
  let fmt = 50;
  if (meta.is916) fmt += 30;
  else if (meta.isVertical) fmt += 10;
  if (dur >= 8 && dur <= 60) fmt += 15;
  else if (dur <= 90) fmt += 5;
  if (meta.height >= 1080) fmt += 5;
  fmt = clamp(Math.round(fmt), 0, 100);
  D.format = {
    score: fmt,
    label: "Định dạng short",
    detail: `${meta.is916 ? "9:16" : meta.isVertical ? "dọc (chưa chuẩn 9:16)" : "NGANG"} · ${meta.height}p · ${dur.toFixed(0)}s`,
    tips: [
      !meta.is916 && "Chuyển sang 9:16 (1080x1920) — bật 'Reframe 9:16' khi biên tập.",
      dur > 90 && "Rút ngắn còn dưới 60s.",
      meta.height < 1080 && "Độ phân giải thấp — nên xuất tối thiểu 1080p.",
    ].filter(Boolean),
  };

  // ---- 6. PHỤ ĐỀ / NỘI DUNG ----
  const wpm = transcript ? (transcript.words?.length || 0) / (dur / 60) : null;
  let content = 55;
  if (transcript && transcript.words?.length) {
    content = 70;
    if (wpm >= 120 && wpm <= 240) content += 15; // tốc độ nói tốt
    if ((transcript.segments?.length || 0) >= 3) content += 10;
  }
  content = clamp(content, 0, 100);
  D.content = {
    score: content,
    label: "Nội dung & phụ đề",
    detail: transcript
      ? `${transcript.words?.length || 0} từ · ${wpm ? wpm.toFixed(0) : "?"} từ/phút`
      : "Chưa gõ chữ",
    tips: [
      "Luôn thêm PHỤ ĐỀ ĐỘNG (85% xem không bật tiếng) — bật 'Phụ đề động' khi biên tập.",
      wpm !== null && wpm < 100 && "Nói hơi chậm/thưa — cắt khoảng lặng để dồn nhịp.",
    ].filter(Boolean),
  };

  // ---- Tổng điểm có trọng số ----
  const weights = { hook: 0.28, pacing: 0.15, retention: 0.2, audio: 0.12, format: 0.13, content: 0.12 };
  let overall = 0;
  for (const k of Object.keys(weights)) overall += D[k].score * weights[k];
  overall = Math.round(overall);

  const verdict =
    overall >= 80 ? "Tiềm năng viral cao — sẵn sàng đăng" :
    overall >= 65 ? "Khá — sửa vài điểm là bùng" :
    overall >= 50 ? "Trung bình — cần biên tập lại" :
    "Yếu — nên dựng lại theo gợi ý";

  return {
    file,
    meta,
    overall,
    verdict,
    dimensions: D,
    signals: {
      scenes: scenes.length,
      cutsPerMin: Math.round(cutsPerMin * 10) / 10,
      silences: silences.length,
      silenceRatio: Math.round(silenceRatio * 1000) / 1000,
      longGaps,
      lufs,
      wpm: wpm ? Math.round(wpm) : null,
    },
    transcriptText: transcript ? (transcript.segments || []).map((s) => s.text).join(" ") : null,
    _transcript: transcript,
  };
}
