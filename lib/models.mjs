// Quản lý model KHỬ ỒN RNNoise (dùng cho filter `arnndn` của ffmpeg — khử tiếng ồn nền
// bằng AI, sạch như CapCut/Krisp). Copy assets/rnnoise/*.rnnn → work/models/ rồi tham chiếu
// bằng đường dẫn TƯƠNG ĐỐI (cwd=WORK khi chạy ffmpeg) để tránh lỗi escape path có dấu tiếng Việt.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { WORK, ASSETS } from "./util.mjs";

const FFMPEG = process.env.VSS_FFMPEG || "ffmpeg";
const SRC = path.join(ASSETS, "rnnoise");
const DST = path.join(WORK, "models");
const PREFER = "bd.rnnn"; // beguiling-drafter: khử ồn nền tốt, giữ giọng tự nhiên

// ffmpeg build này có filter arnndn không? (build thiếu thì rơi về afftdn — không vỡ render)
function ffmpegHasArnndn() {
  try {
    const out = execFileSync(FFMPEG, ["-hide_banner", "-filters"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return /\barnndn\b/.test(out);
  } catch { return false; }
}

// DANH SÁCH đường dẫn tương đối tới MỌI model dùng được (vd ["models/bd.rnnn","models/cb.rnnn"]),
// đã sắp PREFER lên đầu. Rỗng nếu không dùng được. Tính 1 lần lúc nạp module.
// Dùng cho voiceCleanFilter() — mức mạnh XẾP TẦNG nhiều model để triệt tiêu ồn tối đa.
export const RNNOISE_MODELS = (function ensureModels() {
  try {
    if (!fs.existsSync(SRC)) return [];
    if (!ffmpegHasArnndn()) return [];
    fs.mkdirSync(DST, { recursive: true });
    const out = [];
    for (const f of fs.readdirSync(SRC).sort()) {
      if (!/\.rnnn$/i.test(f)) continue;
      const s = path.join(SRC, f), d = path.join(DST, f);
      try {
        const ss = fs.statSync(s);
        let need = true;
        try { need = fs.statSync(d).size !== ss.size; } catch { need = true; }
        if (need) fs.copyFileSync(s, d);
        out.push(`models/${f}`);
      } catch { /* bỏ qua file lỗi */ }
    }
    // Đưa model ưu tiên (bd.rnnn) lên đầu để mức nhẹ dùng model tốt nhất.
    out.sort((a, b) => (a.endsWith(PREFER) ? -1 : b.endsWith(PREFER) ? 1 : 0));
    return out;
  } catch { return []; }
})();

// Model ưu tiên (đầu danh sách) hoặc null — giữ tương thích code cũ.
export const RNNOISE_MODEL_REL = RNNOISE_MODELS[0] || null;
