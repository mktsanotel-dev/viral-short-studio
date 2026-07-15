// Nạp file .env (nếu có) vào process.env — ZERO-DEPENDENCY.
// Phải được import ĐẦU TIÊN trong server.mjs (trước presets.mjs) để mọi cấu hình
// thương hiệu / Lark của học viên có hiệu lực. Biến đã có sẵn (do launcher export)
// được GIỮ NGUYÊN — .env chỉ điền vào chỗ còn trống.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envFile = path.join(root, ".env");
try {
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf-8").split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith("#")) continue;
      const eq = s.indexOf("=");
      if (eq < 0) continue;
      const k = s.slice(0, eq).trim();
      let v = s.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  }
} catch { /* .env lỗi → bỏ qua, chạy với mặc định */ }
