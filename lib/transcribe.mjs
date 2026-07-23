// Gõ chữ word-level bằng faster-whisper (qua script python).
import path from "node:path";
import fs from "node:fs";
import { run, readJSON, SCRIPTS, PY } from "./util.mjs";

// Trả về object transcript {language,duration,segments,words}.
// CACHE: lưu theo file + model. Lần sau cùng file/model → DÙNG LẠI, bỏ qua Whisper (tiết kiệm thời gian).
// force=true để buộc gõ lại (khi file nguồn thay đổi).
export async function transcribeWords(file, { model = "medium", lang = "vi", onLog, force = false } = {}) {
  const cache = file.replace(/\.[^.]+$/, "") + `.${model}.words.json`;
  if (!force) {
    try {
      const cs = fs.statSync(cache), fsr = fs.statSync(file);
      if (cs.mtimeMs >= fsr.mtimeMs) {
        const d = readJSON(cache);
        if (d && !d.error && (d.words || d.segments)) { onLog && onLog(`♻ dùng lại transcript đã lưu (bỏ qua Whisper)`); return d; }
      }
    } catch { /* chưa có cache → gõ mới */ }
  }
  await run(PY, [path.join(SCRIPTS, "transcribe_words.py"), file, cache, model, lang], { onLog });
  const data = readJSON(cache);
  if (!data) throw new Error("Không đọc được kết quả whisper");
  if (data.error) throw new Error("Whisper lỗi: " + data.error);
  return data;
}

// Sinh file phụ đề ASS kiểu viral (từng cụm từ hiện lên, chữ hiện tại đổi màu).
// style: 'karaoke' (highlight từng từ) hoặc 'popline' (hiện từng dòng ngắn).
export function buildAssCaptions(transcript, {
  videoW = 1080, videoH = 1920,
  fontName = "Roboto Black", fontSize = 90,
  primary = "&H00FFFFFF", highlight = "&H0000E5FF", outline = "&H00000000",
  maxWordsPerCue = 4, marginV = 380, style = "karaoke",
} = {}) {
  const words = transcript.words || [];
  // Karaoke: chữ TRẮNG dễ đọc, khi tới từ nào thì TÔ DẦN sang màu nhấn (\kf mượt, không giật).
  //   PrimaryColour = màu ĐÍCH khi tô (nhấn) · SecondaryColour = màu TRƯỚC khi tô (trắng).
  // Non-karaoke (popline): chữ trắng suốt.
  const isKar = style === "karaoke";
  const priCol = isKar ? highlight : primary;
  const secCol = primary;
  // Roboto Black đã đậm sẵn → Bold=0 (không fake-bold cho khỏi bệt). Viền 5 + bóng 2: nổi & sạch.
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoW}
PlayResY: ${videoH}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Pop,${fontName},${fontSize},${priCol},${secCol},${outline},&H64000000,0,0,0,0,100,100,0,0,1,5,2,2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const toAssTime = (s) => {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const cs = Math.round((s - Math.floor(s)) * 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  };

  // Gom từ thành cụm (cue) tối đa maxWordsPerCue, không vượt quá 1 câu.
  const cues = [];
  let cur = [];
  for (const w of words) {
    const clean = (w.word || "").trim();
    if (!clean) continue;
    cur.push(w);
    const endsSentence = /[.!?…,]$/.test(clean);
    if (cur.length >= maxWordsPerCue || endsSentence) {
      cues.push(cur);
      cur = [];
    }
  }
  if (cur.length) cues.push(cur);

  const esc = (t) => t.replace(/[{}]/g, "").replace(/\\/g, "").trim();
  const lines = [];
  for (const cue of cues) {
    const start = cue[0].start;
    const end = cue[cue.length - 1].end + 0.15;
    if (style === "karaoke") {
      // \kf = TÔ CHẠY MƯỢT trái→phải theo lời (thay \k tô giật nguyên từ) → phụ đề "chạy" mượt.
      let text = "";
      for (const w of cue) {
        const durCs = Math.max(1, Math.round((w.end - w.start) * 100));
        text += `{\\kf${durCs}}${esc(w.word)} `;
      }
      // Xuất hiện DỊU: fade + nảy RẤT nhẹ (103%) rồi ổn định — bỏ kiểu nảy 112% gây "giật".
      const anim = `{\\fad(80,60)\\t(0,90,\\fscx103\\fscy103)\\t(90,170,\\fscx100\\fscy100)}`;
      lines.push(`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Pop,,0,0,0,,${anim}${text.trim()}`);
    } else {
      const text = cue.map((w) => esc(w.word)).join(" ");
      const anim = `{\\fad(80,60)\\t(0,90,\\fscx103\\fscy103)\\t(90,170,\\fscx100\\fscy100)}`;
      lines.push(`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Pop,,0,0,0,,${anim}${text}`);
    }
  }
  return head + lines.join("\n") + "\n";
}

export function saveAss(assText, outPath) {
  fs.writeFileSync(outPath, assText, "utf-8");
  return outPath;
}

// ✂️ TÁCH transcript (theo TỪ) thành các DÒNG NGẮN dễ đọc & sửa (~1 câu / cụm).
// Vì Whisper tiếng Việt hay THIẾU dấu câu → nếu để nguyên "segment" thì ra 1 khối chữ
// dài dằng dặc, rất khó sửa. Hàm này ngắt dòng khi: gặp dấu kết câu (.!?…) · dấu phẩy khi
// dòng đã kha khá · IM LẶNG > maxGap giây giữa 2 từ · hoặc vượt maxChars ký tự.
// DÙNG CHUNG cho cả HIỂN THỊ (transcriptSegments) và ÁP LẠI (applyEditedText) để KHỚP index.
export function splitIntoLines(tr, { maxChars = 42, maxGap = 0.6 } = {}) {
  const words = (tr && tr.words) ? tr.words : [];
  // Không có mốc từng-từ → dùng segments sẵn có (không tách nhỏ được).
  if (!words.length) {
    return (tr && tr.segments)
      ? tr.segments.map((s) => ({ start: s.start, end: s.end, text: s.text, words: s.words || [] }))
      : [];
  }
  const lines = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => (w.word || "").trim()).join(" ").replace(/\s+/g, " ").trim(),
      words: cur.slice(),
    });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    cur.push(w);
    const t = (w.word || "").trim();
    const curLen = cur.reduce((n, x) => n + (x.word || "").length + 1, 0);
    const endsSentence = /[.!?…]$/.test(t);
    const endsClause = /[,;:]$/.test(t) && curLen >= maxChars * 0.6;
    const next = words[i + 1];
    const bigGap = next ? (next.start - w.end) > maxGap && curLen >= 12 : false;
    if (endsSentence || endsClause || bigGap || curLen >= maxChars) flush();
  }
  flush();
  return lines;
}

// Rút danh sách DÒNG {start,end,text} từ transcript — để giao diện SỬA PHỤ ĐỀ (mỗi dòng = 1 câu ngắn).
export function transcriptSegments(tr) {
  if (!tr) return [];
  return splitIntoLines(tr).map((s) => ({ start: s.start, end: s.end, text: s.text }));
}

// ✍️ ÁP PHỤ ĐỀ ĐÃ SỬA TAY vào transcript (dùng chung mọi pipeline).
// editedSegments: mảng chuỗi (mỗi dòng 1 câu), khớp theo THỨ TỰ với transcript.segments.
// Giữ nguyên mốc thời gian từng câu, chia đều thời gian cho các từ mới → phụ đề vẫn khớp nhịp.
// Dòng để trống = ẩn câu đó. Trả về transcript mới ({words, segments}).
export function applyEditedText(tr, editedSegments) {
  if (!tr || !Array.isArray(editedSegments)) return tr;
  // DÙNG CHUNG splitIntoLines với transcriptSegments → dòng thứ i người dùng sửa khớp ĐÚNG
  // dòng thứ i hiển thị (dù Whisper thiếu dấu câu).
  const segs = splitIntoLines(tr);
  const lines = editedSegments.map((s) => String(s || "").trim());
  const newWords = [];
  const newSegs = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const text = (lines[i] != null ? lines[i] : seg.text).trim();
    if (!text) continue; // dòng trống = ẩn câu
    const toks = text.split(/\s+/).filter(Boolean);
    const s0 = seg.start, e0 = seg.end, span = Math.max(0.2, e0 - s0);
    const per = span / toks.length;
    const segWords = toks.map((tk, j) => ({
      start: +(s0 + j * per).toFixed(3),
      end: +(s0 + (j + 1) * per).toFixed(3),
      word: tk,
    }));
    newWords.push(...segWords);
    newSegs.push({ start: s0, end: e0, text, words: segWords });
  }
  return { ...tr, words: newWords, segments: newSegs };
}

// Chia câu hook thành các dòng ngắn cân đối (~maxChars/dòng) để in to lên đầu video.
function wrapHook(text, maxChars = 16) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3); // tối đa 3 dòng
}

// Dựng file ASS cho CÂU HOOK chữ to đặt trên đỉnh video (giật tít, tăng giữ chân 3s đầu).
// Hiện từ giây 0 đến dur, có hiệu ứng nảy vào + nền chữ đậm để nổi.
export function buildHookAss(text, {
  videoW = 1080, videoH = 1920, dur = 4.5,
  fontName = "Roboto Black", fontSize = 104, marginV = 170,
  primary = "&H0000E5FF", // vàng (BBGGRR)
  outline = "&H00101010", back = "&HB0000000",
} = {}) {
  const clean = String(text || "").replace(/[{}\\]/g, "").replace(/["“”]/g, "").trim();
  if (!clean) return null;
  const body = wrapHook(clean.toUpperCase()).join("\\N");
  const toAssTime = (s) => {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const cs = Math.round((s - Math.floor(s)) * 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  };
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoW}
PlayResY: ${videoH}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,${fontName},${fontSize},${primary},${primary},${outline},${back},0,0,0,0,100,100,0,0,3,6,4,8,70,70,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // Fade êm vào/ra, KHÔNG nảy scale (tránh cảm giác "vấp" ở đầu video).
  const anim = `{\\fad(300,300)}`;
  const line = `Dialogue: 0,${toAssTime(0)},${toAssTime(dur)},Hook,,0,0,0,,${anim}${body}`;
  return head + line + "\n";
}

// Dựng ASS cho CHỮ TAY (text overlay do người dùng gõ) — hiện suốt short ở vị trí chọn.
// pos: "top" | "middle" | "bottom". Chữ trắng, viền đậm kiểu sticker, fade êm.
export function buildOverlayAss(text, {
  videoW = 1080, videoH = 1920, dur = 6, pos = "bottom",
  fontName = "Roboto Black", fontSize = 78,
  primary = "&H00FFFFFF", outline = "&H00101010", back = "&H90000000",
} = {}) {
  const clean = String(text || "").replace(/[{}\\]/g, "").replace(/["“”]/g, "").trim();
  if (!clean) return null;
  const align = pos === "top" ? 8 : pos === "middle" ? 5 : 2;
  const marginV = pos === "top" ? 250 : pos === "middle" ? 0 : 120;
  const body = wrapHook(clean, 20).join("\\N");
  const toAssTime = (s) => {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const cs = Math.round((s - Math.floor(s)) * 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  };
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoW}
PlayResY: ${videoH}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Ovl,${fontName},${fontSize},${primary},${primary},${outline},${back},0,0,0,0,100,100,0,0,1,6,3,${align},70,70,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,${toAssTime(0)},${toAssTime(dur)},Ovl,,0,0,0,,{\\fad(200,200)}${body}
`;
  return head;
}

// Dựng ASS cho TỪ KHÓA NHẤN — chữ TO nảy lên GIỮA MÀN khi từ đó được nói ra.
// keywords: mảng hoặc chuỗi "a, b, c". Khi lời thoại chạm đúng từ/cụm → hiện chữ to giữa màn.
// Dùng cho "chữ keyword như cảm xúc/câu chuyện đưa lên giữa màn, phóng to".
export function buildKeywordAss(keywords, transcript, {
  videoW = 1080, videoH = 1920,
  fontName = "Roboto Black", fontSize = 150,
  primary = "&H0000E5FF", outline = "&H00101010", back = "&H90000000",
  minDur = 0.9,
} = {}) {
  const kws = (Array.isArray(keywords) ? keywords : String(keywords || "").split(","))
    .map((s) => String(s).trim()).filter(Boolean);
  if (!kws.length) return null;
  const words = transcript.words || [];
  if (!words.length) return null;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const nWords = words.map((w) => ({ start: w.start, end: w.end, n: norm(w.word) }));

  const events = [];
  for (const kw of kws) {
    const toks = kw.split(/\s+/).map(norm).filter(Boolean);
    if (!toks.length) continue;
    for (let i = 0; i <= nWords.length - toks.length; i++) {
      let ok = true;
      for (let j = 0; j < toks.length; j++) { if (nWords[i + j].n !== toks[j]) { ok = false; break; } }
      if (ok) {
        const start = nWords[i].start;
        const end = Math.max(nWords[i + toks.length - 1].end, start + minDur);
        events.push({ start, end, text: kw.toUpperCase() });
        i += toks.length - 1;
      }
    }
  }
  if (!events.length) return null;

  const toAssTime = (s) => {
    s = Math.max(0, s);
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const cs = Math.round((s - Math.floor(s)) * 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  };
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoW}
PlayResY: ${videoH}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Kw,${fontName},${fontSize},${primary},${primary},${outline},${back},0,0,0,0,100,100,0,0,1,7,4,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const esc = (t) => String(t).replace(/[{}\\]/g, "").replace(/["“”]/g, "").trim();
  const lines = events.map((e) => {
    // nảy to vào giữa màn rồi ổn định, fade êm.
    const anim = `{\\an5\\fad(120,150)\\t(0,140,\\fscx130\\fscy130)\\t(140,260,\\fscx100\\fscy100)}`;
    return `Dialogue: 1,${toAssTime(e.start)},${toAssTime(e.end)},Kw,,0,0,0,,${anim}${esc(e.text)}`;
  });
  return head + lines.join("\n") + "\n";
}

// Dựng ASS cho THUMBNAIL: tiêu đề TO đặt giữa dưới, nền hộp đậm cho dễ đọc.
export function buildThumbAss(title, {
  videoW = 1080, videoH = 1920,
  fontName = "Roboto Black", fontSize = 132,
  primary = "&H0000E5FF", outline = "&H00101010", back = "&HC0000000",
} = {}) {
  const clean = String(title || "").replace(/[{}\\]/g, "").replace(/["“”]/g, "").trim();
  if (!clean) return null;
  const body = wrapHook(clean.toUpperCase(), 12).join("\\N");
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoW}
PlayResY: ${videoH}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Thumb,${fontName},${fontSize},${primary},${primary},${outline},${back},0,0,0,0,100,100,0,0,3,7,5,2,60,60,220,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Thumb,,0,0,0,,${body}
`;
  return head;
}
