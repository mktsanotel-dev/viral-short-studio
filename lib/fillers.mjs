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
export function isFiller(word, dur = 0) {
  const n = norm(word);
  if (!n) return true; // token rỗng (chỉ dấu câu) → bỏ được
  if (dur && dur > 1.3) return false; // từ đệm thật thì rất ngắn
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

// Lên kế hoạch cắt cho 1 đoạn [clipStart, clipEnd]:
//  - bỏ từ đệm (à/ừ/ờ…)
//  - bỏ khoảng chết > silenceMax giữa 2 từ
//  - bỏ dead-air đầu/cuối đoạn
// Trả về { keep: [[a,b]...], cuts: [[a,b]...] } theo mốc thời gian GỐC.
export function planClipCuts(words, clipStart, clipEnd, opts = {}) {
  const {
    // padHead/padTail RỘNG hơn → chừa đệm quanh chỗ cắt, KHÔNG nuốt phụ âm đầu/đuôi chữ
    // (mốc whisper hay lệch ±0.1s). minCut → BỎ các nhát cắt quá ngắn để không "giật" vụn.
    silenceMax = 0.7, padHead = 0.16, padTail = 0.14, fillerPad = 0.04, minCut = 0.16,
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

  const cuts = [];
  // dead-air đầu đoạn
  if (ws[0].start - clipStart > 0.4) cuts.push([clipStart, ws[0].start - padHead]);

  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if (isFiller(w.word, w.end - w.start)) {
      cuts.push([w.start - fillerPad, w.end + fillerPad]);
    }
    if (i < ws.length - 1) {
      const gap = ws[i + 1].start - w.end;
      if (gap > silenceMax) cuts.push([w.end + padTail, ws[i + 1].start - padHead]);
    }
  }
  // dead-air cuối đoạn
  const last = ws[ws.length - 1];
  if (clipEnd - last.end > 0.4) cuts.push([last.end + padTail, clipEnd]);

  // Gộp các nhát cắt chồng/kề, rồi BỎ nhát nào ngắn hơn minCut → tránh jump-cut vụn
  // gây "giật". (Đổi lại: vài từ đệm siêu ngắn có thể còn — chấp nhận để nhịp mượt hơn.)
  const merged = mergeRanges(cuts).filter(([a, b]) => b - a >= minCut);
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
