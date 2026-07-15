// ⚙️ CẤU HÌNH DO HỌC VIÊN ĐẶT TRONG GIAO DIỆN (không cần sửa .env, không cần khởi động lại).
// Lưu vào  settings.local.json  ở gốc phần mềm — file RIÊNG của từng người (đã .gitignore).
// Thứ tự ưu tiên khi chạy:  settings.local.json (giao diện)  >  .env  >  mặc định.
import fs from "node:fs";
import path from "node:path";
import { __root } from "./util.mjs";

export const SETTINGS_FILE = path.join(__root, "settings.local.json");

// Đọc toàn bộ cấu hình đã lưu. Hỏng/không có → trả object rỗng (chạy bằng .env/mặc định).
export function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) || {};
  } catch { /* file hỏng → coi như trống */ }
  return {};
}

// Gộp patch vào cấu hình cũ rồi ghi đè. Hai nhánh con "lark" và "brand" được merge nông
// để lưu từng phần (chỉ đổi Lark không mất Thương hiệu và ngược lại).
export function saveSettings(patch = {}) {
  const cur = loadSettings();
  const next = { ...cur, ...patch };
  if (patch.lark) next.lark = { ...(cur.lark || {}), ...patch.lark };
  if (patch.brand) next.brand = { ...(cur.brand || {}), ...patch.brand };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}
