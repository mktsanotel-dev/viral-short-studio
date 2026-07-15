// Đăng short lên Lark Base (bảng content): tạo record → caption vào "Nội dung",
// video (+ thumbnail) vào cột đính kèm "Ảnh/video". Dùng lark-cli đã đăng nhập tại máy.
// GOTCHA: cột "Ảnh/video" có dấu "/" trong tên → phải dùng FIELD ID, không dùng tên.
//         lark-cli --file chỉ nhận đường dẫn TƯƠNG ĐỐI trong cwd → cd vào thư mục file.
import path from "node:path";
import fs from "node:fs";
import { run } from "./util.mjs";
import { loadSettings } from "./settings.mjs";

// lark-cli là CLI Node (shim .cmd chạy `node .../run.js`). Spawn THẲNG node + run.js,
// KHÔNG dùng shell:true → tránh shell làm hỏng arg JSON (dấu ngoặc/kép/khoảng trắng).
// Tìm run.js của @larksuite/cli theo từng hệ điều hành (Windows/Mac/Linux).
// Ép cứng qua VSS_LARK_JS nếu cần. Không tìm thấy → chỉ lỗi khi THỰC SỰ đăng Lark.
function findLarkJs() {
  if (process.env.VSS_LARK_JS) return process.env.VSS_LARK_JS;
  const rel = ["@larksuite", "cli", "scripts", "run.js"];
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const cands = [];
  if (process.platform === "win32") {
    if (process.env.APPDATA) cands.push(path.join(process.env.APPDATA, "npm", "node_modules", ...rel));
  } else {
    cands.push(path.join("/opt", "homebrew", "lib", "node_modules", ...rel)); // Mac Apple Silicon
    cands.push(path.join("/usr", "local", "lib", "node_modules", ...rel));     // Mac Intel / Linux
    if (home) cands.push(path.join(home, ".npm-global", "lib", "node_modules", ...rel));
  }
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch { /* skip */ } }
  return cands[0] || "";
}
const LARK_JS = findLarkJs();

// ⚠️ CẤU HÌNH LARK — đọc TẠI THỜI ĐIỂM GỌI để đổi trong giao diện là ăn ngay
// (không cần khởi động lại). Thứ tự ưu tiên: settings.local.json (giao diện) > .env > mặc định.
// Bản bàn giao để TRỐNG hết → tính năng "đăng Lark" tắt cho tới khi học viên dán link Base.
function larkConf() {
  const s = loadSettings().lark || {};
  const pick = (a, b, d = "") => (a != null && String(a).trim() !== "" ? String(a).trim()
    : (b != null && String(b).trim() !== "" ? String(b).trim() : d));
  return {
    base:      pick(s.baseToken,    process.env.VSS_LARK_BASE),
    table:     pick(s.tableId,      process.env.VSS_LARK_TABLE),
    fContent:  pick(s.contentField, process.env.VSS_LARK_CONTENT_FIELD, "Nội dung"),
    fAttach:   pick(s.attachField,  process.env.VSS_LARK_ATTACH_FIELD),
    fThumb:    pick(s.thumbField,   process.env.VSS_LARK_THUMB_FIELD),
    fLoai:     pick(s.typeField,    process.env.VSS_LARK_TYPE_FIELD, "Loại"),      // select
    fFanpage:  pick(s.fanpageField, process.env.VSS_LARK_FANPAGE_FIELD, "Fanpage"), // link
    loaiVideo: pick(s.typeValue,    process.env.VSS_LARK_TYPE_VALUE, "Video"),
    fanpageRec:pick(s.fanpageRec,   process.env.VSS_LARK_FANPAGE_REC),
  };
}

// Bóc base_token + table_id từ 1 LINK Lark Base học viên dán vào. Ví dụ:
//   https://xxx.larksuite.com/base/BASCNxxxx?table=tblYYYY&view=vewZZZZ
//   https://xxx.feishu.cn/base/BASCNxxxx?table=tblYYYY
// Dán thẳng base_token (không phải URL) cũng nhận.
export function parseBaseUrl(link = "") {
  const s = String(link).trim();
  const out = { baseToken: "", tableId: "" };
  if (!s) return out;
  const mBase = s.match(/\/(?:base|wiki)\/([A-Za-z0-9]+)/);
  if (mBase) out.baseToken = mBase[1];
  const mTable = s.match(/[?&]table=([A-Za-z0-9]+)/);
  if (mTable) out.tableId = mTable[1];
  if (!out.baseToken && /^[A-Za-z0-9]{10,}$/.test(s)) out.baseToken = s; // dán thẳng token
  return out;
}

// Có đủ cấu hình tối thiểu để đăng chưa? (base + table + cột đính kèm video)
export function larkReady() {
  const c = larkConf();
  return !!(c.base && c.table && c.fAttach);
}
export function larkStatus() {
  const c = larkConf();
  return { ready: !!(c.base && c.table && c.fAttach), base: c.base, table: c.table };
}

// lark-cli in 1 dòng tiến trình (vd "Uploading attachment:") trước JSON → bóc JSON.
function parseLarkJson(out) {
  const lines = String(out).split(/\r?\n/);
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].trim().startsWith("{")) {
      try { return JSON.parse(lines.slice(k).join("\n")); } catch { /* thử dòng sau */ }
    }
  }
  const i = out.indexOf("{");
  if (i >= 0) { try { return JSON.parse(out.slice(i)); } catch { /* rơi xuống */ } }
  throw new Error("lark-cli không trả JSON: " + out.slice(0, 200));
}

async function lark(args, { cwd, onLog = () => {} } = {}) {
  const { out } = await run(process.execPath, [LARK_JS, ...args], { cwd });
  const j = parseLarkJson(out);
  if (!j.ok) throw new Error("lark-cli lỗi: " + JSON.stringify(j.error || j).slice(0, 300));
  return j;
}

export async function postToLark({ videoPath, caption = "", thumbPath = null,
  loai = null, fanpageIds = null, onLog = () => {} }) {
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error("không thấy video để đăng lên Lark");
  const C = larkConf();
  if (!C.base || !C.table || !C.fAttach) {
    throw new Error("Chưa cấu hình Lark Base. Mở tab ⚙️ Cấu hình trong phần mềm → dán link Base → Dò bảng → chọn cột đính kèm video → Lưu. (Hoặc điền VSS_LARK_* trong .env.)");
  }
  const loaiVal = loai || C.loaiVideo;
  const fanpage = (fanpageIds || (C.fanpageRec ? [C.fanpageRec] : [])).filter(Boolean);

  // Record: caption + Loại + Fanpage (link → mảng record_id). Chỉ set cột nào ĐÃ khai.
  const fields = { [C.fContent]: caption || "" };
  if (C.fLoai && loaiVal) fields[C.fLoai] = loaiVal;
  if (C.fFanpage && fanpage.length) fields[C.fFanpage] = fanpage;

  onLog(`→ Tạo record Lark (Loại=${loaiVal})...`);
  const created = await lark([
    "base", "+record-upsert", "--base-token", C.base, "--table-id", C.table, "--as", "user",
    "--json", JSON.stringify(fields),
  ], { onLog });
  const rec = created?.data?.record?.record_id_list?.[0];
  if (!rec) throw new Error("không lấy được record_id sau khi tạo");
  onLog("  ✔ record: " + rec);

  // Đính kèm ĐÚNG TRƯỜNG (dùng FIELD ID vì tên cột có thể chứa "/").
  // (--file phải là đường dẫn tương đối trong cwd nên cd vào thư mục file.)
  const uploads = [{ field: C.fAttach, label: "video", file: videoPath }];
  if (C.fThumb && thumbPath && fs.existsSync(thumbPath)) uploads.push({ field: C.fThumb, label: "ảnh bìa", file: thumbPath });
  for (const u of uploads) {
    onLog(`→ Upload ${u.label}...`);
    await lark([
      "base", "+record-upload-attachment", "--base-token", C.base, "--table-id", C.table,
      "--record-id", rec, "--field-id", u.field, "--as", "user", "--file", path.basename(u.file),
    ], { cwd: path.dirname(u.file), onLog });
  }
  onLog("✅ Đã đăng lên Lark Base.");
  return { recordId: rec, base: C.base, table: C.table, files: uploads.length };
}

// 🔎 DÒ BASE: trả danh sách BẢNG (+ CỘT của 1 bảng) để giao diện cho học viên map cột.
// Cần lark-cli đã đăng nhập trên máy + tài khoản có quyền đọc Base đó.
export async function probeBase({ baseToken, tableId = "", onLog = () => {} } = {}) {
  if (!baseToken) throw new Error("thiếu link/base token");
  let tables = [];
  try {
    const tRes = await lark(["base", "+table-list", "--base-token", baseToken, "--as", "user"], { onLog });
    tables = (tRes?.data?.tables || tRes?.data?.items || []).map((t) => ({ id: t.id || t.table_id, name: t.name }));
  } catch (e) {
    throw new Error("Không đọc được Base (kiểm tra link đúng, lark-cli đã đăng nhập, tài khoản có quyền): " + e.message);
  }
  let fields = [];
  if (tableId) {
    try {
      const fRes = await lark(["base", "+field-list", "--base-token", baseToken, "--table-id", tableId, "--as", "user"], { onLog });
      fields = (fRes?.data?.fields || fRes?.data?.items || []).map((f) => ({ id: f.id || f.field_id, name: f.name || f.field_name, type: f.type }));
    } catch (e) { onLog("⚠ chưa đọc được cột của bảng: " + e.message); }
  }
  return { baseToken, tableId, tables, fields };
}
