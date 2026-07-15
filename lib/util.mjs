// Tiện ích chung: chạy tiến trình con, đọc/ghi JSON, quản lý đường dẫn.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

export const __root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const WORK = path.join(__root, "work");
export const SCRIPTS = path.join(__root, "scripts");
export const ASSETS = path.join(__root, "assets");

for (const d of [WORK, ASSETS]) fs.mkdirSync(d, { recursive: true });

// Chạy một lệnh, gom stdout/stderr. onLog(line) để stream log ra UI.
// input: chuỗi đẩy vào stdin (dùng cho claude -p, né lỗi quoting prompt dài).
// shell: bật để Windows tìm được .cmd/.ps1 (vd claude.cmd).
export function run(cmd, args, { onLog, cwd, input, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true, shell });
    let out = "";
    let err = "";
    if (input != null) { try { p.stdin.write(input); p.stdin.end(); } catch { /* ignore */ } }
    p.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      if (onLog) s.split(/\r?\n/).forEach((l) => l.trim() && onLog(l));
    });
    p.stderr.on("data", (d) => {
      const s = d.toString();
      err += s;
      if (onLog) s.split(/\r?\n/).forEach((l) => l.trim() && onLog(l));
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ out, err, code });
      else reject(new Error(`${cmd} thoát mã ${code}\n${err.slice(-2000)}`));
    });
  });
}

export function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

export function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf-8");
}

export function slug(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60) || "video";
}

export function fmtTime(s) {
  s = Math.max(0, s || 0);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Đường dẫn python: ưu tiên biến môi trường VSS_PYTHON (Mac dùng .venv).
// Mặc định: Windows = "python", Mac/Linux = "python3".
export const PY = process.env.VSS_PYTHON || (process.platform === "win32" ? "python" : "python3");
