// 🏷️ THƯƠNG HIỆU — logo watermark CHUẨN: LUÔN góc TRÊN-TRÁI, cân xứng, tự cắt sát viền.
// Chuẩn hoá 1 chỗ để mọi mode dùng chung → không phải chỉnh đi chỉnh lại.
import path from "node:path";
import fs from "node:fs";
import { run, WORK, __root, PY, SCRIPTS } from "./util.mjs";

// Logo watermark: thả file vào assets/logo.png (ưu tiên) hoặc assets/logo-mentor.png.
export function findLogo() {
  for (const n of ["logo.png", "logo-mentor.png"]) {
    const p = path.join(__root, "assets", n);
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  return null;
}
const TRIM = path.join(WORK, "cache", "logo-trim.png");

// Tỉ lệ CHUẨN (theo bề ngang khung) — để logo luôn cân xứng ở mọi khung hình.
export const WM = { scale: 0.17, marginFrac: 0.03 };

// Trả về đường dẫn logo ĐÃ CẮT SÁT VIỀN (cache). Không có file → null (bỏ qua watermark).
export async function brandLogo() {
  try {
    const RAW = findLogo();
    if (!RAW) return null;
    const rs = fs.statSync(RAW).mtimeMs;
    const ts = fs.existsSync(TRIM) ? fs.statSync(TRIM).mtimeMs : 0;
    if (ts >= rs) return TRIM;
    fs.mkdirSync(path.dirname(TRIM), { recursive: true });
    await run(PY, [path.join(SCRIPTS, "trim_logo.py"), RAW, TRIM]);
    return fs.existsSync(TRIM) ? TRIM : RAW;
  } catch { const R = findLogo(); return R; }
}

// Chèn watermark góc TRÊN-TRÁI vào filtergraph. Trả về {complex, v, idxNext} đã nối.
// args: mảng args ffmpeg (sẽ push -loop -i logo). v: label video hiện tại. idx: chỉ số input kế.
export function watermarkOverlay({ args, complex, v, idx, logoPath, targetW }, logoScaleFilter) {
  if (!logoPath) return { complex, v, idx };
  const m = Math.round(WM.marginFrac * targetW);
  args.push("-loop", "1", "-i", logoPath);
  const wIdx = idx;
  complex += `;[${wIdx}:v]${logoScaleFilter({ scale: WM.scale, opacity: 0.95, targetW })}[wm];${v}[wm]overlay=${m}:${m}:shortest=1[vw]`;
  return { complex, v: "[vw]", idx: idx + 1 };
}
