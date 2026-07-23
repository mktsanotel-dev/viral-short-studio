// ⚙️ NGUỒN SỰ THẬT DUY NHẤT cho toàn phần mềm — mọi mặc định, nhận diện thương hiệu
// và "gu" biên tập chỉ khai báo Ở ĐÂY. Cả 7 route (server.mjs), các bộ não
// (autoclip/edit/longedit/voiceshort) và giao diện (qua /api/config) đều đọc từ file này.
//
// Vì sao: trước đây mặc định nằm rải rác 2 nơi (value trong index.html + `?? 0.18`
// trong server.mjs) và LỆCH NHAU giữa các tab (tab này film ON, tab kia OFF; model
// tab này medium, tab kia small…). Gom về một chỗ → video ra ĐỒNG NHẤT, không "hên xui".
import { loadSettings } from "./settings.mjs";

// ── 1. NHẬN DIỆN THƯƠNG HIỆU (WHITE-LABEL) ──────────────────────────────────
// Bản bàn giao KHÔNG gắn sẵn thương hiệu. Học viên tự khai trong file .env
// (copy .env.example → .env rồi điền). Bỏ trống thì phần mềm vẫn chạy bình thường,
// chỉ không in tên/logo lên video.
export const BRAND = {
  name: process.env.VSS_BRAND_NAME || "",                   // tên hiển thị (thumbnail); trống = không in tên
  system: process.env.VSS_BRAND_SYSTEM || "Viral Short Studio", // chữ phụ ở header
  tagline: "cắt · biên tập · thumbnail",
  color: process.env.VSS_BRAND_COLOR || "#d3102e",          // màu nhấn (đổi trong .env)
  // Chủ đề/lĩnh vực kênh — giúp AI chấm & chọn đoạn ĐÚNG "chất" của bạn. Khai trong .env.
  niche: process.env.VSS_BRAND_NICHE || "chủ đề của kênh (phát triển bản thân, kinh doanh, kỹ năng…)",
  // Thư mục ảnh chân dung để dựng "bìa thương hiệu". Trống = bỏ qua bìa (fail an toàn).
  thumbPhotoDir: process.env.VSS_THUMB_DIR || "",
  logoFile: "logo.png", // thả logo của bạn vào assets/logo.png → tự chèn watermark
};

// ── OVERLAY THƯƠNG HIỆU TỪ GIAO DIỆN ────────────────────────────────────────
// BRAND là object dùng chung — MỌI file import đều giữ CÙNG tham chiếu. Nên khi
// học viên lưu cấu hình trong giao diện, ta MUTATE thẳng các trường của BRAND
// → thumbnail/caption/AI đổi ngay, KHÔNG cần khởi động lại phần mềm.
export function applyBrandSettings(patch = {}) {
  for (const k of ["name", "system", "color", "niche", "thumbPhotoDir"]) {
    if (patch[k] !== undefined && patch[k] !== null) BRAND[k] = String(patch[k]);
  }
  return BRAND;
}
// Nạp cấu hình đã lưu lúc khởi động (settings.local.json ưu tiên hơn .env).
try { applyBrandSettings(loadSettings().brand || {}); } catch { /* trống → dùng .env/mặc định */ }

// ── 2. MẶC ĐỊNH BIÊN TẬP DÙNG CHUNG ─────────────────────────────────────────
// Đặt tên rõ theo NGỮ CẢNH khung hình để short (9:16) và video dài (16:9) không đá nhau.
export const DEFAULTS = {
  // Nghe/gõ chữ
  model: "medium",           // whisper medium chuẩn hơn — THỐNG NHẤT mọi tab (trước: eval/edit/batch=small)
  lang: "vi",

  // Khung hình
  reframeShort: "blur",      // 9:16 nền mờ cho short
  reframeLong: "fit",        // 16:9 vừa khung cho video dài

  // Màu & hiệu ứng (áp cho MỌI pipeline như nhau)
  // ⚠️ GIỮ NGUYÊN MÀU GỐC: mặc định KHÔNG can thiệp hình ảnh (không grade, không
  // vignette làm tối, không làm mịn) — video ra đúng sáng-màu như nguồn. Người dùng
  // muốn "màu đậm/điện ảnh" thì tự bật qua thanh trượt hoặc preset (viral/cinematic).
  colorLevel: "off",         // TẮT color grade — trước "medium" (gamma<1) làm tối trung tính
  captionStyle: "karaoke",
  smooth: "off",             // TẮT làm mịn — giữ nguyên chi tiết & màu gốc
  voiceClean: "studio",      // 🎚️ STUDIO mặc định: khử ồn + xoá click/pop + đánh bóng giọng (như thu phòng)
  voiceEnhance: "medium",    // 🔊 LÀM RÕ GIỌNG (EQ hiện diện + de-ess + nén nhẹ) — BẬT mặc định
  film: false,               // TẮT vignette+grain — vignette=PI/5 làm tối 4 góc (nguyên nhân "tối màu")
  punch: true,               // punch-zoom theo nhịp
  shake: false,              // camera shake — MẶC ĐỊNH TẮT: nội dung đào tạo (talking-head)
                             // rung nhẹ trông "ẩu"; bật tay khi cần chất năng động.
  flash: true,               // chớp trắng ở điểm cắt
  progress: true,            // thanh tiến trình
  normalize: true,           // chuẩn âm -14 LUFS

  // Âm lượng nhạc nền theo ngữ cảnh (0..1)
  musicVolShort: 0.18,
  musicVolLong: 0.14,
  musicVolVoice: 0.12,

  // Trám bối cảnh (b-roll)
  brollFill: "match",
  brollTransition: "fade",

  // Logo
  logoPos: "br",
  logoScale: 0.16,
  logoOpacity: 0.9,

  // SFX
  sfxVol: 0.6,

  // Cắt tự động (autoclip)
  minScore: 68,
  maxClips: 30,
  burnHook: false,           // đắp chữ tiêu đề đầu video — tuỳ chọn
  makeThumb: true,
  makeContent: true,         // AI viết tiêu đề + caption đăng bài (mọi tính năng làm video)
  scoreClips: true,          // chấm thêm "Điểm kỹ thuật" (6 trục) cho mỗi short
  autoPostLark: false,       // ⚠️ XUẤT BẢN PHẢI CHỦ ĐỘNG — không tự đăng ngầm (trước: mặc định BẬT)
};

// ── 3. PRESET "GU" 1-BẤM ────────────────────────────────────────────────────
// Mỗi preset là một BỘ ĐÈ LÊN DEFAULTS. Dùng để đồng nhất phong cách nhanh.
export const PRESETS = {
  viral: {
    label: "⚡ Viral năng động",
    hint: "Phụ đề karaoke + hook + màu đậm + nhịp dồn — cho content ngắn bắt trend.",
    opts: { colorLevel: "high", captionStyle: "karaoke", punch: true, flash: true, film: true, burnHook: true },
  },
  cinematic: {
    label: "🎬 Kể chuyện điện ảnh",
    hint: "Màu nhẹ tự nhiên, nhạc êm dưới giọng, cắt mượt — cho câu chuyện chạm cảm xúc.",
    opts: { colorLevel: "low", captionStyle: "karaoke", punch: false, flash: false, film: true, shake: false, smooth: "high" },
  },
  clean: {
    label: "🧼 Sạch & trung thực",
    hint: "Ít can thiệp: chỉ cắt gọn + phụ đề, giữ màu gốc — cho nội dung nghiêm túc.",
    opts: { colorLevel: "off", punch: false, flash: false, film: false, shake: false, burnHook: false },
  },
};

// ── 4. TÁC VỤ REMAKE VIDEO ───────────────────────────────────────────────────
// Nguồn sự thật cho danh sách "Mức độ thay đổi", "Phong cách", và cờ Giữ/Thay mặc định.
export const REMAKE = {
  mucDoList: [
    { id: "nhe",  label: "Nhẹ — giữ nội dung, đổi hook/phụ đề/nhạc/nhịp" },
    { id: "vua",  label: "Vừa — viết lại lời thoại, đổi triển khai & một phần cảnh" },
    { id: "manh", label: "Mạnh — giữ thông điệp+dữ kiện, dựng lại gần hết" },
    { id: "tuychinh", label: "Tùy chỉnh — tự chọn giữ/thay" },
  ],
  phongCachList: [
    { id: "goc", label: "Giữ phong cách gốc" },
    { id: "ke-chuyen", label: "Kể chuyện" },
    { id: "chuyen-gia", label: "Chuyên gia chia sẻ" },
    { id: "review", label: "Review" },
    { id: "case-study", label: "Case study" },
    { id: "canh-bao", label: "Cảnh báo sai lầm" },
    { id: "truoc-sau", label: "Trước và sau" },
    { id: "meo", label: "Danh sách mẹo" },
    { id: "ban-hang", label: "Bán hàng trực tiếp" },
    { id: "tiktok-nhanh", label: "TikTok/Reels tốc độ nhanh" },
    { id: "cam-xuc", label: "Video cảm xúc" },
    { id: "tuychinh", label: "Tùy chỉnh bằng văn bản" },
  ],
  // Mặc định BẬT: giữ thông điệp chính · dữ kiện quan trọng · nhận diện thương hiệu (spec #6).
  keepDefault:   { thongDiep: true, duKien: true, giongGoc: false, canhGoc: false, logo: false, thuongHieu: true, thoiLuong: false, cta: false, tyLe: false },
  changeDefault: { hook: true, loiThoai: true, thuTu: true, hinhAnh: false, giong: false, nhac: true, chuyenCanh: false, phuDe: true, cta: false, rutNgan: false, nhanh: false, doc: false },
  defaultMucDo: "vua",
  defaultVoice: "namminh",
};

// Trộn body người dùng gửi lên với DEFAULTS: chỉ lấy các key liệt kê, thiếu thì lấy default.
// Dùng trong server.mjs để KHÔNG lặp lại `body.x ?? DEFAULT` chi chít và không lệch nhau.
export function pick(body = {}, keys = []) {
  const out = {};
  for (const k of keys) out[k] = body[k] != null ? body[k] : DEFAULTS[k];
  return out;
}
