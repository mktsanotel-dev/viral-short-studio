// Quản lý font cho phụ đề/chữ nổi (libass).
// Gói kèm Roboto trong assets/fonts và copy vào WORK/fonts để ffmpeg (cwd=WORK)
// tìm được qua fontsdir=fonts (đường dẫn tương đối → tránh lỗi escape path có dấu tiếng Việt).
import fs from "node:fs";
import path from "node:path";
import { WORK, ASSETS } from "./util.mjs";

// Font mặc định cho MỌI phụ đề/chữ (thay Arial). Có sẵn nhờ assets/fonts/Roboto-*.ttf.
export const CAPTION_FONT = "Roboto";

// Thư mục font TƯƠNG ĐỐI so với cwd (=WORK) khi chạy ffmpeg → dùng trong fontsdir.
export const FONTS_DIR_REL = "fonts";

const SRC = path.join(ASSETS, "fonts");
const DST = path.join(WORK, "fonts");

// Copy font vào WORK/fonts (chạy 1 lần lúc nạp module). An toàn nếu thiếu file.
(function ensureFonts() {
  try {
    fs.mkdirSync(DST, { recursive: true });
    if (!fs.existsSync(SRC)) return;
    for (const f of fs.readdirSync(SRC)) {
      if (!/\.(ttf|otf)$/i.test(f)) continue;
      const s = path.join(SRC, f), d = path.join(DST, f);
      try {
        const ss = fs.statSync(s);
        let need = true;
        try { need = fs.statSync(d).size !== ss.size; } catch { need = true; }
        if (need) fs.copyFileSync(s, d);
      } catch { /* bỏ qua từng file lỗi */ }
    }
  } catch { /* không chặn khởi động nếu copy font lỗi */ }
})();

// Dựng chuỗi filter ass= có kèm fontsdir để libass thấy Roboto.
// basename: tên file .ass (đã nằm trong WORK). extra: chuỗi option thêm (vd "alpha=...").
export function assFilter(basename, extra = "") {
  return `ass=${basename}:fontsdir=${FONTS_DIR_REL}${extra ? ":" + extra : ""}`;
}
