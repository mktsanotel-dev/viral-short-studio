// Thumbnail THƯƠNG HIỆU (nền đỏ, chữ trắng kiểu cách) như mẫu:
//  - lấy 1 ảnh từ thư mục ảnh cá nhân → NHUỘM ĐỎ (duotone) làm nền
//  - chip tên thương hiệu + TIÊU ĐỀ video to, trắng, in hoa
//  - render HTML → PNG bằng Chrome headless (render trong %TEMP% ASCII để né lỗi path tiếng Việt)
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { run } from "./util.mjs";

const TW = 1080, TH = 1350;

function findChrome() {
  const cands = [
    process.env.VSS_CHROME,
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch { /* skip */ } }
  return null;
}

const IMG_RE = /\.(jpe?g|png|webp)$/i;

// Liệt kê ảnh trong thư mục (đệ quy 1 cấp cho gọn).
export function listPhotos(dir) {
  const out = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isFile() && IMG_RE.test(name)) out.push(p);
      else if (st.isDirectory()) {
        try { for (const n2 of fs.readdirSync(p)) if (IMG_RE.test(n2)) out.push(path.join(p, n2)); } catch { /* skip */ }
      }
    }
  } catch { /* thư mục lỗi → rỗng */ }
  return out;
}

// Chọn 1 ảnh ổn định theo "seed" (tiêu đề) để mỗi short 1 ảnh khác nhau nhưng lặp lại được.
export function pickPhoto(dir, seed = "") {
  const ps = listPhotos(dir);
  if (!ps.length) return null;
  let h = 0; const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ps[h % ps.length];
}

// Cỡ chữ tiêu đề co theo độ dài để vừa khối name-tag NHỎ (rộng dùng được ~430px).
function titleFontSize(t) {
  const n = (t || "").trim().length;
  if (n <= 10) return 74;
  if (n <= 18) return 60;
  if (n <= 28) return 50;
  if (n <= 40) return 42;
  if (n <= 54) return 36;
  return 32;
}

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Thiết kế theo yêu cầu: khối BẢNG TÊN (name-tag) đỏ đô gradient + VIỀN VÀNG KIM LOẠI ĐÔI,
// đặt ở GÓC DƯỚI-TRÁI đè lên ảnh. Tab nhỏ phía trên = tên thương hiệu; khối lớn =
// TIÊU ĐỀ in hoa, đậm, hẹp (Impact), trắng, đổ bóng.
function buildHtml(photoRel, title, name) {
  const fs0 = titleFontSize(title);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${TW}px;height:${TH}px;overflow:hidden}
.card{position:relative;width:${TW}px;height:${TH}px;background:#111;font-family:'Segoe UI',Arial,sans-serif}
/* Ảnh GỐC — giữ nguyên màu, không nhuộm */
.photo{position:absolute;inset:0;background:url('${photoRel}') center 28% / cover no-repeat}

/* Khối name-tag NHỎ, nằm ở 1/3 DƯỚI, canh GIỮA ngang (không che mặt) */
.tagwrap{position:absolute;left:50%;top:72%;transform:translate(-50%,-50%);width:540px;display:flex;flex-direction:column;align-items:center}
.goldframe{width:100%;border-radius:28px;padding:7px;box-shadow:0 12px 36px rgba(0,0,0,.55);
  background:linear-gradient(135deg,#f8e29a 0%,#c8912f 26%,#fbe9ad 52%,#b6801d 76%,#f8e29a 100%)}
.redpanel{border-radius:22px;background:radial-gradient(120% 120% at 50% 30%, #a81a2d 0%, #741021 58%, #4c0a14 100%);
  box-shadow:inset 0 0 0 2px rgba(251,233,173,.7), inset 0 2px 16px rgba(0,0,0,.4)}
/* Tab tên nhô lên, đè mép trên khối lớn */
.tab{width:auto;max-width:90%;margin-bottom:-15px;z-index:3}
.tab .redpanel{padding:8px 24px}
.tabtxt{color:#fdeecb;font-size:25px;font-weight:600;letter-spacing:.5px;white-space:nowrap;text-align:center}
.tabtxt .dot{color:#f8d98a;margin:0 8px;font-size:19px;vertical-align:middle}
/* Khối lớn chứa tiêu đề */
.big{width:100%;z-index:1}
.big .redpanel{padding:30px 28px 32px;display:flex;align-items:center;justify-content:center;min-height:170px}
.title{color:#fff;font-family:'Arial Black','Segoe UI',Arial,sans-serif;font-weight:900;
  font-size:${fs0}px;line-height:1.05;text-transform:uppercase;text-align:center;letter-spacing:-1px;
  transform:scaleX(.9);transform-origin:center;
  text-shadow:0 4px 14px rgba(0,0,0,.65),0 0 3px rgba(0,0,0,.9)}
</style></head><body>
<div class="card">
  <div class="photo"></div>
  <div class="tagwrap">
    <div class="tab"><div class="goldframe"><div class="redpanel">
      <div class="tabtxt"><span class="dot">&bull;</span>${esc(name)}<span class="dot">&bull;</span></div>
    </div></div></div>
    <div class="big"><div class="goldframe"><div class="redpanel">
      <div class="title">${esc(title)}</div>
    </div></div></div>
  </div>
</div></body></html>`;
}

// Tạo thumbnail thương hiệu. photoPath: ảnh nguồn; title: tiêu đề video; outPng: file ra.
export async function makeBrandThumb(photoPath, title, outPng, { name = "", id = "thumb", onLog = () => {} } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error("Không tìm thấy Chrome/Edge để render thumbnail");
  if (!photoPath || !fs.existsSync(photoPath)) throw new Error("Không thấy ảnh nguồn cho thumbnail");

  // Thư mục tạm ASCII trong %TEMP% (né lỗi Chrome + path tiếng Việt)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vss-thumb-"));
  const ext = (path.extname(photoPath) || ".jpg").toLowerCase();
  const photoLocal = "photo" + (ext === ".jpeg" ? ".jpg" : ext);
  fs.copyFileSync(photoPath, path.join(tmp, photoLocal));
  fs.writeFileSync(path.join(tmp, "card.html"), buildHtml(photoLocal, title, name), "utf-8");
  const outTmp = path.join(tmp, "out.png");

  const args = [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
    "--no-first-run", "--no-default-browser-check",
    "--force-device-scale-factor=1", "--default-background-color=00000000",
    `--user-data-dir=${path.join(tmp, "cud")}`,
    `--window-size=${TW},${TH}`,
    `--screenshot=${outTmp}`,
    "file:///" + path.join(tmp, "card.html").replace(/\\/g, "/"),
  ];
  onLog(`  🖼️ render thumbnail thương hiệu (${path.basename(photoPath)})...`);
  await run(chrome, args, { onLog: () => {} });
  if (!fs.existsSync(outTmp)) throw new Error("Chrome không xuất được ảnh thumbnail");

  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  fs.copyFileSync(outTmp, outPng);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* dọn */ }
  return outPng;
}
