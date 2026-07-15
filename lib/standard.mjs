// 🏅 CHẠY TIÊU CHUẨN — chấm video theo BỘ TIÊU CHUẨN VIDEO HOÀN THIỆN (thang 100 điểm).
//  • Máy ĐO khách quan: Hình ảnh (10) + Âm thanh (10) từ ffprobe/LUFS/nhịp cắt.
//  • AI đọc transcript chấm NỘI DUNG (7 hạng mục = 80đ) + checklist 16 mục + điều cấm kỵ vi phạm + việc cần sửa.
import fs from "node:fs";
import path from "node:path";
import { __root, clamp } from "./util.mjs";
import { evaluate } from "./evaluate.mjs";
import { askClaude } from "./ai.mjs";
import { parseClips } from "./autoclip.mjs";

// Ngưỡng nghiệm thu theo tiêu chuẩn.
function verdictOf(total) {
  if (total >= 95) return "Xuất sắc — được phép xuất bản ngay";
  if (total >= 90) return "Tốt — chỉ cần chỉnh sửa nhỏ";
  if (total >= 80) return "Đạt yêu cầu nhưng cần cải thiện trước khi đăng";
  return "KHÔNG được xuất bản — phải biên tập lại";
}

// Đọc bộ tiêu chuẩn (nếu có file để anh sửa), fallback tóm tắt gọn.
function loadRubric() {
  try {
    const f = path.join(__root, "standards", "tieu-chuan-video.md");
    if (fs.existsSync(f)) return fs.readFileSync(f, "utf-8").slice(0, 6000);
  } catch { /* dùng tóm tắt */ }
  return "";
}

// ---- Máy chấm 2 hạng mục ĐO ĐƯỢC ----
function scoreHinhAnh(meta) {
  let s = 4, notes = [];
  if (meta.height >= 1080) { s += 5; } else if (meta.height >= 720) { s += 2; notes.push("độ phân giải < 1080p"); } else { notes.push("độ phân giải thấp (<720p)"); }
  if (meta.is916 || meta.height === meta.width || (meta.width > meta.height)) s += 1; // tỉ lệ chuẩn
  s = clamp(Math.round(s), 0, 10);
  return { name: "Hình ảnh và bố cục", max: 10, score: s, do_bang: "máy đo",
    nhan_xet: `${meta.width}x${meta.height} · ${meta.is916 ? "9:16" : meta.width > meta.height ? "ngang" : meta.width === meta.height ? "1:1" : "dọc"}${notes.length ? " · " + notes.join(", ") : ""}`,
    sua: meta.height < 1080 ? "Xuất tối thiểu 1080p." : "Kiểm mắt: rõ mặt, mắt nhìn camera, bố cục cân, không rung/mờ." };
}
function scoreAmThanh(meta, signals) {
  const lufs = signals.lufs;
  let s;
  if (!meta.hasAudio) s = 2;
  else if (lufs == null) s = 6;
  else s = clamp(Math.round(10 - Math.abs(lufs - -14) * 0.9), 3, 10);
  return { name: "Âm thanh", max: 10, score: s, do_bang: "máy đo",
    nhan_xet: !meta.hasAudio ? "KHÔNG có tiếng" : `${lufs ?? "?"} LUFS (chuẩn ~ -14)`,
    sua: lufs != null && lufs < -18 ? "Âm quá nhỏ — chuẩn hoá lên ~ -14 LUFS." : lufs != null && lufs > -10 ? "Âm quá to/dễ vỡ — hạ về ~ -14 LUFS." : "Kiểm tai: sạch, rõ, không rè/vang/gió; âm lượng đều." };
}

function buildPrompt(rubric, meta, signals, transcript) {
  const tech = `- Độ phân giải: ${meta.width}x${meta.height} (${meta.is916 ? "9:16" : meta.width > meta.height ? "ngang 16:9" : meta.width === meta.height ? "vuông 1:1" : "dọc"})
- Thời lượng: ${meta.duration.toFixed(0)}s
- Âm lượng: ${signals.lufs ?? "?"} LUFS (chuẩn -14) · dải động ${signals.range ?? "?"} LU
- Nhịp cắt: ${signals.cutsPerMin ?? "?"} chuyển cảnh/phút
- Khoảng lặng: ${((signals.silenceRatio || 0) * 100).toFixed(0)}% thời lượng · ${signals.longGaps ?? 0} khoảng chết ≥1.2s
- Tốc độ nói: ${signals.wpm ?? "?"} từ/phút`;

  return `Bạn là GIÁM ĐỐC SẢN XUẤT khó tính, chấm một video theo BỘ TIÊU CHUẨN VIDEO HOÀN THIỆN dưới đây.
${rubric ? `BỘ TIÊU CHUẨN (rút gọn):\n"""${rubric}"""\n` : ""}
SỐ LIỆU KỸ THUẬT ĐÃ ĐO (dùng để chấm chính xác, đừng đoán khác):
${tech}

TRANSCRIPT (lời nói trong video):
"""
${(transcript || "(không có lời)").slice(0, 4000)}
"""

Hãy chấm 7 HẠNG MỤC sau (2 hạng mục hình ảnh & âm thanh đã có máy chấm, BỎ QUA):
1. "Thông điệp rõ ràng" (tối đa 20) — CHỈ 1 thông điệp trung tâm, không tham nhiều ý.
2. "Hook và khả năng giữ chân" (tối đa 15) — 3s đầu có chống lướt? có Retention Trigger mỗi 5-10s?
3. "Cấu trúc nội dung" (tối đa 15) — đủ mạch Hook→Vấn đề→Nguyên nhân→Giải pháp→Ví dụ→CTA?
4. "Subtitle" (tối đa 10) — dựa vào lời nói: có nên có phụ đề, tốc độ nói hợp lý không (đúng chính tả/nhịp cần mắt người).
5. "B-roll và Motion Graphic" (tối đa 10) — nội dung có cần minh hoạ (số liệu, khái niệm) mà nên có b-roll/đồ hoạ không.
6. "Nhận diện thương hiệu" (tối đa 5) — giọng/chất riêng nhất quán của kênh, có CTA thương hiệu.
7. "Giá trị thực tiễn và ví dụ" (tối đa 5) — có ví dụ thực tế, giá trị áp dụng được.

Đồng thời liệt kê ĐIỀU CẤM KỴ bị vi phạm (lan man, mở đầu dài dòng "xin chào/hôm nay tôi sẽ", số liệu vô căn cứ, thiếu CTA, nhạc lớn hơn giọng...) và 3-5 VIỆC CẦN SỬA ưu tiên.

Trả về DUY NHẤT một JSON hợp lệ (không markdown):
[{"categories":[{"name":"Thông điệp rõ ràng","max":20,"score":<số>,"nhan_xet":"<ngắn>","sua":"<cách sửa>"}, ... đủ 7 mục ...],"cam_ky":["<vi phạm>"...],"sua_uu_tien":["<việc>"...],"checklist":[{"tieu_chi":"Hook thu hút trong 3 giây đầu","dat":true/false},{"tieu_chi":"Chỉ có 1 thông điệp chính","dat":...},{"tieu_chi":"Nêu rõ vấn đề của người xem","dat":...},{"tieu_chi":"Giải thích nguyên nhân","dat":...},{"tieu_chi":"Có giải pháp cụ thể","dat":...},{"tieu_chi":"Có ví dụ minh họa","dat":...},{"tieu_chi":"Có CTA rõ ràng","dat":...},{"tieu_chi":"Subtitle đúng (theo lời)","dat":...},{"tieu_chi":"B-roll đúng nội dung","dat":...},{"tieu_chi":"Đúng bộ nhận diện thương hiệu","dat":...}]}]`;
}

export async function runStandard(file, { onLog = () => {}, model = "small", lang = "vi", preTranscript = null } = {}) {
  onLog("=== CHẠY TIÊU CHUẨN (100 điểm) ===");
  // 1) Đo kỹ thuật + transcript (dùng lại evaluate + cache whisper)
  const ev = await evaluate(file, { onLog, model, lang, preTranscript });
  const { meta, signals } = ev;
  const transcript = ev.transcriptText;

  // 2) Máy chấm 2 hạng mục đo được
  const catImage = scoreHinhAnh(meta);
  const catAudio = scoreAmThanh(meta, signals);

  // 3) AI chấm 7 hạng mục nội dung (cache theo transcript+tech → chạy lại 0 token)
  onLog("→ AI chấm nội dung theo tiêu chuẩn...");
  let ai = { categories: [], cam_ky: [], sua_uu_tien: [], checklist: [] };
  try {
    const ans = await askClaude(buildPrompt(loadRubric(), meta, signals, transcript), { onLog: (l) => onLog("  " + l), cache: true, timeoutMs: 240000 });
    const arr = parseClips(ans);
    if (arr && arr[0]) ai = { ...ai, ...arr[0] };
  } catch (e) { onLog("  ⚠ AI chấm lỗi: " + e.message); }

  // 4) Gộp điểm
  const aiCats = (ai.categories || []).map((c) => ({
    name: c.name, max: Number(c.max) || 0, score: clamp(Math.round(Number(c.score) || 0), 0, Number(c.max) || 0),
    do_bang: "AI", nhan_xet: c.nhan_xet || "", sua: c.sua || "",
  }));
  const categories = [aiCats[0], catImage, catAudio, ...aiCats.slice(1)].filter(Boolean);
  const total = clamp(Math.round(categories.reduce((s, c) => s + (c.score || 0), 0)), 0, 100);

  onLog(`=== TỔNG: ${total}/100 — ${verdictOf(total)} ===`);
  return {
    file, meta, total, verdict: verdictOf(total),
    categories,
    cam_ky: ai.cam_ky || [],
    sua_uu_tien: ai.sua_uu_tien || [],
    checklist: ai.checklist || [],
    signals,
    transcriptText: transcript,
  };
}
