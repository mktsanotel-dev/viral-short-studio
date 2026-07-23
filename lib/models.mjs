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

// Đường dẫn tương đối tới model (vd "models/bd.rnnn"), hoặc null nếu không dùng được.
// Tính 1 lần lúc nạp module. voiceCleanFilter() đọc hằng này để chọn arnndn hay afftdn.
export const RNNOISE_MODEL_REL = (function ensureModel() {
  try {
    if (!fs.existsSync(SRC)) return null;
    if (!ffmpegHasArnndn()) return null;
    fs.mkdirSync(DST, { recursive: true });
    let picked = null;
    for (const f of fs.readdirSync(SRC).sort()) {
      if (!/\.rnnn$/i.test(f)) continue;
      const s = path.join(SRC, f), d = path.join(DST, f);
      try {
        const ss = fs.statSync(s);
        let need = true;
        try { need = fs.statSync(d).size !== ss.size; } catch { need = true; }
        if (need) fs.copyFileSync(s, d);
        if (f === PREFER || !picked) picked = f;
      } catch { /* bỏ qua file lỗi */ }
    }
    return picked ? `models/${picked}` : null;
  } catch { return null; }
})();
