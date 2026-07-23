// Bỏ tiếng đệm (à, ừ, ờ, ừm…) + khoảng chết trong 1 đoạn video,
// dựa trên mốc thời gian TỪNG TỪ của whisper. Không cần whisper lại:
// sau khi cắt, ta REMAP mốc thời gian của các từ giữ lại về dòng thời gian mới
// → dựng phụ đề chính xác mà chỉ transcribe đúng 1 lần cho cả video dài.

// Chuẩn hoá 1 từ: bỏ dấu câu/khoảng trắng, giữ dấu tiếng Việt, viết thường.
function norm(w) {
  return String(w || "")
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "")
    .trim();
}

// Tập từ đệm "sạch" (disfluency) — giữ TIGHT để không cắt nhầm lời thật.
// Cố ý KHÔNG gồm: thì, mà, là, cái, đấy, ạ, dạ, vâng (mang nghĩa / lễ phép).
const FILLER = new Set([
  "à", "aà", "ừ", "ừm", "ưm", "um", "uhm", "uh", "ờ", "ờm", "ơ",
  "hm", "hmm", "hử", "ừa", "ậy", "ừm", "ờ", "ừ", "ưm",
]);

// Regex bắt biến thể kéo dài / lặp: "àà", "ừừ", "ờ ờ" (đã bỏ dấu cách), "uhh", "hmmm".
const FILLER_RE = /^(?:a{1,}|à{1,}|ờ{1,}|ơ{1,}|ừ{1,}|ư{1,}m?|u+h+|h+m+|uhm+)$/u;

// 1 từ có phải tiếng đệm không? (kèm giới hạn thời lượng để an toàn)
export function isFiller(word, dur = 0, maxDur = 1.3) {
  const n = norm(word);
  if (!n) return true; // token rỗng (chỉ dấu câu) → bỏ được
  if (dur && dur > maxDur) return false; // từ đệm thật thì rất ngắn
  if (FILLER.has(n)) return true;
  if (n.length <= 4 && FILLER_RE.test(n)) return true;
  return false;
}

// Gộp các khoảng [a,b] chồng lấn/kề nhau lại.
function mergeRanges(rs) {
  const s = rs.filter((r) => r[1] > r[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 0.001) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

// Lấy phần bù (complement) của các khoảng CẮT trong [clipStart, clipEnd].
function complement(cuts, clipStart, clipEnd, minKeep = 0.12) {
  const keep = [];
  let cursor = clipStart;
  for (const [a, b] of cuts) {
    const A = Math.max(clipStart, a);
    const B = Math.min(clipEnd, b);
    if (B <= A) continue;
    if (A - cursor >= minKeep) keep.push([cursor, A]);
    cursor = Math.max(cursor, B);
  }
  if (clipEnd - cursor >= minKeep) keep.push([cursor, clipEnd]);
  return keep;
}

// Lên kế hoạch cắt cho 1 đoạn [clipStart, clipEnd]. QUY ƯỚC (v2 — cắt gọn hơn):
//  1) TIẾNG ĐỆM à/ừ/ờ: LUÔN cắt (không còn ngưỡng tối thiểu bỏ sót tiếng ngắn) và
//     NUỐT LUÔN khoảng lặng ngập ngừng sát 2 bên → không để lại "lỗ hổng" chết.
//  2) KHOẢNG CHẾT giữa 2 từ THẬT: gap > silenceMax thì rút xuống còn ~keepGap nhịp nghỉ.
//  3) DEAD-AIR đầu/cuối đoạn: cắt bớt, vẫn chừa đệm an toàn quanh chữ.
// Vẫn chừa padHead/padTail để KHÔNG cụt phụ âm đầu/đuôi chữ (mốc whisper lệch ±0.1s).
// Trả về { keep: [[a,b]...], cuts: [[a,b]...] } theo mốc thời gian GỐC.
export function planClipCuts(words, clipStart, clipEnd, opts = {}) {
  const {
    silenceMax = 0.55,      // gap giữa 2 từ THẬT dài hơn ngần này (giây) → rút ngắn
    keepGap = 0.20,         // sau khi rút, CHỪA LẠI chừng này giây nhịp nghỉ (tự nhiên)
    padHead = 0.12,         // chừa trước từ kế (không nuốt phụ âm đầu)
    padTail = 0.10,         // chừa sau từ trước (không cụt đuôi chữ)
    fillerPad = 0.05,       // đệm quanh chính tiếng đệm khi cắt
    minSilenceCut = 0.12,   // nhát cắt KHOẢNG CHẾT ngắn hơn ngần này thì bỏ (tránh giật) — KHÔNG áp cho tiếng đệm
    edgeSilence = 0.35,     // dead-air đầu/cuối đoạn dài hơn ngần này thì cắt
    fillerMaxDur = 1.3,     // token dài hơn ngần này (giây) thì không coi là tiếng đệm (an toàn)
  } = opts;

  const ws = (words || [])
    .filter((w) => w.end > clipStart && w.start < clipEnd)
    .map((w) => ({
      start: Math.max(clipStart, w.start),
      end: Math.min(clipEnd, w.end),
      word: w.word,
    }))
    .sort((a, b) => a.start - b.start);

  if (!ws.length) return { keep: [[clipStart, clipEnd]], cuts: [] };

  const isF = ws.map((w) => isFiller(w.word, w.end - w.start, fillerMaxDur));
  const cuts = [];

  // dead-air đầu đoạn
  if (ws[0].start - clipStart > edgeSilence) cuts.push([clipStart, ws[0].start - padHead]);

  for (let i = 0; i < ws.length; i++) {
    if (isF[i]) {
      // TIẾNG ĐỆM: cắt trọn + nuốt khoảng lặng ngập ngừng tới sát chữ THẬT hai bên.
      // Dùng min/max để: có khoảng lặng thì ăn hết; chữ thật kề sát thì vẫn chừa pad, không cụt chữ.
      let prevReal = -1; for (let pj = i - 1; pj >= 0; pj--) if (!isF[pj]) { prevReal = pj; break; }
      let nextReal = -1; for (let nj = i + 1; nj < ws.length; nj++) if (!isF[nj]) { nextReal = nj; break; }
      const left  = prevReal >= 0 ? Math.min(ws[i].start - fillerPad, ws[prevReal].end + padTail) : clipStart;
      const right = nextReal >= 0 ? Math.max(ws[i].end + fillerPad, ws[nextReal].start - padHead) : clipEnd;
      cuts.push([Math.max(clipStart, left), Math.min(clipEnd, right)]);
      continue;
    }
    // KHOẢNG CHẾT giữa 2 từ THẬT: rút xuống còn ~keepGap (chia hai đầu, luôn chừa pad tối thiểu).
    if (i < ws.length - 1 && !isF[i + 1]) {
      const gap = ws[i + 1].start - ws[i].end;
      if (gap > silenceMax) {
        const tailKeep = Math.max(padTail, keepGap * 0.45);
        const headKeep = Math.max(padHead, keepGap * 0.55);
        const cutStart = ws[i].end + tailKeep;
        const cutEnd = ws[i + 1].start - headKeep;
        if (cutEnd - cutStart >= minSilenceCut) cuts.push([cutStart, cutEnd]);
      }
    }
  }

  // dead-air cuối đoạn
  const last = ws[ws.length - 1];
  if (clipEnd - last.end > edgeSilence) cuts.push([last.end + padTail, clipEnd]);

  // Gộp nhát cắt chồng/kề; chỉ bỏ nhát width ~0 (tiếng đệm LUÔN được giữ lại để cắt).
  const merged = mergeRanges(cuts).filter(([a, b]) => b - a >= 0.03);
  const keep = complement(merged, clipStart, clipEnd);
  return { keep: keep.length ? keep : [[clipStart, clipEnd]], cuts: merged };
}

// Ánh xạ 1 mốc thời gian gốc t → mốc trên dòng thời gian MỚI (sau khi cắt).
function makeMapper(keep) {
  return (t) => {
    let acc = 0;
    for (const [a, b] of keep) {
      if (t <= a) return acc;
      if (t <= b) return acc + (t - a);
      acc += b - a;
    }
    return acc;
  };
}

// Dựng transcript MỚI (timeline bắt đầu từ 0) cho đoạn đã cắt,
// bỏ hẳn từ đệm — để buildAssCaptions dựng phụ đề khớp đúng.
// Trả về { words, segments, duration } giống output whisper.
export function remapTranscript(words, keep, clipStart, clipEnd) {
  const map = makeMapper(keep);
  const totalKept = keep.reduce((s, [a, b]) => s + (b - a), 0);
  const outWords = [];
  for (const w of words || []) {
    if (w.end <= clipStart || w.start >= clipEnd) continue;
    if (isFiller(w.word, w.end - w.start)) continue;
    const s0 = Math.max(clipStart, w.start);
    const e0 = Math.min(clipEnd, w.end);
    // bỏ từ nằm trọn trong vùng cắt (không thuộc keep nào)
    const inKeep = keep.some(([a, b]) => e0 > a && s0 < b);
    if (!inKeep) continue;
    const ns = map(s0);
    const ne = Math.max(ns + 0.05, map(e0));
    outWords.push({ start: +ns.toFixed(3), end: +ne.toFixed(3), word: w.word });
  }
  // gom câu thô theo dấu kết câu (đủ cho b-roll; phụ đề dùng words)
  const segments = [];
  let cur = [];
  for (const w of outWords) {
    cur.push(w);
    if (/[.!?…]$/.test((w.word || "").trim())) {
      segments.push(sentence(cur));
      cur = [];
    }
  }
  if (cur.length) segments.push(sentence(cur));
  return { words: outWords, segments, duration: +totalKept.toFixed(3) };
}

function sentence(ws) {
  return {
    start: ws[0].start,
    end: ws[ws.length - 1].end,
    text: ws.map((w) => (w.word || "").trim()).join(" ").replace(/\s+/g, " ").trim(),
    words: ws,
  };
}
