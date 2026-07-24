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

// Danh mục các kiểu phụ đề đang HOT (dùng chung cho giao diện + backend).
export const CAPTION_STYLES = [
  ["karaoke", "Karaoke — tô sáng chạy từng từ"],
  ["hormozi", "Hormozi — từ đang nói vàng/xanh, chữ HOA"],
  ["word", "Từng từ TO nảy giữa màn"],
  ["box", "Highlight bút dạ (ô nền từ đang nói)"],
  ["neon", "Neon phát sáng"],
  ["type", "Đánh máy (chữ hiện dần)"],
  ["bounce", "Nảy 3D (bóng đổ)"],
  ["slide", "Trượt lên từng từ"],
  ["rainbow", "Cầu vồng (mỗi từ 1 màu)"],
  ["popline", "Pop cụm (đơn giản)"],
];

// Sinh file phụ đề ASS viral — hỗ trợ nhiều KIỂU HIỆU ỨNG đang hot (xem CAPTION_STYLES).
export function buildAssCaptions(transcript, {
  videoW = 1080, videoH = 1920,
  fontName = "Roboto Black", fontSize = 90,
  primary = "&H00FFFFFF", highlight = "&H0000E5FF", outline = "&H00000000",
  maxWordsPerCue = 4, marginV = 380, style = "karaoke",
} = {}) {
  const words = (transcript.words || []).filter((w) => (w.word || "").trim());
  const WHITE = "&H00FFFFFF", YELLOW = "&H0000E5FF", GREEN = "&H0000FF00", BLACK = "&H00000000";
  const RAINBOW = ["&H000000FF", "&H0000A5FF", "&H0000FFFF", "&H0000FF00", "&H00FFFF00", "&H00FF0000", "&H00FF00FF"];
  const isKar = style === "karaoke";

  // Style nền: karaoke cần primary=highlight (màu tô) + secondary=trắng cho \kf. Kiểu khác: trắng.
  const stylePrimary = isKar ? highlight : WHITE;
  let bord = 5, shad = 2, outlineCol = outline, sizeMul = 1;
  if (style === "word" || style === "slide") sizeMul = 1.28;   // chữ 1 từ to giữa màn
  if (style === "neon") { bord = 4; shad = 0; outlineCol = "&H00F03DF0"; } // viền tím-hồng phát sáng
  const fs = Math.round(fontSize * sizeMul);

  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoW}
PlayResY: ${videoH}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Pop,${fontName},${fs},${stylePrimary},${WHITE},${outlineCol},&H64000000,0,0,0,0,100,100,0,0,1,${bord},${shad},2,60,60,${marginV},1

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
  const esc = (t) => String(t).replace(/[{}]/g, "").replace(/\\/g, "").trim();
  const cx = Math.round(videoW / 2), cy = Math.round(videoH * 0.5);
  const D = (s, e, txt, extra = "") => {
    const e2 = Math.max(s + 0.08, e);
    return `Dialogue: 0,${toAssTime(s)},${toAssTime(e2)},Pop,,0,0,0,,${extra}${txt}`;
  };

  // Gom từ thành cụm (cue).
  const cues = [];
  { let c = []; for (const w of words) { c.push(w); const ends = /[.!?…,]$/.test((w.word || "").trim()); if (c.length >= maxWordsPerCue || ends) { cues.push(c); c = []; } } if (c.length) cues.push(c); }

  const lines = [];
  for (let ci = 0; ci < cues.length; ci++) {
    const cue = cues[ci];
    // ⛔ CHỐNG CHỒNG PHỤ ĐỀ: cue này KHÔNG được kéo dài đè lên cue kế.
    // end = min(từ cuối +0.2s, đầu cue sau −0.03s). Nói liên tục cũng không còn 2 dòng cùng lúc.
    const nextCueStart = ci + 1 < cues.length ? cues[ci + 1][0].start : Infinity;
    const cs = cue[0].start;
    const ce = Math.max(cs + 0.08, Math.min(cue[cue.length - 1].end + 0.2, nextCueStart - 0.03));
    // Biên phải cho TỪ trong các kiểu per-word (không đè lên từ/cue sau).
    const wordEnd = (w, i) => {
      const nx = i < cue.length - 1 ? cue[i + 1].start : nextCueStart;
      return Math.max(w.start + 0.08, Math.min(w.end + 0.12, nx - 0.02));
    };

    if (style === "karaoke") {
      let text = ""; for (const w of cue) { const d = Math.max(1, Math.round((w.end - w.start) * 100)); text += `{\\kf${d}}${esc(w.word)} `; }
      lines.push(D(cs, ce, text.trim(), `{\\fad(80,60)\\t(0,90,\\fscx103\\fscy103)\\t(90,170,\\fscx100\\fscy100)}`));

    } else if (style === "popline" || style === "pop") {
      const text = cue.map((w) => esc(w.word)).join(" ");
      lines.push(D(cs, ce, text, `{\\fad(80,60)\\t(0,90,\\fscx104\\fscy104)\\t(90,170,\\fscx100\\fscy100)}`));

    } else if (style === "neon") {
      const text = cue.map((w) => esc(w.word)).join(" ");
      lines.push(D(cs, ce, text, `{\\fad(120,120)\\blur5\\bord4}`));

    } else if (style === "rainbow") {
      let text = ""; cue.forEach((w, i) => { text += `{\\1c${RAINBOW[i % RAINBOW.length]}}${esc(w.word)}{\\r} `; });
      lines.push(D(cs, ce, text.trim(), `{\\fad(80,60)}`));

    } else if (style === "type") {
      // đánh máy: chữ hiện dần từng từ (tích luỹ)
      cue.forEach((w, i) => {
        const s = w.start, e = (i < cue.length - 1 ? cue[i + 1].start : ce);
        const shown = cue.slice(0, i + 1).map((x) => esc(x.word)).join(" ");
        lines.push(D(s, e, shown, i === cue.length - 1 ? `{\\fad(0,60)}` : ""));
      });

    } else if (style === "hormozi" || style === "box" || style === "bounce") {
      // Nhấn TỪ ĐANG NÓI: hiện cả cụm, từ hiện tại được làm nổi (nhiều event nối tiếp).
      cue.forEach((w, i) => {
        const s = w.start, e = (i < cue.length - 1 ? cue[i + 1].start : ce);
        const parts = cue.map((x, j) => {
          const t = esc(style === "hormozi" ? String(x.word).toUpperCase() : x.word);
          if (j !== i) return t;
          if (style === "hormozi") { const hi = (i % 2 === 0) ? YELLOW : GREEN; return `{\\1c${hi}\\fscx116\\fscy116}${t}{\\r}`; }
          if (style === "box") return `{\\1c${BLACK}\\3c${YELLOW}\\bord12}${t}{\\r}`;
          return `{\\fscx128\\fscy128\\shad5\\4c${BLACK}}${t}{\\r}`; // bounce
        }).join(" ");
        lines.push(D(s, e, parts, i === 0 ? `{\\fad(60,0)}` : ""));
      });

    } else if (style === "word") {
      // 1 TỪ to giữa màn, nảy vào
      cue.forEach((w, i) => lines.push(D(w.start, wordEnd(w, i), esc(w.word),
        `{\\an5\\pos(${cx},${cy})\\fad(50,50)\\t(0,90,\\fscx126\\fscy126)\\t(90,180,\\fscx100\\fscy100)}`)));

    } else if (style === "slide") {
      // từng từ TRƯỢT từ dưới lên (giữa màn)
      cue.forEach((w, i) => lines.push(D(w.start, wordEnd(w, i), esc(w.word),
        `{\\an5\\move(${cx},${cy + 90},${cx},${cy},0,140)\\fad(80,60)}`)));

    } else {
      // fallback: karaoke
      let text = ""; for (const w of cue) { const d = Math.max(1, Math.round((w.end - w.start) * 100)); text += `{\\kf${d}}${esc(w.word)} `; }
      lines.push(D(cs, ce, text.trim(), `{\\fad(80,60)}`));
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
