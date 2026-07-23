// 📁 Lưu DỰ ÁN REMAKE ra đĩa (app chưa có persistence — job vốn chỉ nằm trong RAM).
// Mỗi dự án 1 thư mục work/remake/<id>/ gồm: project.json (trạng thái đầy đủ theo spec #18),
// log.txt (log kỹ thuật #17), out/ (video + SRT/kịch bản/storyboard/báo cáo).
// Cờ HỦY để hủy hợp tác giữa các bước (run() chưa kill được ffmpeg giữa chừng).
import fs from "node:fs";
import path from "node:path";
import { WORK, readJSON, writeJSON, slug } from "../util.mjs";

const REMAKE_DIR = path.join(WORK, "remake");
fs.mkdirSync(REMAKE_DIR, { recursive: true });

// ---- Hủy hợp tác (in-memory, đủ vì job chạy cùng tiến trình server) ----
const _cancelled = new Set();
export function requestCancel(id) { _cancelled.add(id); }
export function clearCancel(id) { _cancelled.delete(id); }
export function isCancelled(id) { return _cancelled.has(id); }
export function throwIfCancelled(id) {
  if (_cancelled.has(id)) { _cancelled.delete(id); throw new Error("Đã hủy tác vụ theo yêu cầu."); }
}

// ---- Đường dẫn ----
const dir = (id) => path.join(REMAKE_DIR, id);
const file = (id) => path.join(dir(id), "project.json");
export function outDir(id) { const d = path.join(dir(id), "out"); fs.mkdirSync(d, { recursive: true }); return d; }

export function appendLog(id, line) {
  try { fs.appendFileSync(path.join(dir(id), "log.txt"), `[${new Date().toISOString()}] ${line}\n`); } catch { /* log lỗi không được chặn luồng */ }
}

// ---- CRUD ----
export function createProject({ name, sourceVideo, config = {} }) {
  const id = `rmk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  fs.mkdirSync(dir(id), { recursive: true });
  const now = new Date().toISOString();
  const proj = {
    id,
    name: name || slug(path.basename(String(sourceVideo || "video"))),
    sourceVideo,          // đường dẫn GỐC (không đè khi xuất)
    sourceSdr: null,      // bản đã tone-map SDR (để dựng/xem)
    transcript: null,
    transcriptText: "",
    analysis: null,       // kết quả phân tích (AI + kỹ thuật)
    config,               // cấu hình remake (mức độ, phong cách, giữ/thay...)
    concepts: null,
    chosenConcept: null,
    script: null,
    storyboard: null,
    footageList: [],
    audioFiles: [],
    subtitleFile: null,
    diff: null,
    exports: null,
    status: "created",    // created→analyzed→concepts→script→built|error|cancelled
    outPath: null,
    createdAt: now,
    updatedAt: now,
  };
  return save(proj);
}
export function load(id) { return id ? readJSON(file(id)) : null; }
export function save(proj) { proj.updatedAt = new Date().toISOString(); writeJSON(file(proj.id), proj); return proj; }
export function update(id, patch) {
  const p = load(id);
  if (!p) throw new Error("Không tìm thấy dự án: " + id);
  Object.assign(p, patch);
  return save(p);
}

// Danh sách lịch sử (gọn — chỉ metadata) mới nhất trước.
export function list() {
  try {
    return fs.readdirSync(REMAKE_DIR)
      .map((d) => readJSON(path.join(REMAKE_DIR, d, "project.json")))
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .map((p) => ({
        id: p.id, name: p.name, status: p.status,
        outPath: p.outPath, sourceVideo: p.sourceVideo,
        mucDo: p.config?.mucDo || null,
        createdAt: p.createdAt, updatedAt: p.updatedAt,
      }));
  } catch { return []; }
}
