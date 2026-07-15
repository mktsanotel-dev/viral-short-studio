// Trám bối cảnh tự động: quét thư mục b-roll của người dùng, khớp cảnh theo từ khóa
// trong transcript, quyết định chèn clip/ảnh nào vào mốc nào.
import fs from "node:fs";
import path from "node:path";
import { probe } from "./ffmpeg.mjs";

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi)$/i;
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|bmp)$/i;

// Bỏ dấu tiếng Việt + tách token.
export function normTokens(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

const STOP = new Set(
  ("va la cua co khong nhung mot cac nay do the thi cho nen rat qua se duoc " +
   "minh ban toi anh chi em ta ho ai gi khi tren duoi trong ngoai voi tu den " +
   "cung ma nhu vi boi thi con lai chinh cai nguoi lam ra vao len xuong hay").split(/\s+/)
);

// NHÓM TỪ ĐỒNG NGHĨA/LIÊN QUAN (miền kinh doanh + phát triển con người của HMH).
// Khi lời nói chứa 1 từ trong nhóm → coi như chứa CẢ nhóm → b-roll đặt tên bất kỳ từ nào trong nhóm cũng khớp.
const GROUPS = [
  ["tien", "doanhthu", "doanh", "thu", "loi", "nhuan", "ban", "hang", "tai", "chinh", "luong", "vang", "bac", "bieu", "chart", "money", "gia"],
  ["khach", "mua", "client", "user", "customer", "leads", "data"],
  ["nhansu", "nhan", "vien", "doi", "nhom", "team", "tuyen", "dung"],
  ["quytrinh", "quy", "trinh", "process", "hethong", "he", "thong", "system", "vanhanh", "hanh"],
  ["muctieu", "muc", "tieu", "goal", "kehoach", "hoach", "chien", "luoc", "tamnhin"],
  ["thoigian", "thoi", "gian", "time", "lich", "ngay", "gio", "deadline"],
  ["hoc", "tap", "kienthuc", "kien", "thuc", "daotao", "dao", "tao", "day", "truong", "sach", "book"],
  ["giadinh", "dinh", "family", "vo", "chong", "con", "cha", "me", "bo", "hon", "nhan"],
  ["tamly", "tam", "cam", "xuc", "tinh", "emotion", "hanhphuc", "phuc", "stress", "ap", "luc"],
  ["banthan", "than", "phattrien", "phat", "trien", "self", "thanhcong", "cong", "nolyc", "co", "gang"],
  ["congviec", "viec", "job", "cong", "work", "vanphong", "office"],
  ["marketing", "quang", "cao", "ads", "content", "noidung", "video", "social", "kenh"],
  ["ai", "congnghe", "nghe", "tech", "phanmem", "mem", "may", "robot", "tuonglai"],
];
const TOKEN_GROUP = new Map();
GROUPS.forEach((g, i) => g.forEach((t) => TOKEN_GROUP.set(t, i)));

// Đọc map/synonym RIÊNG của người dùng trong thư mục b-roll (để tối ưu theo nhu cầu).
// _synonyms.json = [["doanh thu","tien","bieu do"], ...]  (mỗi mảng là 1 nhóm coi như đồng nghĩa)
export function loadUserGroups(folder) {
  try {
    const f = path.join(folder, "_synonyms.json");
    if (!fs.existsSync(f)) return [];
    const arr = JSON.parse(fs.readFileSync(f, "utf-8"));
    return (Array.isArray(arr) ? arr : []).map((g) => g.flatMap((s) => normTokens(s)));
  } catch { return []; }
}

// Mở rộng tập token: thêm mọi từ cùng NHÓM (built-in + của người dùng).
function expandTokens(tokenSet, userGroups = []) {
  const out = new Set(tokenSet);
  const groupIdx = new Set();
  for (const t of tokenSet) { if (TOKEN_GROUP.has(t)) groupIdx.add(TOKEN_GROUP.get(t)); }
  for (const i of groupIdx) for (const t of GROUPS[i]) out.add(t);
  for (const g of userGroups) { if (g.some((t) => tokenSet.has(t))) for (const t of g) out.add(t); }
  return out;
}

// Quét thư mục → danh sách b-roll {file, kind, tokens, dur}.
export async function indexFolder(folder) {
  if (!folder || !fs.existsSync(folder)) return [];
  const items = [];
  for (const name of fs.readdirSync(folder)) {
    const full = path.join(folder, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (!st.isFile()) continue;
    const isVid = VIDEO_EXT.test(name);
    const isImg = IMAGE_EXT.test(name);
    if (!isVid && !isImg) continue;
    let dur = Infinity;
    if (isVid) {
      try { dur = (await probe(full)).duration || 3; } catch { dur = 3; }
    }
    items.push({
      file: full,
      kind: isVid ? "video" : "image",
      tokens: new Set(normTokens(name.replace(/\.[^.]+$/, ""))),
      dur,
    });
  }
  return items;
}

// Chia timeline thành các cửa sổ ~targetLen giây từ word-level (dày & đều hơn segment thô).
function buildWindows(transcript, targetLen = 3.0) {
  const words = transcript?.words || [];
  if (words.length) {
    const wins = [];
    let cur = null;
    for (const w of words) {
      if (!cur) cur = { start: w.start, end: w.end, text: w.word };
      else {
        // ngắt cửa sổ nếu có khoảng lặng dài giữa 2 từ
        if (w.start - cur.end > 0.7 && cur.end - cur.start >= 1.2) { wins.push(cur); cur = { start: w.start, end: w.end, text: w.word }; continue; }
        cur.end = w.end; cur.text += " " + w.word;
      }
      if (cur.end - cur.start >= targetLen) { wins.push(cur); cur = null; }
    }
    if (cur && cur.end - cur.start >= 1.0) wins.push(cur);
    return wins;
  }
  // không có word-level → dùng segment thô
  return (transcript?.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text }));
}

// Ghép b-roll cho transcript.
// opts: fillMode 'match' (chỉ cảnh khớp) | 'all' (trám dày, xoay vòng khi không khớp)
export function planBroll(transcript, library, {
  fillMode = "match", maxLen = 3.5, minGap = 0.3, targetLen = 3.0, coverRatio = 0.8, folder = null,
} = {}) {
  if (!library.length) return [];
  const windows = buildWindows(transcript, targetLen);
  if (!windows.length) return [];
  const userGroups = folder ? loadUserGroups(folder) : [];
  const plan = [];
  const useCount = new Map(library.map((b) => [b.file, 0]));
  let lastEnd = -999;
  let rr = 0; // con trỏ xoay vòng cho fill 'all'

  for (const seg of windows) {
    const segLen = seg.end - seg.start;
    if (segLen < 0.6) continue;
    if (seg.start - lastEnd < minGap) continue; // giãn cách để còn thấy người nói

    const segTokens = expandTokens(new Set(normTokens(seg.text || "")), userGroups);
    // chấm điểm khớp (đã mở rộng theo nhóm đồng nghĩa)
    let best = null, bestScore = 0;
    for (const b of library) {
      let score = 0;
      for (const t of b.tokens) if (segTokens.has(t)) score++;
      // ưu tiên clip ít dùng
      score -= useCount.get(b.file) * 0.3;
      if (score > bestScore) { bestScore = score; best = b; }
    }

    let chosen = null;
    if (best && bestScore >= 1) chosen = best;
    else if (fillMode === "all") {
      // xoay vòng, tránh trùng clip vừa dùng
      for (let k = 0; k < library.length; k++) {
        const cand = library[(rr + k) % library.length];
        if (plan.length && plan[plan.length - 1].file === cand.file) continue;
        chosen = cand; rr = (rr + k + 1) % library.length; break;
      }
    }
    if (!chosen) continue;

    // phủ ~coverRatio cửa sổ, chừa đuôi để còn thấy người nói
    let dur = Math.min(segLen * coverRatio, maxLen);
    if (chosen.kind === "video") dur = Math.min(dur, chosen.dur);
    dur = Math.max(dur, 0.8);
    if (dur < 0.6) continue;
    const start = +(seg.start + 0.05).toFixed(3);
    plan.push({ file: chosen.file, kind: chosen.kind, start, dur: +dur.toFixed(3), matched: bestScore >= 1 });
    useCount.set(chosen.file, useCount.get(chosen.file) + 1);
    lastEnd = start + dur;
  }

  // giới hạn số lớp overlay để filtergraph không quá nặng
  return plan.slice(0, 14);
}
