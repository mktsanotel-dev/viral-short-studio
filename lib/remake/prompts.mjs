// Các prompt tiếng Việt cho tác vụ Remake. Tách riêng để dễ tinh chỉnh "gu".
// Nguyên tắc chung: giữ thông điệp & DỮ KIỆN cốt lõi, KHÔNG bịa số liệu, câu chữ MỚI.
import { BRAND } from "../presets.mjs";

const MUC_DO_MOTA = {
  nhe:  "NHẸ — giữ phần lớn nội dung & lời thoại, chỉ đổi hook, phụ đề, nhạc và nhịp dựng.",
  vua:  "VỪA — viết lại lời thoại bằng câu chữ mới, đổi thứ tự triển khai, thay một phần cảnh.",
  manh: "MẠNH — chỉ giữ thông điệp và các dữ kiện chính, xây dựng lại gần như toàn bộ (hook mới, cấu trúc mới, cách kể mới).",
};

const RANG_BUOC = `RÀNG BUỘC BẮT BUỘC:
- Giữ nguyên GIÁ TRỊ CỐT LÕI và các DỮ KIỆN quan trọng; không làm sai ý nghĩa gốc.
- KHÔNG tự bịa thêm số liệu / thông tin chưa có trong video gốc.
- KHÔNG sao chép nguyên văn lời thoại gốc; dùng câu chữ MỚI.
- Không chỉ đảo thứ tự cảnh hay thay nhạc — phải có cách thể hiện mới.`;

function brandLine() {
  const b = [];
  if (BRAND.name) b.push(`Thương hiệu: ${BRAND.name}`);
  if (BRAND.niche) b.push(`Lĩnh vực/chất kênh: ${BRAND.niche}`);
  return b.length ? b.join(" · ") + "\n" : "";
}

// ---- 1) PHÂN TÍCH VIDEO GỐC → JSON ----
export function analysisPrompt({ transcriptText, meta, signals = {}, sceneCount = 0, customRequest = "" }) {
  return `Bạn là chuyên gia nội dung video ngắn (TikTok/Reels/Shorts). ${brandLine()}Phân tích video gốc dưới đây.

THÔNG TIN KỸ THUẬT: thời lượng ${Math.round(meta.duration || 0)}s, khung ${meta.width}x${meta.height}${meta.is916 ? " (9:16)" : ""}, ${sceneCount} điểm cắt cảnh, ~${signals.wpm ?? "?"} từ/phút.
${customRequest ? `YÊU CẦU THÊM CỦA NGƯỜI DÙNG: ${customRequest}\n` : ""}
TRANSCRIPT (lời trong video):
"""
${(transcriptText || "(không có lời)").slice(0, 6000)}
"""

Trả về DUY NHẤT một JSON hợp lệ (không markdown, không giải thích) theo schema:
{
  "chuDe": "chủ đề chính (1 câu)",
  "thongDiepCotLoi": "thông điệp cốt lõi phải giữ (1-2 câu)",
  "doiTuong": "đối tượng người xem",
  "hook": "câu/ý hook mở đầu của video gốc",
  "luanDiem": ["các luận điểm/ý chính, mỗi ý 1 chuỗi ngắn"],
  "duKienGiu": ["các DỮ KIỆN/số liệu/tên quan trọng phải giữ đúng"],
  "camXuc": "cảm xúc chủ đạo",
  "cta": "lời kêu gọi hành động (nếu có)",
  "phongCach": "phong cách dựng (vd: kể chuyện, chuyên gia, review...)",
  "phuDeStyle": "kiểu phụ đề nhận thấy",
  "canhQuanTrong": ["mô tả ngắn các cảnh quan trọng nên giữ"],
  "phanCoTheThay": ["các phần có thể thay thế/lược bỏ"]
}
Nếu thiếu thông tin, để chuỗi rỗng hoặc mảng rỗng — KHÔNG bịa.`;
}

// ---- 2) SINH 2–3 CONCEPT REMAKE → JSON ----
export function conceptsPrompt(analysis, config = {}) {
  const mucDo = MUC_DO_MOTA[config.mucDo] || MUC_DO_MOTA.vua;
  const style = config.phongCach && config.phongCach !== "goc" ? `Phong cách MỚI mong muốn: ${config.phongCach}.` : "Có thể đề xuất phong cách phù hợp.";
  const keep = keepChangeText(config);
  return `Bạn là đạo diễn nội dung viral. ${brandLine()}Dưới đây là phân tích video gốc (JSON):
${JSON.stringify(slimAnalysis(analysis))}

Mức độ thay đổi: ${mucDo}
${style}
${keep}
${config.customRequest ? "Yêu cầu thêm: " + config.customRequest : ""}
${RANG_BUOC}

Hãy đề xuất 2–3 PHƯƠNG ÁN REMAKE KHÁC NHAU rõ rệt. Trả về DUY NHẤT một JSON hợp lệ:
{ "concepts": [
  { "hookMoi": "hook 3 giây đầu mới, mạnh",
    "concept": "mô tả concept & cách kể mới (2-3 câu)",
    "cauTruc": ["các bước cấu trúc mới, mỗi bước 1 chuỗi"],
    "mucKhacBiet": "khác biệt so với gốc ở điểm nào",
    "thoiLuongDuKien": "vd 35s" }
] }`;
}

// ---- 3) SINH KỊCH BẢN + STORYBOARD cho 1 concept → JSON ----
export function scriptPrompt(analysis, concept, config = {}) {
  const mucDo = MUC_DO_MOTA[config.mucDo] || MUC_DO_MOTA.vua;
  return `Bạn là biên kịch video ngắn. ${brandLine()}Viết KỊCH BẢN + STORYBOARD chi tiết cho phương án remake sau.

PHÂN TÍCH GỐC (JSON): ${JSON.stringify(slimAnalysis(analysis))}
PHƯƠNG ÁN ĐÃ CHỌN (JSON): ${JSON.stringify(concept)}
Mức độ thay đổi: ${mucDo}
${keepChangeText(config)}
${config.customRequest ? "Yêu cầu thêm: " + config.customRequest : ""}
${RANG_BUOC}

Chia thành các CẢNH ngắn (mỗi cảnh 2-6 giây). Trả về DUY NHẤT một JSON hợp lệ:
{
  "tieuDe": "tiêu đề video mới",
  "hook": "câu hook mở đầu (chữ to đầu video)",
  "scenes": [
    { "stt": 1, "tStart": 0, "tEnd": 3,
      "loiThoai": "lời đọc/thoại cho cảnh này (câu chữ mới)",
      "hinhAnh": "mô tả hình ảnh/cảnh cần cho cảnh này",
      "nguon": "giu | thay",
      "phuDe": "phụ đề hiển thị (thường = lời thoại)",
      "hieuUng": "hiệu ứng gợi ý",
      "chuyenCanh": "cut | fade | ...",
      "nhac": "gợi ý nhạc/nhịp",
      "tocDo": 1,
      "ghiChu": "ghi chú dựng" }
  ],
  "cta": "lời kêu gọi hành động cuối",
  "thoiLuong": "tổng thời lượng dự kiến"
}
Lời thoại phải tự nhiên khi ĐỌC THÀNH TIẾNG. Tổng lời thoại vừa với thời lượng dự kiến.`;
}

// ---- phụ trợ ----
function slimAnalysis(a = {}) {
  return {
    chuDe: a.chuDe, thongDiepCotLoi: a.thongDiepCotLoi, doiTuong: a.doiTuong,
    hook: a.hook, luanDiem: a.luanDiem, duKienGiu: a.duKienGiu,
    camXuc: a.camXuc, cta: a.cta, phongCach: a.phongCach,
    canhQuanTrong: a.canhQuanTrong,
  };
}
function keepChangeText(config = {}) {
  const keep = config.keep || {}, change = config.change || {};
  const kt = Object.entries(KEEP_LABELS).filter(([k]) => keep[k]).map(([, v]) => v);
  const ct = Object.entries(CHANGE_LABELS).filter(([k]) => change[k]).map(([, v]) => v);
  const parts = [];
  if (kt.length) parts.push("GIỮ LẠI: " + kt.join(", ") + ".");
  if (ct.length) parts.push("THAY ĐỔI: " + ct.join(", ") + ".");
  return parts.join("\n");
}
const KEEP_LABELS = {
  thongDiep: "thông điệp chính", duKien: "dữ kiện quan trọng", giongGoc: "giọng đọc gốc",
  canhGoc: "một số cảnh gốc", logo: "logo", thuongHieu: "nhận diện thương hiệu",
  thoiLuong: "thời lượng gần bằng gốc", cta: "lời kêu gọi hành động", tyLe: "tỷ lệ khung hình",
};
const CHANGE_LABELS = {
  hook: "viết lại hook", loiThoai: "viết lại toàn bộ lời thoại", thuTu: "đổi thứ tự nội dung",
  hinhAnh: "thay hình ảnh minh họa", giong: "đổi giọng đọc", nhac: "đổi nhạc nền",
  chuyenCanh: "đổi hiệu ứng chuyển cảnh", phuDe: "đổi kiểu phụ đề", cta: "đổi CTA",
  rutNgan: "rút ngắn video", nhanh: "tăng nhịp độ", doc: "chuyển ngang thành dọc",
};
