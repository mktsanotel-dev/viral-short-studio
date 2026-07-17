// Viral Short Studio — frontend logic.
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ---- Tabs ----
function activateTab(name) {
  $$(".tab").forEach((x) => x.classList.remove("active"));
  $$(".panel").forEach((x) => x.classList.remove("active"));
  const btn = document.querySelector(`.tab[data-tab="${name}"]`);
  if (btn) btn.classList.add("active");
  const panel = $("#tab-" + name);
  if (panel) panel.classList.add("active");
}
$$(".tab").forEach((t) => t.addEventListener("click", () => activateTab(t.dataset.tab)));

// ---- Bắt đầu nhanh (wizard) ----
$$(".wiz-b").forEach((b) => b.addEventListener("click", () => {
  activateTab(b.dataset.go);
  const w = $("#wizard"); if (w) w.classList.add("wiz-collapsed");
}));
if ($("#wiz-hide")) $("#wiz-hide").addEventListener("click", () => $("#wizard").classList.add("wiz-collapsed"));

// ---- Cấu hình (NGUỒN SỰ THẬT: /api/config) → điền mặc định + tên thương hiệu ----
let VSS_CFG = { brand: {}, defaults: {} };
fetch("/api/config").then((r) => r.json()).then((cfg) => {
  VSS_CFG = cfg || VSS_CFG;
  const b = cfg.brand || {}, d = cfg.defaults || {};
  // Header
  if (b.system && $("#brand-sub")) $("#brand-sub").textContent = `${b.system} — ${b.tagline || "cắt · biên tập · thumbnail · đăng Lark"}`;
  // Điền thư mục ảnh + tên hiển thị (không còn hardcode Y:\ trong HTML)
  const setVal = (id, v) => { const e = $("#" + id); if (e && !e.value && v != null) e.value = v; };
  setVal("ac-thumbdir", b.thumbPhotoDir); setVal("l-thumbdir", b.thumbPhotoDir);
  setVal("ac-thumbname", b.name); setVal("l-thumbname", b.name);
}).catch(() => { /* giữ mặc định HTML */ });

// ---- Env ----
fetch("/api/health").then((r) => r.json()).then((h) => {
  const el = $("#env");
  el.textContent = h.gpu ? "⚡ GPU NVENC bật · sẵn sàng" : "CPU · sẵn sàng";
  if (h.gpu) el.classList.add("gpu");
  // Cảnh báo thư mục ảnh thumbnail không truy cập được (ổ mạng chưa gắn).
  if (h.thumbDirExists === false) $$(".thumbdir-warn").forEach((w) => w.style.display = "block");
}).catch(() => { $("#env").textContent = "server chưa sẵn sàng"; });

// ---- Log ----
const logbox = $("#logbox"), logEl = $("#log");
$("#logtoggle").addEventListener("click", () => {
  logEl.hidden = !logEl.hidden;
  $("#logtoggle").textContent = logEl.hidden ? "Hiện log" : "Ẩn log";
});
function showLog(status) { logbox.hidden = false; $("#logstatus").textContent = status; }
function setLog(lines) { logEl.textContent = (lines || []).join("\n"); logEl.scrollTop = logEl.scrollHeight; }

// ---- Upload helper ----
// subdir (tuỳ chọn): gom nhiều file vào cùng 1 thư mục con trên server (cho "tải cả thư mục").
async function uploadFile(file, onProgress, subdir) {
  onProgress && onProgress("Đang tải file lên server…");
  const headers = { "X-Filename": encodeURIComponent(file.name) };
  if (subdir) headers["X-Subdir"] = encodeURIComponent(subdir);
  const r = await fetch("/api/upload", { method: "POST", headers, body: file });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "upload lỗi");
  return subdir ? { path: j.path, dir: j.dir } : j.path;
}

// ================= 📁🗂️ THANH TẢI LÊN (file lẻ + cả thư mục) — DÙNG CHO MỌI TAB =================
// Chèn 1 thanh có 2 nút: "Chọn file từ máy" và "Chọn cả thư mục".
// onPaths(serverPaths[], {names, dir}) được gọi sau khi tải xong.
const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|flv|wmv|mpg|mpeg|ts)$/i;
function makeUploadBar(onPaths, { multi = false, accept = "video/*", groupDir = false, label = "video" } = {}) {
  const bar = document.createElement("div");
  bar.className = "upbar";
  bar.innerHTML = `
    <label class="upbtn">📁 Chọn ${multi ? "file (nhiều)" : "file"} từ máy
      <input type="file" accept="${accept}" ${multi ? "multiple" : ""} hidden class="upbar-file">
    </label>
    <label class="upbtn">🗂️ Chọn cả thư mục
      <input type="file" webkitdirectory directory multiple hidden class="upbar-dir">
    </label>
    <span class="upbar-status muted"></span>`;
  const fileInput = bar.querySelector(".upbar-file");
  const dirInput = bar.querySelector(".upbar-dir");
  const status = bar.querySelector(".upbar-status");

  async function handle(fileList, isFolder) {
    let files = Array.from(fileList || []);
    // Lọc chỉ file video (thư mục có thể lẫn file khác).
    const vids = files.filter((f) => VIDEO_EXT.test(f.name) || (accept === "video/*" && f.type.startsWith("video")));
    files = (accept === "video/*") ? (vids.length ? vids : files) : files;
    if (!files.length) return;
    // Tên thư mục con trên server (khi tải cả thư mục, hoặc groupDir cho tab Hàng loạt).
    let subdir = null;
    if (isFolder) {
      const rp = files[0].webkitRelativePath || "";
      subdir = (rp.split("/")[0] || ("thu-muc-" + Date.now()));
    } else if (groupDir) {
      subdir = "tai-len-" + Date.now();
    }
    const outPaths = []; let dir = null; let done = 0;
    for (const f of files) {
      status.textContent = `⏳ Đang tải ${++done}/${files.length}: ${f.name}`;
      try {
        const r = await uploadFile(f, null, subdir || undefined);
        if (subdir) { outPaths.push(r.path); dir = r.dir; }
        else outPaths.push(r);
      } catch (e) { status.textContent = "❌ " + e.message; return; }
    }
    status.textContent = `✔ Đã tải ${outPaths.length} ${label}` + (isFolder ? ` (thư mục: ${subdir})` : "");
    onPaths(outPaths, { names: files.map((f) => f.name), dir, isFolder });
  }
  fileInput.addEventListener("change", (e) => handle(e.target.files, false));
  dirInput.addEventListener("change", (e) => handle(e.target.files, true));
  return bar;
}

// Chèn thanh tải lên vào 1 dropzone/khu vực theo id.
function injectUploader(hostId, onPaths, opts) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.appendChild(makeUploadBar(onPaths, opts));
}

// ---- Drag & drop wiring ----
function wireDrop(zoneId, fileInputId, pathInputId, onFile) {
  const dz = $("#" + zoneId);
  if (fileInputId) $("#" + fileInputId).addEventListener("change", (e) => {
    if (e.target.files[0]) onFile(e.target.files[0]);
  });
  ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.remove("drag");
  }));
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}

// ---- Poll job ----
async function pollJob(jobId, onDone) {
  showLog("Đang xử lý…");
  const timer = setInterval(async () => {
    try {
      const j = await (await fetch("/api/job/" + jobId)).json();
      setLog(j.log);
      $("#logstatus").textContent =
        j.status === "running" ? "⏳ Đang xử lý…" :
        j.status === "done" ? "✅ Hoàn tất" : "❌ Lỗi";
      if (j.status !== "running") {
        clearInterval(timer);
        onDone(j);
      }
    } catch (e) { /* giữ vòng lặp */ }
  }, 1200);
}

// ================= 🧠 CẮT TỰ ĐỘNG =================
let acPath = null;
wireDrop("dz-ac", "file-ac", "path-ac", async (f) => {
  showLog("Tải lên…");
  try { acPath = await uploadFile(f); $("#path-ac").value = acPath; setLog(["✔ Đã tải: " + f.name]); }
  catch (e) { alert(e.message); }
});
$("#ac-score").addEventListener("input", (e) => { $("#ac-scoreval").textContent = e.target.value; });
$("#ac-mv").addEventListener("input", (e) => { $("#ac-mvval").textContent = e.target.value; });

// 👁️ XEM LẠI THIẾT LẬP trước khi cắt — liệt kê mọi đầu vào đang đặt.
function buildAcReview() {
  const val = (id) => { const e = $("#" + id); return e ? (e.value || "").trim() : ""; };
  const chk = (id) => { const e = $("#" + id); return e ? e.checked : false; };
  const sel = (id) => { const e = $("#" + id); return e && e.selectedOptions[0] ? e.selectedOptions[0].text : ""; };
  const esc2 = (s) => String(s).replace(/</g, "&lt;");
  const rows = [];
  const add = (k, v) => rows.push(`<tr><td>${k}</td><td>${v ? `<b>${esc2(v)}</b>` : `<span class="miss">— chưa đặt —</span>`}</td></tr>`);
  const video = val("path-ac") || acPath || val("url-ac");
  add("📹 Video nguồn", video);
  add("🎵 Nhạc nền (tự lặp)", val("ac-music") ? `${val("ac-music")} · ${val("ac-mv")}%` : "");
  add("🎬 Thư mục b-roll", val("ac-broll"));
  add("🎯 Video CTA", val("ac-cta"));
  add("🏷️ Logo (dán khi tải)", val("ac-logo"));
  add("🖼️ Thumbnail", chk("ac-thumbbrand") ? `Mẫu thương hiệu · ${val("ac-thumbdir")} · tên "${val("ac-thumbname")}"` : "Kiểu khung video");
  add("📤 Tự đăng Lark", chk("ac-autolark") ? "BẬT · Loại=Video" : "Tắt (đăng tay)");
  add("🧠 AI chọn đoạn", `${sel("ac-model")} · điểm tối thiểu ${val("ac-score")} · tối đa ${val("ac-max")} short`);
  add("🎞️ Khung / chuyển cảnh", `${sel("ac-reframe")} · ${sel("ac-trans")}`);
  add("✨ Mịn / giọng / vignette", `mịn ${sel("ac-smooth")} · giọng ${sel("ac-voice")} · vignette ${chk("ac-film") ? "bật" : "tắt"} · progress ${chk("ac-prog") ? "bật" : "tắt"} · hook ${chk("ac-hook") ? "bật" : "tắt"}`);
  const warn = !video ? `<div class="hero-note" style="margin-top:8px">⚠ Chưa có <b>video nguồn</b> ở ô ① — hãy thêm trước khi cắt.</div>` : "";
  $("#ac-review").innerHTML = `<div class="review"><h4>👁️ Xem lại thiết lập trước khi cắt</h4><table>${rows.join("")}</table>${warn}<div class="muted" style="font-size:11.5px;margin-top:8px">Kiểm tra xong, bấm <b>🚀 AI cắt video thành loạt short</b>.</div></div>`;
  $("#ac-review").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
$("#btn-ac-review").addEventListener("click", buildAcReview);
// Link logo / CTA đầu vào → upload → điền path
$("#file-aclogo").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  showLog("Tải logo…");
  try { $("#ac-logo").value = await uploadFile(f); setLog(["✔ Logo: " + f.name]); } catch (err) { alert(err.message); }
});
$("#file-accta").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  showLog("Tải CTA…");
  try { $("#ac-cta").value = await uploadFile(f); setLog(["✔ CTA: " + f.name]); } catch (err) { alert(err.message); }
});
$("#btn-ac").addEventListener("click", async () => {
  const file = $("#path-ac").value.trim() || acPath;
  const url = $("#url-ac").value.trim();
  if (!file && !url) return alert("Kéo-thả video, dán đường dẫn, hoặc dán link ở ô ①.");
  // Xuất bản phải chủ động: nếu bật tự đăng Lark → HỎI XÁC NHẬN trước khi chạy.
  if ($("#ac-autolark").checked &&
      !confirm("Sau khi cắt xong, TỰ ĐỘNG đăng TẤT CẢ short lên Lark Base (cần cấu hình Lark trong .env)?\n\nBấm Huỷ để chỉ cắt, đăng tay từng cái sau.")) {
    $("#ac-autolark").checked = false;
  }
  saveProject("vss-ac", AC_FIELDS);
  $("#btn-ac").disabled = true; $("#ac-out").innerHTML = "";
  // Ghi nhớ logo/CTA/chuyển cảnh đầu vào để dùng ở phần biên tập trực tiếp
  finState.logoPath = $("#ac-logo").value.trim() || null;
  finState.logoUrl = finState.logoPath ? "/api/file?path=" + encodeURIComponent(finState.logoPath) : null;
  finState.cta = $("#ac-cta").value.trim() || null;
  finState.transition = $("#ac-trans").value;
  finState.color = { brightness: 0, contrast: 0, saturation: 0 };
  const body = {
    path: file || null, url: url || null,
    model: $("#ac-model").value,
    minScore: parseInt($("#ac-score").value, 10),
    maxClips: parseInt($("#ac-max").value, 10) || 30,
    burnHook: $("#ac-hook").checked,
    reframe: $("#ac-reframe").value,
    colorLevel: "off",           // màu chỉnh TRỰC TIẾP ở phần kết quả (không nướng cứng khi render)
    punch: false, shake: false, flash: false, sfx: false, aiBroll: false,
    film: $("#ac-film").checked,
    progress: $("#ac-prog").checked,
    brollFolder: $("#ac-broll").value.trim() || null,
    brollFill: $("#ac-brollfill").value,
    smooth: $("#ac-smooth").value,
    voiceClean: $("#ac-voice").value,
    makeThumb: $("#ac-thumb").checked,
    scoreClips: $("#ac-scoreclip") ? $("#ac-scoreclip").checked : true,
    // ⑤ Nhạc nền upfront (bám + tự lặp) · ⑥ Thumbnail thương hiệu
    musicPath: $("#ac-music").value.trim() || null,
    musicVol: (parseInt($("#ac-mv").value, 10) || 18) / 100,
    thumbStyle: $("#ac-thumbbrand").checked ? "brand" : "frame",
    thumbPhotoDir: $("#ac-thumbdir").value.trim() || null,
    thumbName: $("#ac-thumbname").value.trim() || (VSS_CFG.brand.name || ""),
    autoPostLark: $("#ac-autolark").checked,
    ctaPath: $("#ac-cta").value.trim() || null,   // CTA cuối video (③) — nướng vào mỗi short (mọi video có CTA)
  };
  const r = await fetch("/api/autoclip", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());
  if (r.error) { $("#btn-ac").disabled = false; return alert(r.error); }
  pollJob(r.jobId, (j) => {
    $("#btn-ac").disabled = false;
    if (j.status === "error") return alert(j.error);
    renderClips($("#ac-out"), j.result);
  });
});

// Trạng thái biên tập trực tiếp (áp cho mọi short trong lần cắt này)
const finState = { logoPath: null, logoUrl: null, scale: 0.16, opacity: 0.9, musicPath: null, musicVol: 0.3, cta: null, transition: "fade", color: { brightness: 0, contrast: 0, saturation: 0 } };
let _acClips = [];
// Dữ liệu nguồn cho lớp ✏️ TINH CHỈNH (dựng lại 1 short mà không chạy lại AI)
let _acSource = null, _acTranscriptFile = null, _acEditOpts = {}, _acSourceDuration = 0;

// TẢI VỀ không chuyển trang: tạo <a download> bấm ngầm, trỏ endpoint có dl=1 (ép attachment).
// Nhờ vậy tải nhiều video liên tiếp mà app KHÔNG bị mất/điều hướng.
function downloadFile(filePath, saveName) {
  const a = document.createElement("a");
  a.href = "/api/file?dl=1&path=" + encodeURIComponent(filePath);
  if (saveName) a.download = saveName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1500);
}

const mmss = (s) => (s == null ? "?" : Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"));

// ================= 📦 XUẤT BẢN DÙNG CHUNG (đồng nhất mọi tính năng làm video) =================
// Đọc 3 checkbox Thumbnail/Content/Đăng Lark theo tiền tố tab + thư mục ảnh/tên từ config.
function publishBody(prefix) {
  const chk = (id) => { const e = $("#" + id); return e ? e.checked : undefined; };
  const b = {};
  const t = chk(prefix + "-mkthumb"); if (t != null) b.makeThumb = t;
  const c = chk(prefix + "-mkcontent"); if (c != null) b.makeContent = c;
  const l = chk(prefix + "-mklark"); if (l != null) b.postLark = l;
  const dir = $("#" + prefix + "-thumbdir");
  b.thumbPhotoDir = (dir && dir.value.trim()) || (VSS_CFG.brand && VSS_CFG.brand.thumbPhotoDir) || null;
  const nm = $("#" + prefix + "-thumbname");
  b.thumbName = (nm && nm.value.trim()) || (VSS_CFG.brand && VSS_CFG.brand.name) || "";
  return b;
}
// Nếu bật đăng Lark → hỏi xác nhận (xuất bản là hành động chủ động). Trả về true nếu được phép chạy.
function confirmLark(prefix) {
  const l = $("#" + prefix + "-mklark");
  if (l && l.checked && !confirm("Sau khi dựng xong, ĐĂNG video này lên Lark Base (cần cấu hình ở tab ⚙️ Cấu hình)?\n\nBấm Huỷ để chỉ dựng, đăng tay sau.")) {
    l.checked = false;
  }
  return true;
}
// Khối hiển thị caption + thumbnail + nút Đăng Lark cho MỘT video đầu ra.
function publishHtml(item) {
  if (!item || !item.outPath) return "";
  const cap = (item.caption || "").replace(/</g, "&lt;");
  const thumbUrl = item.thumbPath ? "/api/file?path=" + encodeURIComponent(item.thumbPath) : null;
  const larkState = item.larkPosted ? "✅ Đã đăng Lark" : (item.larkError ? "⚠ " + esc(item.larkError) : "");
  return `<div class="pub-box">
    ${item.title ? `<div class="pub-title">📌 <b>${esc(item.title)}</b></div>` : ""}
    ${cap ? `<details class="clip-cap" open><summary>✍️ Caption đăng bài (AI)</summary><pre>${cap}</pre></details>` : ""}
    ${thumbUrl ? `<details class="clip-cap"><summary>🖼️ Thumbnail thương hiệu</summary><img src="${thumbUrl}" style="width:100%;max-width:300px;border-radius:8px;margin-top:6px"><br><a class="dl" href="/api/file?dl=1&path=${encodeURIComponent(item.thumbPath)}" download>⬇ Tải bìa</a></details>` : ""}
    <div style="margin-top:6px">
      <button class="dl pub-larkbtn" data-video="${encodeURIComponent(item.outPath)}" data-thumb="${item.thumbPath ? encodeURIComponent(item.thumbPath) : ""}" data-caption="${encodeURIComponent(item.caption || item.title || "")}">📤 Đăng Lark</button>
      <span class="pub-lark-status muted" style="font-size:11.5px;margin-left:6px">${larkState}</span>
    </div>
  </div>`;
}
// Bấm "Đăng Lark" (delegated — dùng cho MỌI tab). Đăng thủ công 1 video bất kỳ.
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".pub-larkbtn");
  if (!btn) return;
  const status = btn.parentElement.querySelector(".pub-lark-status");
  btn.disabled = true; if (status) status.textContent = "⏳ đang đăng...";
  try {
    const r = await fetch("/api/lark-post", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoPath: decodeURIComponent(btn.dataset.video),
        thumbPath: btn.dataset.thumb ? decodeURIComponent(btn.dataset.thumb) : null,
        caption: decodeURIComponent(btn.dataset.caption || ""),
      }),
    }).then((x) => x.json());
    if (r.error) throw new Error(r.error);
    pollJob(r.jobId, (j) => {
      btn.disabled = false;
      if (j.status === "error") { if (status) status.textContent = "⚠ " + j.error; return; }
      if (status) status.textContent = "✅ Đã đăng Lark";
    });
  } catch (err) { btn.disabled = false; if (status) status.textContent = "⚠ " + err.message; }
});
const esc = (s) => String(s == null ? "" : s).replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Dải câu (timeline) — mỗi câu là 1 khối, bấm để nhảy tới. Giúp "nhìn thấy" cấu trúc short.
function timelineHtml(c) {
  const dur = c.duration || (c.sourceEnd - c.sourceStart) || 1;
  const segs = c.segments || [];
  const blocks = segs.map((s) => {
    const left = Math.max(0, Math.min(100, (s.start / dur) * 100));
    const w = Math.max(1.2, Math.min(100 - left, ((s.end - s.start) / dur) * 100));
    return `<span class="tl-seg" data-t="${s.start.toFixed(2)}" style="left:${left.toFixed(2)}%;width:${w.toFixed(2)}%" title="${esc(s.text)}"></span>`;
  }).join("");
  // Đánh dấu CÂU CAO TRÀO trên timeline (điểm nhấn cảm xúc) — bấm để nhảy tới.
  let climax = "";
  if (c.climaxAtSec != null && c.climaxAtSec >= 0 && c.climaxAtSec <= dur) {
    const cl = Math.max(0, Math.min(100, (c.climaxAtSec / dur) * 100));
    climax = `<span class="tl-climax tl-seg" data-t="${c.climaxAtSec.toFixed(2)}" style="left:${cl.toFixed(2)}%" title="🔥 Câu cao trào: ${esc(c.climax || "")}">🔥</span>`;
  }
  return `<div class="tl" title="Bấm vào từng câu để nhảy tới">${blocks}${climax}<span class="tl-play" style="left:0%"></span></div>`;
}

// Panel ✏️ Tinh chỉnh cho 1 short: trim đầu/cuối · sửa phụ đề · bật/tắt hiệu ứng · dựng lại.
function tinhChinhHtml(c, i, ed) {
  const sel = (id, opts, cur) => `<select class="tc-${id}" data-idx="${i}">` +
    opts.map(([v, t]) => `<option value="${v}"${v === cur ? " selected" : ""}>${t}</option>`).join("") + `</select>`;
  const chk = (id, label, on) => `<label><input type="checkbox" class="tc-${id}" data-idx="${i}"${on ? " checked" : ""}> ${label}</label>`;
  const subText = (c.segments || []).map((s) => s.text).join("\n");
  return `
    <details class="tc" data-idx="${i}">
      <summary>✏️ Tinh chỉnh short này (sửa điểm cắt · phụ đề · hiệu ứng)</summary>
      <div class="tc-body">
        ${timelineHtml(c)}
        <div class="tc-trim">
          <div class="tc-trimrow">
            <b>▶ Đầu:</b> <span class="tc-startlab">${mmss(c.sourceStart)}</span>
            <button class="tcbtn" data-idx="${i}" data-edge="start" data-d="-1">−1s</button>
            <button class="tcbtn" data-idx="${i}" data-edge="start" data-d="-0.3">−0.3</button>
            <button class="tcbtn" data-idx="${i}" data-edge="start" data-d="0.3">+0.3</button>
            <button class="tcbtn" data-idx="${i}" data-edge="start" data-d="1">+1s</button>
          </div>
          <div class="tc-trimrow">
            <b>⏹ Cuối:</b> <span class="tc-endlab">${mmss(c.sourceEnd)}</span>
            <button class="tcbtn" data-idx="${i}" data-edge="end" data-d="-1">−1s</button>
            <button class="tcbtn" data-idx="${i}" data-edge="end" data-d="-0.3">−0.3</button>
            <button class="tcbtn" data-idx="${i}" data-edge="end" data-d="0.3">+0.3</button>
            <button class="tcbtn" data-idx="${i}" data-edge="end" data-d="1">+1s</button>
            <span class="muted tc-durlab">· ${Math.round(c.duration || 0)}s</span>
          </div>
        </div>
        <label class="tc-sublabel">📝 Phụ đề (mỗi dòng = 1 câu; sửa chữ sai, để trống dòng để ẩn câu đó):</label>
        <textarea class="tc-sub" data-idx="${i}" rows="4" spellcheck="false">${esc(subText)}</textarea>
        <label><input type="checkbox" class="tc-subon" data-idx="${i}"> Áp phụ đề đã sửa (nếu không tick: giữ lời gốc)</label>
        <div class="tc-fx">
          <label>Khung: ${sel("reframe", [["blur", "9:16 nền mờ"], ["fill", "9:16 cắt đầy"]], ed.reframe || "blur")}</label>
          <label>Màu: ${sel("color", [["off", "Tắt"], ["low", "Nhẹ"], ["medium", "Vừa"], ["high", "Đậm"]], ed.colorLevel || "off")}</label>
          <label>Phụ đề: ${sel("capstyle", [["karaoke", "Karaoke"], ["popline", "Pop cụm"]], ed.captionStyle || "karaoke")}</label>
          ${chk("caps", "Bật phụ đề", true)}
          ${chk("punch", "Punch-zoom", !!ed.punch)}
          ${chk("film", "Vignette", ed.film !== false)}
          ${chk("prog", "Thanh tiến trình", ed.progress !== false)}
          ${chk("hook", "Đắp hook chữ to", !!ed.burnHook)}
        </div>
        <div class="tc-fx">
          <label>⏩ Tốc độ: <b class="tc-spdlab" data-idx="${i}">1.0</b>×
            <input type="range" class="tc-spd" data-idx="${i}" min="0.5" max="2" step="0.05" value="1" style="width:120px">
          </label>
        </div>
        <div class="tc-textrow">
          <label style="flex:1">✍️ Chữ tay:
            <input type="text" class="tc-ovl" data-idx="${i}" placeholder="VD: TÊN KÊNH CỦA BẠN (trống = không dùng)" style="width:100%">
          </label>
          <label>Vị trí:
            <select class="tc-ovlpos" data-idx="${i}"><option value="bottom">Dưới</option><option value="top">Trên</option><option value="middle">Giữa</option></select>
          </label>
        </div>
        <div class="tc-srctrim">
          <button class="tcbtn tc-srctoggle" data-idx="${i}">🎚️ Kéo cắt trên video gốc (kéo 2 tay nắm)</button>
          <div class="src-mount" data-idx="${i}" hidden></div>
        </div>
        <div class="tc-run">
          <button class="dl tc-apply" data-idx="${i}">🔁 Dựng lại short này</button>
          <span class="tc-status muted"></span>
        </div>
      </div>
    </details>`;
}

function renderClips(host, res) {
  const ok = (res.clips || []).filter((c) => !c.error);
  _acClips = ok;
  _acSource = res.source || null;
  _acTranscriptFile = res.transcriptFile || null;
  _acEditOpts = res.editOpts || {};
  _acSourceDuration = res.sourceDuration || 0;
  const cards = ok.map((c, i) => {
    const url = "/api/file?path=" + encodeURIComponent(c.outPath);
    const cap = (c.caption || "").replace(/</g, "&lt;");
    const thumbUrl = c.thumbPath ? "/api/file?path=" + encodeURIComponent(c.thumbPath) : null;
    return `
      <div class="clip-card" data-idx="${i}" data-x="85" data-y="88" data-scale="0.16" data-cta="" data-preview="" data-raw="${url}" data-start="${c.sourceStart ?? ""}" data-end="${c.sourceEnd ?? ""}">
        <div class="clip-vwrap">
          <video src="${url}" controls preload="none"></video>
          <img class="logo-ov" alt="logo" style="display:none" draggable="false">
        </div>
        <div class="prev-note muted" style="display:none;font-size:11px;padding:4px 6px">🔊 Đang xem BẢN CÓ NHẠC (nghe thử trước khi tải)</div>
        <div class="logo-pad" style="display:none">
          <span class="lp-label">Logo:</span>
          <button class="lpbtn" data-act="left" title="Sang trái">◀</button>
          <button class="lpbtn" data-act="up" title="Lên">▲</button>
          <button class="lpbtn" data-act="down" title="Xuống">▼</button>
          <button class="lpbtn" data-act="right" title="Sang phải">▶</button>
          <button class="lpbtn" data-act="zoomout" title="Nhỏ lại">🔍−</button>
          <button class="lpbtn" data-act="zoomin" title="To lên">🔍+</button>
        </div>
        <div class="clip-body">
          <div class="clip-top">
            <span class="clip-score" title="Điểm NỘI DUNG — AI chấm triết lý + viral + cảm xúc">📝 ${c.score}</span>
            ${c.techScore != null ? `<span class="clip-score tech" title="Điểm KỸ THUẬT — 6 trục hook/nhịp/giữ chân/âm thanh/định dạng/phụ đề">🔧 ${c.techScore}</span>` : ""}
            <b>${(c.title||"").replace(/</g,"&lt;")}</b>
          </div>
          <div class="clip-hook">🎯 Hook: <b>${(c.hook||"").replace(/</g,"&lt;")}</b></div>
          ${c.philosophy ? `<div class="clip-phi">💡 ${c.philosophy.replace(/</g,"&lt;")}</div>` : ""}
          ${c.emotion ? `<div class="clip-emo">❤️ Cảm xúc: <b>${esc(c.emotion)}</b>${c.emotionScore ? ` · ${c.emotionScore}/100` : ""}</div>` : ""}
          ${c.climax ? `<div class="clip-climax">🔥 Câu cao trào: “${esc(c.climax)}”</div>` : ""}
          <details class="clip-cap"><summary>Caption đăng bài</summary><pre>${cap}</pre></details>
          <div class="muted" style="font-size:11px">Nguồn: ${c.start!=null? (Math.floor(c.start/60)+":"+String(Math.floor(c.start%60)).padStart(2,"0")) : "?"} · ${Math.round(c.duration||0)}s</div>
          ${thumbUrl ? `<details class="clip-cap"><summary>🖼️ Thumbnail (ảnh bìa)</summary><img src="${thumbUrl}" style="width:100%;border-radius:8px;margin-top:6px"><a class="dl" href="/api/file?dl=1&path=${encodeURIComponent(c.thumbPath)}" download>⬇ Tải bìa</a></details>` : ""}
          <div class="clip-cta">
            <label class="link">🎬 Chọn CTA cho video này<input type="file" accept="video/*" hidden class="cta-input" data-idx="${i}"></label>
            <span class="cta-name muted">chưa có CTA</span>
          </div>
          <div class="clip-dls">
            <button class="dl prevbtn" data-idx="${i}">▶ Xem trước (có nhạc)</button>
            <a class="dl ghost" href="/api/file?dl=1&path=${encodeURIComponent(c.outPath)}" download>⬇ Bản gốc</a>
            <button class="dl finbtn" data-idx="${i}">⬇ Tải kèm logo/nhạc/CTA</button>
            <button class="dl larkbtn" data-idx="${i}">📤 Đăng Lark</button>
          </div>
          <div class="lark-status muted" data-idx="${i}" style="font-size:11px;margin-top:4px">${c.larkPosted ? "✅ Đã tự đăng Lark (Loại=Video)" : (c.larkError ? "⚠ Tự đăng Lark lỗi: " + esc(c.larkError) : "")}</div>
          ${tinhChinhHtml(c, i, _acEditOpts)}
        </div>
      </div>`;
  }).join("");
  const failed = (res.clips || []).filter((c) => c.error);
  host.innerHTML = `
    <div class="scorecard">
      <h3>🧠 Đã cắt ${ok.length} short từ video ${Math.round(res.durationSec/60)} phút</h3>
      <div class="muted score-legend" style="font-size:11.5px;margin:-4px 0 8px">Mỗi short có 2 điểm: <b>📝 Điểm nội dung</b> (AI chấm triết lý + viral + cảm xúc) và <b>🔧 Điểm kỹ thuật</b> (6 trục hook/nhịp/giữ chân/âm thanh/định dạng/phụ đề).</div>
      <div class="fin-bar">
        <div class="fin-title">🎨 Biên tập trực tiếp — chỉnh là thấy ngay trên video, rồi <b>Tải kèm</b></div>
        <div class="fin-row">
          <b style="font-size:12px">🎨 Màu:</b>
          <label>Sáng/Tối <b id="fin-brival">0</b><input type="range" id="fin-bri" min="-100" max="100" value="0"></label>
          <label>Tương phản <b id="fin-conval">0</b><input type="range" id="fin-con" min="-100" max="100" value="0"></label>
          <label>Bão hoà <b id="fin-satval">0</b><input type="range" id="fin-sat" min="-100" max="100" value="0"></label>
          <button class="lpbtn" id="fin-colorreset" title="Đưa màu về 0">↺</button>
        </div>
        <div class="fin-row">
          <label class="link">🏷️ Chọn logo<input type="file" id="fin-logo" accept="image/*" hidden></label>
          <span id="fin-logoname" class="muted">chưa chọn</span>
          <label>Cỡ <b id="fin-szval">16</b>%<input type="range" id="fin-sz" min="5" max="60" value="16"></label>
          <label>Mờ <b id="fin-opval">90</b>%<input type="range" id="fin-op" min="20" max="100" value="90"></label>
        </div>
        <div class="fin-row">
          <label class="link">🎵 Chọn nhạc<input type="file" id="fin-music" accept="audio/*" hidden></label>
          <span id="fin-musicname" class="muted">chưa chọn</span>
          <label>🔊 Âm lượng nhạc <b id="fin-mvval">30</b>%<input type="range" id="fin-mv" min="0" max="100" value="30"></label>
          <span class="muted" style="font-size:11px">Kéo to/nhỏ tuỳ ý. Giọng luôn giữ nguyên; nhạc tự nhường khi có tiếng nói.</span>
        </div>
        <div class="muted" style="font-size:11px">Kéo logo trên video HOẶC dùng nút ◀▲▼▶ 🔍 ngay dưới video. Mỗi video chọn CTA riêng. "Tải kèm" nướng logo+nhạc+CTA đúng như anh thấy.</div>
      </div>
      <div class="muted" style="font-size:12px;margin:6px 0 10px">Thư mục xuất: ${res.outDir} · mỗi short kèm 1 file .txt</div>
      <div class="clip-grid">${cards || "<i>Không có short nào đạt yêu cầu.</i>"}</div>
      ${failed.length ? `<div class="muted" style="margin-top:10px">⚠ ${failed.length} đoạn lỗi khi dựng.</div>` : ""}
    </div>`;
  wireFinalize();
  wireTinhChinh();
}

// Nối 1 timeline (bấm câu → nhảy tới; con trỏ chạy theo video). Dùng property handler
// để không cộng dồn listener mỗi lần dựng lại.
function wireTimeline(card) {
  const v = card.querySelector("video");
  const tl = card.querySelector(".tl");
  if (!tl || !v) return;
  tl.querySelectorAll(".tl-seg").forEach((seg) => seg.addEventListener("click", () => {
    const t = parseFloat(seg.dataset.t);
    if (isFinite(t)) { v.currentTime = t; v.play().catch(() => {}); }
  }));
  const play = tl.querySelector(".tl-play");
  v.ontimeupdate = () => {
    if (!v.duration) return;
    play.style.left = Math.max(0, Math.min(100, (v.currentTime / v.duration) * 100)) + "%";
  };
}

// Cập nhật nhãn trim (đầu/cuối/thời lượng) từ dataset của thẻ.
function refreshTrimLabels(card) {
  const det = card.querySelector(".tc");
  if (!det) return;
  const s = +card.dataset.start, e = +card.dataset.end;
  det.querySelector(".tc-startlab").textContent = mmss(s);
  det.querySelector(".tc-endlab").textContent = mmss(e);
  det.querySelector(".tc-durlab").textContent = "· " + Math.round(e - s) + "s";
  const srctl = card.querySelector(".srctl");
  if (srctl) positionSrc(card);
}

// Đặt 2 tay nắm + vùng chọn trên thanh cắt video gốc theo dataset.start/end + cửa sổ.
function positionSrc(card) {
  const srctl = card.querySelector(".srctl");
  if (!srctl) return;
  const ws = +srctl.dataset.ws, we = +srctl.dataset.we, span = Math.max(0.1, we - ws);
  const s = +card.dataset.start, e = +card.dataset.end;
  const pIn = Math.max(0, Math.min(100, (s - ws) / span * 100));
  const pOut = Math.max(0, Math.min(100, (e - ws) / span * 100));
  srctl.querySelector(".h-in").style.left = pIn + "%";
  srctl.querySelector(".h-out").style.left = pOut + "%";
  const sel = srctl.querySelector(".src-sel");
  sel.style.left = pIn + "%"; sel.style.width = Math.max(0, pOut - pIn) + "%";
  const m = card.querySelector(".src-mount");
  m.querySelector(".src-inlab").textContent = "vào " + mmss(s);
  m.querySelector(".src-outlab").textContent = "ra " + mmss(e);
  m.querySelector(".src-durlab").textContent = Math.round(e - s) + "s";
}

// Dựng (lazy) trình cắt tay trên VIDEO GỐC cho 1 thẻ — kéo 2 tay nắm để đặt vào/ra.
function buildSourceTrim(card) {
  const mount = card.querySelector(".src-mount");
  if (mount.dataset.built) { mount.hidden = !mount.hidden; return; }
  if (!_acSource) { alert("Thiếu video gốc."); return; }
  mount.dataset.built = "1"; mount.hidden = false;
  const s = +card.dataset.start, e = +card.dataset.end;
  const dur = _acSourceDuration || (e + 15);
  const ws = Math.max(0, s - 12), we = Math.min(dur, e + 12);
  mount.innerHTML =
    `<video class="src-v" src="/api/file?path=${encodeURIComponent(_acSource)}" preload="metadata" muted playsinline></video>` +
    `<div class="srctl" data-ws="${ws}" data-we="${we}"><div class="src-sel"></div>` +
    `<div class="src-h h-in" title="Điểm VÀO — kéo"></div><div class="src-h h-out" title="Điểm RA — kéo"></div></div>` +
    `<div class="src-lab muted"><span class="src-inlab"></span> · <span class="src-outlab"></span> · <span class="src-durlab"></span> — kéo tay nắm, khung hình hiện ngay trên video</div>`;
  const srctl = mount.querySelector(".srctl");
  const vid = mount.querySelector(".src-v");
  positionSrc(card);
  const drag = (handle, edge) => {
    let on = false;
    const pos = (cx) => {
      const r = srctl.getBoundingClientRect();
      const t = ws + Math.max(0, Math.min(1, (cx - r.left) / r.width)) * (we - ws);
      let sVal = +card.dataset.start, eVal = +card.dataset.end;
      if (edge === "in") sVal = Math.max(ws, Math.min(eVal - 1, t));
      else eVal = Math.min(we, Math.max(sVal + 1, t));
      card.dataset.start = sVal.toFixed(2); card.dataset.end = eVal.toFixed(2);
      positionSrc(card); refreshTrimLabels(card);
      const seekT = edge === "in" ? sVal : eVal;
      if (isFinite(seekT) && vid.readyState >= 1) { try { vid.currentTime = seekT; } catch (e) {} }
    };
    handle.addEventListener("mousedown", (ev) => { ev.preventDefault(); on = true; pos(ev.clientX); });
    window.addEventListener("mousemove", (ev) => { if (on) pos(ev.clientX); });
    window.addEventListener("mouseup", () => { on = false; });
    handle.addEventListener("touchstart", (ev) => { on = true; pos(ev.touches[0].clientX); }, { passive: true });
    handle.addEventListener("touchmove", (ev) => { if (on) pos(ev.touches[0].clientX); }, { passive: true });
    handle.addEventListener("touchend", () => { on = false; });
  };
  drag(srctl.querySelector(".h-in"), "in");
  drag(srctl.querySelector(".h-out"), "out");
  vid.addEventListener("loadedmetadata", () => { try { vid.currentTime = +card.dataset.start; } catch (e) {} });
}

// ---- Lớp ✏️ TINH CHỈNH: timeline seek + trim + dựng lại 1 short ----
function wireTinhChinh() {
  $$(".clip-card").forEach(wireTimeline);

  // Trim đầu/cuối: nút ± đổi mốc nguồn (data-start/data-end), cập nhật nhãn + thời lượng.
  $$(".tcbtn").forEach((btn) => btn.addEventListener("click", () => {
    if (!btn.dataset.edge) return; // bỏ qua nút toggle "kéo cắt" (cũng là .tcbtn)
    const card = $$(".clip-card")[+btn.dataset.idx];
    const edge = btn.dataset.edge, d = parseFloat(btn.dataset.d);
    let s = parseFloat(card.dataset.start), e = parseFloat(card.dataset.end);
    if (!isFinite(s) || !isFinite(e)) return;
    if (edge === "start") s = Math.max(0, Math.min(e - 1, s + d));
    else e = Math.max(s + 1, e + d);
    card.dataset.start = s.toFixed(2); card.dataset.end = e.toFixed(2);
    refreshTrimLabels(card);
  }));

  // 🎚️ Kéo cắt trên video gốc (bật/tắt trình cắt tay lazy)
  $$(".tc-srctoggle").forEach((btn) => btn.addEventListener("click", () => {
    buildSourceTrim($$(".clip-card")[+btn.dataset.idx]);
  }));

  // ⏩ Nhãn tốc độ chạy theo slider
  $$(".tc-spd").forEach((sl) => sl.addEventListener("input", () => {
    sl.closest(".tc").querySelector(".tc-spdlab").textContent = (+sl.value).toFixed(2);
  }));

  // 🔁 Dựng lại short này
  $$(".tc-apply").forEach((btn) => btn.addEventListener("click", async () => {
    const i = +btn.dataset.idx;
    const card = $$(".clip-card")[i];
    const det = card.querySelector(".tc");
    const status = det.querySelector(".tc-status");
    const clip = _acClips[i];
    if (!_acSource) return alert("Thiếu video gốc để dựng lại (hãy cắt lại từ đầu).");
    const g = (cls) => det.querySelector(".tc-" + cls);
    const subOn = g("subon").checked;
    const body = {
      source: _acSource, transcriptFile: _acTranscriptFile,
      start: parseFloat(card.dataset.start), end: parseFloat(card.dataset.end),
      segments: subOn ? g("sub").value.split("\n").map((x) => x.trim()) : null,
      reframe: g("reframe").value,
      colorLevel: g("color").value,
      captionStyle: g("capstyle").value,
      doCaptions: g("caps").checked,
      punch: g("punch").checked,
      film: g("film").checked,
      progress: g("prog").checked,
      hookText: g("hook").checked ? (clip.hook || clip.title || null) : null,
      speed: parseFloat(g("spd").value) || 1,
      overlayText: g("ovl").value.trim() || null,
      overlayPos: g("ovlpos").value,
    };
    btn.disabled = true; const old = btn.textContent; btn.textContent = "⏳ Đang dựng lại…";
    status.textContent = "";
    try {
      const r = await fetch("/api/reclip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      await new Promise((resolve, reject) => pollJob(r.jobId, (j) => {
        if (j.status === "error") return reject(new Error(j.error));
        const out = j.result.outPath;
        // Cập nhật short: file mới thành "bản gốc" để lớp finalize (logo/nhạc) chồng lên.
        clip.outPath = out;
        clip.segments = j.result.segments || clip.segments;
        clip.duration = j.result.duration || clip.duration;
        card.dataset.start = String(j.result.sourceStart);
        card.dataset.end = String(j.result.sourceEnd);
        const newUrl = "/api/file?path=" + encodeURIComponent(out) + "&t=" + Date.now();
        card.dataset.raw = newUrl; card.dataset.preview = "";
        const v = card.querySelector("video");
        v.src = newUrl; v.load(); v.style.filter = colorFilterCss();
        const note = card.querySelector(".prev-note"); if (note) note.style.display = "none";
        // Vẽ lại timeline theo phụ đề/thời lượng mới
        const tlOld = det.querySelector(".tl");
        const tmp = document.createElement("div"); tmp.innerHTML = timelineHtml(clip);
        tlOld.replaceWith(tmp.firstElementChild);
        wireTimeline(card); // chỉ nối lại timeline của thẻ này (không double-bind)
        resolve();
      }));
      status.textContent = "✅ đã dựng lại";
    } catch (err) { status.textContent = "❌ " + err.message; alert(err.message); }
    finally { btn.disabled = false; btn.textContent = old; }
  }));
}

function applyLogoTo(card) {
  const ov = card.querySelector(".logo-ov");
  const wrap = card.querySelector(".clip-vwrap");
  const pad = card.querySelector(".logo-pad");
  if (!finState.logoUrl) { ov.style.display = "none"; if (pad) pad.style.display = "none"; return; }
  const scale = +(card.dataset.scale || finState.scale);
  ov.src = finState.logoUrl;
  ov.style.display = "block";
  if (pad) pad.style.display = "flex";
  ov.style.width = (scale * 100) + "%";
  ov.style.opacity = finState.opacity;
  const ww = wrap.clientWidth, wh = wrap.clientHeight, lw = ov.offsetWidth, lh = ov.offsetHeight;
  const x = +card.dataset.x, y = +card.dataset.y;
  ov.style.left = Math.max(0, x / 100 * (ww - lw)) + "px";
  ov.style.top = Math.max(0, y / 100 * (wh - lh)) + "px";
}
function applyLogoAll() { $$(".clip-card").forEach(applyLogoTo); }
const clampPct = (v) => Math.max(0, Math.min(100, v));

// Chỉnh màu TRỰC TIẾP bằng CSS filter (khớp eq khi nướng ở finalize).
function colorFilterCss() {
  const c = finState.color || {};
  return `brightness(${1 + (c.brightness || 0) / 200}) contrast(${1 + (c.contrast || 0) / 100}) saturate(${1 + (c.saturation || 0) / 100})`;
}
function applyColorAll() {
  const f = colorFilterCss();
  $$(".clip-card").forEach((card) => {
    const v = card.querySelector("video");
    if (v) v.style.filter = card.dataset.preview ? "none" : f; // bản đã nướng thì tắt filter (màu đã bám)
  });
}

function wireFinalize() {
  // Khởi tạo từ đầu vào: logo (ô ④), CTA chung (ô ③), màu về 0
  if (finState.logoPath) $("#fin-logoname").textContent = "(từ ô ④ Logo)";
  if (finState.cta) $$(".clip-card").forEach((card) => { card.dataset.cta = finState.cta; const n = card.querySelector(".cta-name"); if (n) n.textContent = "✔ CTA chung (ô ③)"; });

  // 🎨 Màu TRỰC TIẾP: kéo là thấy ngay (CSS), 'change' thì huỷ bản nướng cũ để tải lại đúng màu
  const bindColor = (id, key, lab) => {
    $("#" + id).addEventListener("input", (e) => { $("#" + lab).textContent = e.target.value; finState.color[key] = +e.target.value; applyColorAll(); });
    $("#" + id).addEventListener("change", invalidateAll);
  };
  bindColor("fin-bri", "brightness", "fin-brival");
  bindColor("fin-con", "contrast", "fin-conval");
  bindColor("fin-sat", "saturation", "fin-satval");
  $("#fin-colorreset").addEventListener("click", () => {
    finState.color = { brightness: 0, contrast: 0, saturation: 0 };
    ["fin-bri", "fin-con", "fin-sat"].forEach((i) => $("#" + i).value = 0);
    ["fin-brival", "fin-conval", "fin-satval"].forEach((i) => $("#" + i).textContent = "0");
    applyColorAll(); invalidateAll();
  });

  $("#fin-logo").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      finState.logoUrl = URL.createObjectURL(f);
      finState.logoPath = await uploadFile(f);
      $("#fin-logoname").textContent = f.name;
      applyLogoAll();
    } catch (err) { alert(err.message); }
  });
  $("#fin-sz").addEventListener("input", (e) => { $("#fin-szval").textContent = e.target.value; finState.scale = (+e.target.value) / 100; $$(".clip-card").forEach((c) => c.dataset.scale = finState.scale); applyLogoAll(); });
  $("#fin-op").addEventListener("input", (e) => { $("#fin-opval").textContent = e.target.value; finState.opacity = (+e.target.value) / 100; $$(".logo-ov").forEach((o) => o.style.opacity = finState.opacity); });
  $("#fin-music").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { finState.musicPath = await uploadFile(f); $("#fin-musicname").textContent = f.name; } catch (err) { alert(err.message); }
  });
  $("#fin-mv").addEventListener("input", (e) => { $("#fin-mvval").textContent = e.target.value; finState.musicVol = (+e.target.value) / 100; });

  // Kéo-thả logo trên từng video
  $$(".clip-card").forEach((card) => {
    const ov = card.querySelector(".logo-ov");
    const wrap = card.querySelector(".clip-vwrap");
    let d = null;
    const start = (cx, cy) => { d = { sx: cx, sy: cy, l: ov.offsetLeft, t: ov.offsetTop, ww: wrap.clientWidth, wh: wrap.clientHeight, lw: ov.offsetWidth, lh: ov.offsetHeight }; };
    const move = (cx, cy) => {
      if (!d) return;
      let nl = Math.max(0, Math.min(d.ww - d.lw, d.l + cx - d.sx));
      let nt = Math.max(0, Math.min(d.wh - d.lh, d.t + cy - d.sy));
      ov.style.left = nl + "px"; ov.style.top = nt + "px";
      card.dataset.x = (d.ww - d.lw > 0 ? nl / (d.ww - d.lw) * 100 : 0).toFixed(1);
      card.dataset.y = (d.wh - d.lh > 0 ? nt / (d.wh - d.lh) * 100 : 0).toFixed(1);
    };
    ov.addEventListener("mousedown", (e) => { e.preventDefault(); start(e.clientX, e.clientY); });
    window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
    window.addEventListener("mouseup", () => { if (d) { d = null; invalidateCard(card); } });
    ov.addEventListener("touchstart", (e) => { start(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    ov.addEventListener("touchmove", (e) => { move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    ov.addEventListener("touchend", () => { if (d) { d = null; invalidateCard(card); } });
  });

  // Nút 4 hướng + zoom logo (chỉnh trực quan từng video)
  $$(".lpbtn").forEach((btn) => btn.addEventListener("click", () => {
    const card = btn.closest(".clip-card");
    const act = btn.dataset.act;
    const step = 4; // % mỗi lần nhấn
    if (act === "left") card.dataset.x = clampPct(+card.dataset.x - step);
    else if (act === "right") card.dataset.x = clampPct(+card.dataset.x + step);
    else if (act === "up") card.dataset.y = clampPct(+card.dataset.y - step);
    else if (act === "down") card.dataset.y = clampPct(+card.dataset.y + step);
    else if (act === "zoomin") card.dataset.scale = Math.min(0.6, +(card.dataset.scale || finState.scale) + 0.02).toFixed(3);
    else if (act === "zoomout") card.dataset.scale = Math.max(0.05, +(card.dataset.scale || finState.scale) - 0.02).toFixed(3);
    applyLogoTo(card);
    invalidateCard(card);
  }));

  // Chọn video CTA riêng cho từng short
  $$(".cta-input").forEach((inp) => inp.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const card = inp.closest(".clip-card");
    const nameEl = card.querySelector(".cta-name");
    nameEl.textContent = "đang tải CTA…";
    try { card.dataset.cta = await uploadFile(f); nameEl.textContent = "✔ CTA: " + f.name; invalidateCard(card); }
    catch (err) { nameEl.textContent = "lỗi tải CTA"; alert(err.message); }
  }));

  window.addEventListener("resize", applyLogoAll);

  // Huỷ bản xem trước khi anh đổi logo/nhạc/CTA (để tải luôn khớp cái vừa nghe)
  $("#fin-logo").addEventListener("change", invalidateAll);
  $("#fin-music").addEventListener("change", invalidateAll);
  $("#fin-sz").addEventListener("change", invalidateAll);
  $("#fin-op").addEventListener("change", invalidateAll);
  $("#fin-mv").addEventListener("change", invalidateAll);

  // Gom thiết lập finalize hiện tại cho 1 thẻ
  function finBody(card) {
    return {
      path: _acClips[+card.dataset.idx].outPath,
      color: finState.color,
      transition: finState.transition,
      logoPath: finState.logoPath || null, logoX: +card.dataset.x, logoY: +card.dataset.y,
      logoScale: +(card.dataset.scale || finState.scale), logoOpacity: finState.opacity,
      musicPath: finState.musicPath || null, musicVol: finState.musicVol,
      ctaPath: null,   // CTA đã được nướng sẵn vào short khi cắt (③) → không ghép lại ở finalize (tránh CTA đôi)
    };
  }
  const colorActive = () => { const c = finState.color || {}; return !!(c.brightness || c.contrast || c.saturation); };
  const hasExtras = (card) => finState.logoPath || finState.musicPath || card.dataset.cta || colorActive();

  // Chạy finalize → trả về đường dẫn file kết quả (Promise)
  function runFinalize(card, btn, labelBusy) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = labelBusy;
    return fetch("/api/finalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(finBody(card)) })
      .then((r) => r.json())
      .then((r) => new Promise((resolve, reject) => {
        if (r.error) return reject(new Error(r.error));
        pollJob(r.jobId, (j) => {
          btn.disabled = false; btn.textContent = old;
          if (j.status === "error") return reject(new Error(j.error));
          resolve(j.result.outPath);
        });
      }))
      .catch((err) => { btn.disabled = false; btn.textContent = old; throw err; });
  }

  // ▶ XEM TRƯỚC (có nhạc): nướng rồi PHÁT ngay trong app để nghe/kiểm chứng
  $$(".prevbtn").forEach((btn) => btn.addEventListener("click", async () => {
    const card = btn.closest(".clip-card");
    const v = card.querySelector("video");
    const note = card.querySelector(".prev-note");
    if (!hasExtras(card)) {
      // Không có nhạc/logo/CTA → bản gốc chính là bản cuối, cứ phát
      v.src = card.dataset.raw; v.load(); v.play();
      return alert("Chưa chọn nhạc/logo/CTA nên bản xem trước = bản gốc. Hãy chọn nhạc để nghe thử phần trộn.");
    }
    try {
      const out = await runFinalize(card, btn, "⏳ Đang tạo bản nghe thử…");
      card.dataset.preview = out;
      const url = "/api/file?path=" + encodeURIComponent(out);
      v.src = url; v.load(); v.play();
      v.style.filter = "none"; // màu đã nướng vào file → tắt filter CSS tránh nhân đôi
      if (note) note.style.display = "block";
    } catch (err) { alert(err.message); }
  }));

  // ⬇ TẢI: nếu đã xem trước với đúng thiết lập thì tải luôn bản đó; nếu chưa thì nướng rồi tải
  $$(".finbtn").forEach((btn) => btn.addEventListener("click", async () => {
    const card = btn.closest(".clip-card");
    const clip = _acClips[+card.dataset.idx];
    if (!hasExtras(card)) { downloadFile(clip.outPath); return; }
    try {
      let out = card.dataset.preview;
      if (!out) out = await runFinalize(card, btn, "⏳ Đang nướng…");
      downloadFile(out);   // tải ngầm, KHÔNG chuyển trang → các short khác còn nguyên
    } catch (err) { alert(err.message); }
  }));

  // 📤 ĐĂNG LÊN LARK: nếu đã có bản nướng logo/nhạc/CTA thì đăng bản đó; nếu có
  // thiết lập mà chưa nướng thì nướng trước; caption = caption AI, kèm thumbnail thương hiệu.
  $$(".larkbtn").forEach((btn) => btn.addEventListener("click", async () => {
    const card = btn.closest(".clip-card");
    const i = +card.dataset.idx;
    const clip = _acClips[i];
    const status = card.querySelector(".lark-status");
    let videoPath = clip.outPath;
    try {
      if (hasExtras(card)) {
        let out = card.dataset.preview;
        if (!out) out = await runFinalize(card, btn, "⏳ Nướng trước khi đăng…");
        videoPath = out;
      }
    } catch (err) { status.textContent = "❌ " + err.message; return; }
    const old = btn.textContent; btn.disabled = true; btn.textContent = "⏳ Đang đăng Lark…";
    status.textContent = "đang tạo record + upload video (video lớn có thể lâu)…";
    try {
      const r = await fetch("/api/lark-post", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath, caption: clip.caption || clip.title || "", thumbPath: clip.thumbPath || null }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      await new Promise((resolve, reject) => pollJob(r.jobId, (j) => {
        if (j.status === "error") return reject(new Error(j.error));
        resolve(j.result);
      }));
      status.textContent = "✅ Đã đăng lên Lark Base (Nội dung + Ảnh/video)";
    } catch (err) { status.textContent = "❌ " + err.message; alert("Đăng Lark lỗi: " + err.message); }
    finally { btn.disabled = false; btn.textContent = old; }
  }));

  applyLogoAll();
  applyColorAll();
}

// Huỷ bản xem trước của 1 thẻ (đưa video về bản gốc) — khi đổi thiết lập
function invalidateCard(card) {
  if (card.dataset.preview) {
    card.dataset.preview = "";
    const v = card.querySelector("video"); if (v) { try { v.pause(); } catch (e) {} v.src = card.dataset.raw; v.load(); v.style.filter = colorFilterCss(); }
    const n = card.querySelector(".prev-note"); if (n) n.style.display = "none";
  }
}
function invalidateAll() { $$(".clip-card").forEach(invalidateCard); }

// ================= ĐÁNH GIÁ =================
let evalPath = null;
wireDrop("dz-eval", "file-eval", "path-eval", async (f) => {
  showLog("Tải lên…");
  try { evalPath = await uploadFile(f); $("#path-eval").value = evalPath; setLog(["✔ Đã tải: " + f.name]); }
  catch (e) { alert(e.message); }
});
$("#btn-eval").addEventListener("click", async () => {
  const file = $("#path-eval").value.trim() || evalPath;
  if (!file) return alert("Chọn hoặc kéo-thả video, hoặc dán đường dẫn.");
  $("#btn-eval").disabled = true; $("#eval-out").innerHTML = "";
  const r = await fetch("/api/evaluate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: file, deep: $("#eval-deep").checked, model: $("#eval-model").value }),
  }).then((r) => r.json());
  if (r.error) { $("#btn-eval").disabled = false; return alert(r.error); }
  pollJob(r.jobId, (j) => {
    $("#btn-eval").disabled = false;
    if (j.status === "error") return alert(j.error);
    renderScorecard($("#eval-out"), j.result);
  });
});

// 🏅 CHẠY TIÊU CHUẨN — chấm theo thang 100 điểm.
$("#btn-standard").addEventListener("click", async () => {
  const file = $("#path-eval").value.trim() || evalPath;
  if (!file) return alert("Chọn hoặc kéo-thả video, hoặc dán đường dẫn.");
  const btn = $("#btn-standard"); const old = btn.textContent;
  btn.disabled = true; btn.textContent = "⏳ Đang chấm tiêu chuẩn…"; $("#eval-out").innerHTML = "";
  const r = await fetch("/api/standard", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: file, model: $("#eval-model").value }),
  }).then((r) => r.json());
  if (r.error) { btn.disabled = false; btn.textContent = old; return alert(r.error); }
  pollJob(r.jobId, (j) => {
    btn.disabled = false; btn.textContent = old;
    if (j.status === "error") return alert(j.error);
    renderStandard($("#eval-out"), j.result);
  });
});
function standardColor(t) { return t >= 90 ? "var(--ok)" : t >= 80 ? "var(--warn)" : "var(--acc)"; }
function renderStandard(host, r) {
  const esc2 = (s) => String(s == null ? "" : s).replace(/</g, "&lt;");
  const cats = (r.categories || []).map((c) => {
    const pct = c.max ? Math.round((c.score / c.max) * 100) : 0;
    const col = pct >= 80 ? "var(--ok)" : pct >= 60 ? "var(--warn)" : "var(--acc)";
    return `<div class="dim">
      <div class="h"><span>${esc2(c.name)} <span class="muted" style="font-size:11px">(${c.do_bang === "máy đo" ? "máy đo" : "AI"})</span></span><span style="color:${col}"><b>${c.score}</b>/${c.max}</span></div>
      <div class="bar"><i style="width:${pct}%;background:${col}"></i></div>
      ${c.nhan_xet ? `<div class="d">${esc2(c.nhan_xet)}</div>` : ""}
      ${c.sua ? `<ul><li>🔧 ${esc2(c.sua)}</li></ul>` : ""}
    </div>`;
  }).join("");
  const check = (r.checklist || []).map((x) => `<li>${x.dat ? "✅" : "❌"} ${esc2(x.tieu_chi)}</li>`).join("");
  const cam = (r.cam_ky || []).map((x) => `<li>🚫 ${esc2(x)}</li>`).join("");
  const fixes = (r.sua_uu_tien || []).map((x) => `<li>➡️ ${esc2(x)}</li>`).join("");
  host.innerHTML = `<div class="scorecard">
    <div class="overall">
      <div class="bigscore" style="color:${standardColor(r.total)}">${r.total}<span style="font-size:22px">/100</span></div>
      <div><div class="verdict"><b>${esc2(r.verdict)}</b></div>
        <div class="muted" style="font-size:12px">${r.meta.width}x${r.meta.height} · ${r.meta.duration.toFixed(0)}s · ${r.signals.cutsPerMin ?? "?"} cắt/phút · ${r.signals.lufs ?? "?"} LUFS</div></div>
    </div>
    <div class="grid">${cats}</div>
    ${cam ? `<div class="ai"><b>🚫 Điều cấm kỵ bị vi phạm:</b><ul style="margin:6px 0 0">${cam}</ul></div>` : ""}
    ${fixes ? `<div class="ai" style="border-left-color:var(--ok)"><b>➡️ Việc cần sửa ưu tiên:</b><ul style="margin:6px 0 0">${fixes}</ul></div>` : ""}
    ${check ? `<details style="margin-top:14px" open><summary class="muted">☑️ Checklist nghiệm thu</summary><ul style="margin:6px 0 0;columns:2">${check}</ul></details>` : ""}
  </div>`;
}

function scoreColor(s) { return s >= 75 ? "var(--ok)" : s >= 55 ? "var(--warn)" : "var(--acc)"; }
function renderScorecard(host, ev) {
  const dims = ev.dimensions || {};
  const dimHtml = Object.values(dims).map((d) => `
    <div class="dim">
      <div class="h"><span>${d.label}</span><span style="color:${scoreColor(d.score)}">${d.score}</span></div>
      <div class="bar"><i style="width:${d.score}%;background:${scoreColor(d.score)}"></i></div>
      <div class="d">${d.detail}</div>
      ${d.tips && d.tips.length ? `<ul>${d.tips.map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}
    </div>`).join("");
  host.innerHTML = `
    <div class="scorecard">
      <div class="overall">
        <div class="bigscore" style="color:${scoreColor(ev.overall)}">${ev.overall}</div>
        <div><div class="verdict"><b>${ev.verdict}</b></div>
          <div class="muted" style="font-size:12px">${ev.meta.width}x${ev.meta.height} · ${ev.meta.duration.toFixed(0)}s · ${ev.signals.cutsPerMin} cắt/phút · ${ev.signals.lufs ?? "?"} LUFS</div>
        </div>
      </div>
      <div class="grid">${dimHtml}</div>
      ${ev.aiAnalysis ? `<div class="ai"><b>🤖 Phân tích sâu (AI cloud):</b>\n\n${ev.aiAnalysis}</div>` : ""}
      ${ev.transcriptText ? `<details style="margin-top:14px"><summary class="muted">Transcript</summary><p style="font-size:13px">${ev.transcriptText}</p></details>` : ""}
    </div>`;
}

// ================= BIÊN TẬP =================
let editPath = null;
wireDrop("dz-edit", "file-edit", "path-edit", async (f) => {
  showLog("Tải lên…");
  try { editPath = await uploadFile(f); $("#path-edit").value = editPath; setLog(["✔ Đã tải: " + f.name]); }
  catch (e) { alert(e.message); }
});
$("#btn-edit").addEventListener("click", async () => {
  const file = $("#path-edit").value.trim() || editPath;
  if (!file) return alert("Chọn/kéo-thả video hoặc dán đường dẫn.");
  $("#btn-edit").disabled = true; $("#edit-out").innerHTML = "";
  const body = {
    path: file,
    removeFillers: $("#e-fillers").checked,
    doCutSilence: $("#e-cut").checked,
    doCaptions: $("#e-cap").checked,
    normalize: $("#e-norm").checked,
    reframe: $("#e-reframe").value,
    captionStyle: $("#e-capstyle").value,
    colorLevel: $("#e-color").value,
    manual: {
      brightness: +$("#e-bri").value, contrast: +$("#e-con").value,
      saturation: +$("#e-sat").value, warmth: +$("#e-war").value,
    },
    smooth: $("#e-smooth").value,
    voiceClean: $("#e-voice").value,
    punch: $("#e-punch").checked,
    shake: $("#e-shake").checked,
    flash: $("#e-flash").checked,
    film: $("#e-film").checked,
    progress: $("#e-prog").checked,
    sfx: $("#e-sfx").checked,
    brollTransition: $("#e-trans").value,
    aiBroll: $("#e-aibroll").checked,
    aiBrollCount: parseInt($("#e-aicount").value, 10) || 6,
    brollFolder: $("#e-broll").value.trim() || null,
    brollFill: $("#e-brollfill").value,
    logoPath: $("#e-logo").value.trim() || null,
    logoPos: $("#e-logopos").value,
    logoScale: (parseInt($("#e-logosize").value, 10) || 16) / 100,
    musicPath: $("#e-music").value.trim() || null,
    ...publishBody("e"),
  };
  confirmLark("e"); body.postLark = $("#e-mklark") ? $("#e-mklark").checked : false;
  const r = await fetch("/api/edit", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());
  if (r.error) { $("#btn-edit").disabled = false; return alert(r.error); }
  pollJob(r.jobId, (j) => {
    $("#btn-edit").disabled = false;
    if (j.status === "error") return alert(j.error);
    const out = j.result.outPath;
    const url = "/api/file?path=" + encodeURIComponent(out);
    $("#edit-out").innerHTML = `
      <div class="result-video">
        <h3>✅ Bản viral đã xong (${j.result.meta.width}x${j.result.meta.height}, ${j.result.meta.duration.toFixed(0)}s)</h3>
        <video src="${url}" controls></video><br>
        <a class="dl" href="/api/file?dl=1&path=${encodeURIComponent(out)}" download>⬇ Tải video</a>
        <div class="muted" style="font-size:12px;margin-top:8px">${out}</div>
        ${publishHtml(j.result)}
      </div>`;
  });
});

// ================= BÓC Ý TƯỞNG =================
$("#btn-extract").addEventListener("click", async () => {
  const url = $("#ex-url").value.trim();
  const file = $("#ex-path").value.trim();
  if (!url && !file) return alert("Dán link hoặc đường dẫn video.");
  $("#btn-extract").disabled = true; $("#extract-out").innerHTML = "";
  const r = await fetch("/api/extract", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url || null, path: file || null, deep: $("#ex-deep").checked }),
  }).then((r) => r.json());
  if (r.error) { $("#btn-extract").disabled = false; return alert(r.error); }
  pollJob(r.jobId, (j) => {
    $("#btn-extract").disabled = false;
    if (j.status === "error") return alert(j.error);
    const d = j.result;
    const beats = (d.beats || []).map((b) => `<div class="beat"><b>${b.t}s</b><span>${b.text}</span></div>`).join("");
    $("#extract-out").innerHTML = `
      <div class="scorecard">
        <h3>🔎 Công thức video (${d.structure.durationSec}s · ${d.structure.cutsPerMin} cắt/phút · ${d.structure.wpm ?? "?"} từ/phút)</h3>
        <div style="margin:10px 0"><b>HOOK:</b> <span style="color:#ffd7c9">"${d.hook}"</span></div>
        ${d.aiAnalysis ? `<div class="ai"><b>🤖 Công thức bóc bằng AI:</b>\n\n${d.aiAnalysis}</div>` : ""}
        <details style="margin-top:14px" open><summary class="muted">Cấu trúc theo mốc giây</summary>${beats}</details>
        ${d.transcript ? `<details style="margin-top:10px"><summary class="muted">Transcript đầy đủ</summary><p style="font-size:13px">${d.transcript}</p></details>` : ""}
      </div>`;
  });
});

// ================= HÀNG LOẠT =================
$("#btn-batch").addEventListener("click", async () => {
  const folder = $("#b-folder").value.trim();
  if (!folder) return alert("Dán đường dẫn thư mục chứa video.");
  $("#btn-batch").disabled = true; $("#batch-out").innerHTML = "";
  const body = {
    folder, mode: $("#b-mode").value,
    doCutSilence: $("#b-cut").checked, doCaptions: $("#b-cap").checked, normalize: $("#b-norm").checked,
  };
  const r = await fetch("/api/batch", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());
  if (r.error) { $("#btn-batch").disabled = false; return alert(r.error); }
  pollJob(r.jobId, (j) => {
    $("#btn-batch").disabled = false;
    if (j.status === "error") return alert(j.error);
    const res = j.result;
    let rows;
    if (res.mode === "edit") {
      rows = res.results.map((x) => `<tr><td>${x.file.split(/[\\/]/).pop()}</td><td>${x.error ? "❌ " + x.error : `<a class="dl" href="/api/file?dl=1&path=${encodeURIComponent(x.outPath)}" download>⬇ tải</a>`}</td></tr>`).join("");
      $("#batch-out").innerHTML = `<div class="scorecard"><h3>📦 Đã biên tập ${res.count} video</h3>
        <table class="batch-tbl"><tr><th>File</th><th>Kết quả</th></tr>${rows}</table></div>`;
    } else {
      rows = res.results.map((x) => `<tr><td>${x.file.split(/[\\/]/).pop()}</td><td style="color:${x.error ? "var(--acc)" : scoreColor(x.overall)};font-weight:700">${x.error ? "❌" : x.overall}</td><td>${x.error ? x.error : x.verdict}</td></tr>`).join("");
      $("#batch-out").innerHTML = `<div class="scorecard"><h3>📦 Đã chấm ${res.count} video</h3>
        <table class="batch-tbl"><tr><th>File</th><th>Điểm</th><th>Nhận định</th></tr>${rows}</table></div>`;
    }
  });
});

// ================= 🎬 VIDEO DÀI YOUTUBE =================
async function longAddFiles(files) {
  const ta = $("#long-paths");
  for (const f of files) {
    try { showLog("Tải lên: " + f.name); const pth = await uploadFile(f); ta.value += (ta.value.trim() ? "\n" : "") + pth; }
    catch (e) { alert(e.message); }
  }
  setLog(["✔ Đã thêm " + files.length + " video vào danh sách ghép"]);
}
$("#file-long").addEventListener("change", (e) => { if (e.target.files.length) longAddFiles([...e.target.files]); });
(function () {
  const dz = $("#dz-long"); if (!dz) return;
  ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) longAddFiles([...e.dataTransfer.files]); });
})();
$("#l-mv").addEventListener("input", (e) => { $("#l-mvval").textContent = e.target.value; });
async function runLong() {
  const paths = $("#long-paths").value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!paths.length) return alert("Thêm ít nhất 1 video (kéo-thả nhiều file, chọn file, hoặc dán đường dẫn — mỗi dòng 1 video).");
  saveProject("vss-long", LONG_FIELDS);
  $("#btn-long").disabled = true; $("#long-out").innerHTML = "";
  const body = {
    paths,
    removeFillers: $("#l-fillers").checked,
    doCutSilence: $("#l-cut").checked,
    doCaptions: $("#l-cap").checked,
    captionStyle: $("#l-capstyle").value,
    reframe: $("#l-reframe").value,
    model: $("#l-model").value,
    colorLevel: $("#l-color").value,
    smooth: $("#l-smooth").value,
    voiceClean: $("#l-voice").value,
    film: $("#l-film").checked,
    normalize: $("#l-norm").checked,
    musicPath: $("#l-music").value.trim() || null,
    musicVol: (parseInt($("#l-mv").value, 10) || 14) / 100,
    transition: $("#l-trans").value,
    introPath: $("#l-intro").value.trim() || null,
    outroPath: $("#l-outro").value.trim() || null,
    aspect: $("#l-aspect").value,
    titleTop: $("#l-ttop").value.trim(),
    titleBottom: $("#l-tbot").value.trim(),
    smartPrune: $("#l-smart").checked,
    brollFolder: $("#l-broll").value.trim() || null,
    brollFill: $("#l-brollfill").value,
    makeThumb: $("#l-thumb").checked,
    thumbPhotoDir: $("#l-thumbdir").value.trim() || (VSS_CFG.brand && VSS_CFG.brand.thumbPhotoDir) || null,
    thumbTitle: $("#l-thumbtitle").value.trim(),
    thumbName: $("#l-thumbname").value.trim() || (VSS_CFG.brand && VSS_CFG.brand.name) || "",
    makeContent: $("#l-mkcontent") ? $("#l-mkcontent").checked : true,
    postLark: $("#l-mklark") ? $("#l-mklark").checked : false,
    maxMinutes: parseInt($("#l-maxmin").value, 10) || 10,
  };
  confirmLark("l"); body.postLark = $("#l-mklark") ? $("#l-mklark").checked : false;
  const r = await fetch("/api/longedit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  if (r.error) { $("#btn-long").disabled = false; return alert(r.error); }
  pollJob(r.jobId, (j) => {
    $("#btn-long").disabled = false;
    if (j.status === "error") return alert(j.error);
    const parts = (j.result && j.result.parts) || [];
    const cards = parts.map((p, i) => {
      const url = "/api/file?path=" + encodeURIComponent(p.outPath);
      const thumb = p.thumbPath ? "/api/file?path=" + encodeURIComponent(p.thumbPath) : null;
      return `<div class="clip-card" style="max-width:420px">
        <video src="${url}" controls style="width:100%;aspect-ratio:${j.result.aspect === "1:1" ? "1/1" : "16/9"};background:#000"></video>
        <div class="clip-body">
          <div class="clip-top"><b>${parts.length > 1 ? "Phần " + (i + 1) : "Video dài"}</b> · ${p.meta.width}x${p.meta.height} · ${Math.round(p.meta.duration)}s</div>
          <div class="clip-dls">
            <a class="dl" href="/api/file?dl=1&path=${encodeURIComponent(p.outPath)}" download>⬇ Tải video</a>
          </div>
          ${publishHtml(p)}
        </div></div>`;
    }).join("");
    $("#long-out").innerHTML = `<div class="scorecard"><h3>✅ Đã xong ${parts.length > 1 ? parts.length + " phần" : "video dài"} (${j.result.aspect})</h3>
      <div class="clip-grid">${cards}</div></div>`;
  });
}
$("#btn-long").addEventListener("click", runLong);
wireUpload("file-lmusic", "l-music");
wireUpload("file-lintro", "l-intro");
wireUpload("file-loutro", "l-outro");

// ================= 🎙️ SHORT LỒNG VOICE =================
async function voiceAddClips(files) {
  const ta = $("#voice-clips");
  for (const f of files) { try { showLog("Tải lên: " + f.name); const pth = await uploadFile(f); ta.value += (ta.value.trim() ? "\n" : "") + pth; } catch (e) { alert(e.message); } }
  setLog(["✔ Đã thêm " + files.length + " clip bối cảnh"]);
}
$("#file-voiceclips").addEventListener("change", (e) => { if (e.target.files.length) voiceAddClips([...e.target.files]); });
(function () {
  const dz = $("#dz-voice"); if (!dz) return;
  ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => { if (e.dataTransfer.files.length) voiceAddClips([...e.dataTransfer.files]); });
})();
wireUpload("file-voice", "voice-audio");
wireUpload("file-voicemusic", "voice-music");

// Preset phong cách — 1 bấm cấu hình theo kiểu video mẫu.
function applyVoicePreset(name) {
  const set = (id, v) => { const e = $("#" + id); if (e) { if (e.type === "checkbox") e.checked = v; else e.value = v; e.dispatchEvent(new Event("input")); } };
  if (name === "cinematic") {
    // 🎬 Kể chuyện điện ảnh như video mẫu FB: màu nhẹ tự nhiên, KHÔNG phụ đề/hook, cắt mượt, nhạc êm.
    set("voice-color", "low"); set("voice-smooth", "off"); set("voice-film", false);
    set("voice-cap", false); set("voice-prog", false); set("voice-hook", "");
    set("voice-trans", "cut"); set("voice-mv", 10); set("voice-vv", 100);
  } else if (name === "viral") {
    // ⚡ Viral năng động: phụ đề karaoke, màu đậm, vignette, hook (tự điền), nhạc rõ hơn.
    set("voice-color", "high"); set("voice-smooth", "medium"); set("voice-film", true);
    set("voice-cap", true); set("voice-capstyle", "karaoke"); set("voice-prog", true);
    set("voice-trans", "fade"); set("voice-mv", 15); set("voice-vv", 100);
  }
}
$("#voice-preset").addEventListener("change", (e) => applyVoicePreset(e.target.value));
applyVoicePreset("cinematic"); // mặc định theo video mẫu
$("#voice-vv").addEventListener("input", (e) => { $("#voice-vvval").textContent = e.target.value; });
$("#voice-mv").addEventListener("input", (e) => { $("#voice-mvval").textContent = e.target.value; });
async function runVoice() {
  const clips = $("#voice-clips").value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const voicePath = $("#voice-audio").value.trim();
  if (!clips.length) return alert("Thêm ít nhất 1 clip bối cảnh.");
  if (!voicePath) return alert("Chọn file giọng đọc (voice-over).");
  saveProject("vss-voice", VOICE_FIELDS);
  $("#btn-voice").disabled = true; $("#voice-out").innerHTML = "";
  const body = {
    clips, voicePath,
    voiceVol: (parseInt($("#voice-vv").value, 10) || 100) / 100,
    musicPath: $("#voice-music").value.trim() || null,
    musicVol: (parseInt($("#voice-mv").value, 10) || 12) / 100,
    colorLevel: $("#voice-color").value,
    smooth: $("#voice-smooth").value,
    film: $("#voice-film").checked,
    doCaptions: $("#voice-cap").checked,
    captionStyle: $("#voice-capstyle").value,
    progress: $("#voice-prog").checked,
    hookText: $("#voice-hook").value.trim() || null,
    brollFolder: $("#voice-broll").value.trim() || null,
    brollFill: $("#voice-brollfill").value,
    transition: $("#voice-trans").value,
    ...publishBody("voice"),
  };
  confirmLark("voice"); body.postLark = $("#voice-mklark") ? $("#voice-mklark").checked : false;
  const r = await fetch("/api/voiceshort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  if (r.error) { $("#btn-voice").disabled = false; return alert(r.error); }
  pollJob(r.jobId, (j) => {
    $("#btn-voice").disabled = false;
    if (j.status === "error") return alert(j.error);
    const out = j.result.outPath, url = "/api/file?path=" + encodeURIComponent(out);
    $("#voice-out").innerHTML = `<div class="result-video"><h3>✅ Short lồng voice đã xong (${j.result.meta.width}x${j.result.meta.height}, ${Math.round(j.result.meta.duration)}s)</h3>
      <video src="${url}" controls style="max-width:300px;width:100%"></video><br>
      <a class="dl" href="/api/file?dl=1&path=${encodeURIComponent(out)}" download>⬇ Tải video</a>
      <div class="muted" style="font-size:12px;margin-top:8px">${out}</div>
      ${publishHtml(j.result)}</div>`;
  });
}
$("#btn-voice").addEventListener("click", runVoice);

// ================= 💾 LƯU / MỞ LẠI PROJECT (2 mode mới) =================
// Nhớ thiết lập + đường dẫn input để chỉnh lại KHÔNG phải nhập lại; kèm nút "Dựng lại (giữ phân tích)".
// Nhờ cache Whisper + Claude, chạy lại cùng nguồn = bỏ qua gõ chữ + 0 token, chỉ render lại.
const LONG_FIELDS = ["long-paths", "l-aspect", "l-reframe", "l-smart", "l-fillers", "l-cut", "l-cap", "l-capstyle",
  "l-model", "l-maxmin", "l-ttop", "l-tbot", "l-broll", "l-brollfill", "l-thumb", "l-thumbdir", "l-thumbtitle",
  "l-thumbname", "l-color", "l-smooth", "l-voice", "l-film", "l-norm", "l-music", "l-mv", "l-trans", "l-intro", "l-outro",
  "l-mkcontent", "l-mklark"];
const VOICE_FIELDS = ["voice-clips", "voice-preset", "voice-audio", "voice-vv", "voice-broll", "voice-brollfill",
  "voice-trans", "voice-color", "voice-smooth", "voice-cap", "voice-capstyle", "voice-film", "voice-prog",
  "voice-hook", "voice-music", "voice-mv", "voice-mkthumb", "voice-mkcontent", "voice-mklark"];
const AC_FIELDS = ["path-ac", "url-ac", "ac-broll", "ac-brollfill", "ac-cta", "ac-logo", "ac-music", "ac-mv",
  "ac-thumbbrand", "ac-thumbdir", "ac-thumbname", "ac-model", "ac-score", "ac-max", "ac-trans", "ac-reframe",
  "ac-smooth", "ac-voice", "ac-hook", "ac-film", "ac-prog", "ac-thumb", "ac-scoreclip", "ac-autolark"];
function saveProject(key, ids) {
  const data = {};
  ids.forEach((id) => { const e = $("#" + id); if (e) data[id] = e.type === "checkbox" ? e.checked : e.value; });
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* ignore */ }
}
function loadProject(key, ids, announce) {
  let data; try { data = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { data = null; }
  if (!data) { if (announce) alert("Chưa có project nào được lưu cho mục này."); return false; }
  ids.forEach((id) => {
    if (data[id] == null) return; const e = $("#" + id); if (!e) return;
    if (e.type === "checkbox") e.checked = data[id]; else e.value = data[id];
    e.dispatchEvent(new Event("input"));
  });
  if (announce) setLog(["📂 Đã mở lại project — chỉnh thiết lập rồi bấm Dựng lại (giữ phân tích, 0 token)."]);
  return true;
}
// Khôi phục project gần nhất khi mở app (sau khi preset mặc định đã chạy)
loadProject("vss-ac", AC_FIELDS);
loadProject("vss-long", LONG_FIELDS);
loadProject("vss-voice", VOICE_FIELDS);
// Nút Lưu / Mở lại / Dựng lại cho mỗi mode
function wireProjectBtns(mode, key, fields, runFn) {
  const s = $("#" + mode + "-save"), o = $("#" + mode + "-open"), r = $("#" + mode + "-rerun");
  if (s) s.addEventListener("click", () => { saveProject(key, fields); setLog(["💾 Đã lưu project."]); });
  if (o) o.addEventListener("click", () => loadProject(key, fields, true));
  if (r) r.addEventListener("click", runFn);
}
wireProjectBtns("ac", "vss-ac", AC_FIELDS, () => $("#btn-ac").click());
wireProjectBtns("long", "vss-long", LONG_FIELDS, runLong);
wireProjectBtns("voice", "vss-voice", VOICE_FIELDS, runVoice);

// ================= UPLOAD nhạc/logo + thanh trượt =================
// Nút chọn file → upload lên server → điền đường dẫn vào ô tương ứng.
function wireUpload(fileInputId, targetInputId) {
  const fi = $("#" + fileInputId); const ti = $("#" + targetInputId);
  if (!fi || !ti) return;
  fi.addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    ti.value = "Đang tải lên…";
    try { ti.value = await uploadFile(f); } catch (err) { ti.value = ""; alert(err.message); }
  });
}
wireUpload("file-music", "e-music");
wireUpload("file-logo", "e-logo");
wireUpload("file-acmusic", "ac-music");

// Nhãn thanh trượt cập nhật trực tiếp.
[["e-bri", "e-brival"], ["e-con", "e-conval"], ["e-sat", "e-satval"], ["e-war", "e-warval"], ["e-logosize", "e-logosizeval"]]
  .forEach(([sl, lb]) => { const s = $("#" + sl), l = $("#" + lb); if (s && l) s.addEventListener("input", () => { l.textContent = s.value; }); });

// ================= ⚙️ TAB CẤU HÌNH (Lark Base + Thương hiệu) =================
(function wireConfig() {
  const probeStatus = $("#cfg-probe-status");
  let PROBE = { baseToken: "", tableId: "", tables: [], fields: [] };

  // Đổ options vào 1 <select>. useName=true → value là TÊN cột (cho record-upsert theo tên);
  // false → value là FIELD ID (cho upload đính kèm). allowBlank → thêm dòng "— không dùng —".
  function fillFieldSelect(sel, fields, { useName = false, allowBlank = false, selected = "" } = {}) {
    if (!sel) return;
    const opts = [];
    if (allowBlank) opts.push(`<option value="">— không dùng —</option>`);
    for (const f of fields) {
      const val = useName ? (f.name || "") : (f.id || "");
      const lbl = esc(f.name || f.id) + (f.type ? ` (${f.type})` : "");
      opts.push(`<option value="${esc(val)}"${val === selected ? " selected" : ""}>${lbl}</option>`);
    }
    sel.innerHTML = opts.join("");
  }

  // Nạp danh sách cột của bảng đang chọn → đổ vào 5 ô map + set lại theo cấu hình đã lưu.
  async function loadFields(saved = {}) {
    const baseToken = PROBE.baseToken;
    const tableId = $("#cfg-table") ? $("#cfg-table").value : "";
    if (!baseToken || !tableId) return;
    probeStatus.textContent = "⏳ đang nạp cột…";
    try {
      const r = await fetch("/api/lark/probe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseToken, tableId }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "không đọc được cột");
      PROBE.fields = r.fields || [];
      if (!PROBE.fields.length) { probeStatus.textContent = "⚠ bảng không có cột (hoặc thiếu quyền)"; return; }
      // attach/thumb dùng FIELD ID; content/loai/fanpage dùng TÊN cột.
      fillFieldSelect($("#cfg-f-attach"), PROBE.fields, { useName: false, selected: saved.attachField || "" });
      fillFieldSelect($("#cfg-f-thumb"), PROBE.fields, { useName: false, allowBlank: true, selected: saved.thumbField || "" });
      fillFieldSelect($("#cfg-f-content"), PROBE.fields, { useName: true, selected: saved.contentField || "" });
      fillFieldSelect($("#cfg-f-loai"), PROBE.fields, { useName: true, allowBlank: true, selected: saved.typeField || "" });
      fillFieldSelect($("#cfg-f-fanpage"), PROBE.fields, { useName: true, allowBlank: true, selected: saved.fanpageField || "" });
      $("#cfg-fields").style.display = "";
      probeStatus.textContent = `✅ ${PROBE.fields.length} cột — chọn cột rồi bấm Lưu`;
    } catch (e) { probeStatus.textContent = "⚠ " + e.message; }
  }

  // Dò bảng: dán link → liệt kê bảng của Base.
  async function probe(saved = {}) {
    const link = $("#cfg-lark-link").value.trim();
    if (!link) { probeStatus.textContent = "⚠ dán link Base trước"; return; }
    probeStatus.textContent = "⏳ đang dò bảng…";
    try {
      const r = await fetch("/api/lark/probe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseLink: link }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "không đọc được Base");
      PROBE.baseToken = r.baseToken; PROBE.tables = r.tables || [];
      const tsel = $("#cfg-table");
      tsel.innerHTML = PROBE.tables.map((t) =>
        `<option value="${esc(t.id)}"${t.id === (saved.tableId || r.tableId) ? " selected" : ""}>${esc(t.name)}</option>`).join("");
      $("#cfg-map").style.display = "";
      probeStatus.textContent = `✅ ${PROBE.tables.length} bảng — chọn bảng rồi nạp cột`;
      // Nếu link đã có ?table= hoặc đã lưu bảng → tự nạp cột luôn.
      if (r.tableId || saved.tableId) { if (r.tableId) tsel.value = saved.tableId || r.tableId; await loadFields(saved); }
    } catch (e) { probeStatus.textContent = "⚠ " + e.message; }
  }

  if ($("#cfg-probe")) $("#cfg-probe").addEventListener("click", () => probe());
  if ($("#cfg-loadfields")) $("#cfg-loadfields").addEventListener("click", () => loadFields());
  if ($("#cfg-table")) $("#cfg-table").addEventListener("change", () => { $("#cfg-fields").style.display = "none"; });

  // Lưu cấu hình Lark.
  if ($("#cfg-save-lark")) $("#cfg-save-lark").addEventListener("click", async () => {
    const st = $("#cfg-lark-savestatus");
    const attach = $("#cfg-f-attach") ? $("#cfg-f-attach").value : "";
    if (!PROBE.baseToken || !($("#cfg-table") && $("#cfg-table").value) || !attach) {
      st.textContent = "⚠ cần: dò bảng → chọn bảng → chọn cột đính kèm video"; return;
    }
    const lark = {
      baseToken: PROBE.baseToken,
      tableId: $("#cfg-table").value,
      attachField: attach,
      thumbField: $("#cfg-f-thumb").value || "",
      contentField: $("#cfg-f-content").value || "Nội dung",
      typeField: $("#cfg-f-loai").value || "",
      typeValue: $("#cfg-loai-value").value.trim() || "Video",
      fanpageField: $("#cfg-f-fanpage").value || "",
      fanpageRec: $("#cfg-fanpage-rec").value.trim() || "",
    };
    st.textContent = "⏳ đang lưu…";
    try {
      const r = await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lark }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "lưu lỗi");
      st.textContent = "✅ Đã lưu — đăng Lark đã sẵn sàng";
      refreshLarkState();
    } catch (e) { st.textContent = "⚠ " + e.message; }
  });

  // Lưu Thương hiệu / Thumbnail.
  if ($("#cfg-save-brand")) $("#cfg-save-brand").addEventListener("click", async () => {
    const st = $("#cfg-brand-savestatus");
    const brand = {
      name: $("#cfg-brand-name").value.trim(),
      niche: $("#cfg-brand-niche").value.trim(),
      color: $("#cfg-brand-color").value,
      system: $("#cfg-brand-system").value.trim(),
      thumbPhotoDir: $("#cfg-brand-thumbdir").value.trim(),
    };
    st.textContent = "⏳ đang lưu…";
    try {
      const r = await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || "lưu lỗi");
      st.textContent = "✅ Đã lưu — áp dụng ngay cho video/caption mới";
      // Cập nhật vào VSS_CFG + các ô thumbnail đang dùng trong các tab.
      if (VSS_CFG.brand) Object.assign(VSS_CFG.brand, brand);
      if (brand.system && $("#brand-sub")) $("#brand-sub").textContent = `${brand.system} — cắt · biên tập · thumbnail`;
    } catch (e) { st.textContent = "⚠ " + e.message; }
  });

  function refreshLarkState() {
    const el = $("#cfg-lark-state"); if (!el) return;
    fetch("/api/config").then((r) => r.json()).then((cfg) => {
      const s = (cfg && cfg.lark) || {};
      el.textContent = s.ready
        ? `✅ Đã kết nối (base ${String(s.base).slice(0, 8)}… · bảng ${String(s.table).slice(0, 8)}…)`
        : "⛔ Chưa cấu hình — dán link Base bên dưới để bật đăng Lark";
      el.style.color = s.ready ? "#1a7f37" : "";
    }).catch(() => { el.textContent = "?"; });
  }

  // Nạp cấu hình đã lưu vào form khi mở app.
  fetch("/api/settings").then((r) => r.json()).then((s) => {
    const b = s.brand || {}, lk = s.lark || {};
    const setV = (id, v) => { const e = $("#" + id); if (e && v != null && v !== "") e.value = v; };
    setV("cfg-brand-name", b.name); setV("cfg-brand-niche", b.niche);
    setV("cfg-brand-system", b.system); setV("cfg-brand-thumbdir", b.thumbPhotoDir);
    if (b.color && $("#cfg-brand-color")) $("#cfg-brand-color").value = b.color;
    setV("cfg-loai-value", lk.typeValue); setV("cfg-fanpage-rec", lk.fanpageRec);
    // Nếu đã cấu hình Lark → dựng lại link + tự dò để hiện lại lựa chọn cột đã lưu.
    if (lk.baseToken) {
      $("#cfg-lark-link").value = "https://open.larksuite.com/base/" + lk.baseToken + (lk.tableId ? "?table=" + lk.tableId : "");
      probe(lk).catch(() => {});
    }
    refreshLarkState();
  }).catch(() => {});
})();

// ================= 🔊 VĂN BẢN → GIỌNG AI (dùng chung cho MỌI tab cần voice) =================
// Gõ/dán văn bản → tạo giọng AI (edge-tts, miễn phí) → tự điền vào ô voice của tab đó.
// onVoice(path) được gọi sau khi tạo xong; nghe thử ngay tại chỗ.
let TTS_VOICE_LIST = [
  { id: "vi-VN-HoaiMyNeural", label: "Hoài My (nữ, thân thiện)" },
  { id: "vi-VN-NamMinhNeural", label: "Nam Minh (nam, thân thiện)" },
];
fetch("/api/tts/voices").then((r) => r.json()).then((j) => { if (j.voices && j.voices.length) TTS_VOICE_LIST = j.voices; }).catch(() => {});

function makeTtsBox(onVoice, { placeholder = "Dán kịch bản/lời thoại ở đây → bấm Tạo giọng AI" } = {}) {
  const box = document.createElement("div");
  box.className = "ttsbox";
  box.innerHTML = `
    <div class="tts-h">🔊 <b>Không có voice? Gõ văn bản → Giọng AI đọc</b>
      <span class="muted" style="font-weight:400"> (miễn phí · cần internet)</span></div>
    <textarea class="tts-text pathbox" rows="3" placeholder="${placeholder}"></textarea>
    <div class="tts-row">
      <label>Giọng: <select class="tts-voice"></select></label>
      <label>Tốc độ <b class="tts-ratelab">0</b>%
        <input type="range" class="tts-rate" min="-40" max="60" value="0" style="width:110px">
      </label>
      <label>Cao độ <b class="tts-pitchlab">0</b>Hz
        <input type="range" class="tts-pitch" min="-30" max="30" value="0" style="width:110px">
      </label>
      <button class="dl tts-go">🔊 Tạo giọng AI</button>
      <span class="tts-status muted"></span>
    </div>
    <audio class="tts-prev" controls style="width:100%;display:none;margin-top:6px"></audio>`;

  const sel = box.querySelector(".tts-voice");
  const fill = () => { sel.innerHTML = TTS_VOICE_LIST.map((v) => `<option value="${v.id}">${v.label}</option>`).join(""); };
  fill();
  // nạp lại khi danh sách giọng về sau
  setTimeout(fill, 1200);

  const rate = box.querySelector(".tts-rate"), pitch = box.querySelector(".tts-pitch");
  rate.addEventListener("input", () => { box.querySelector(".tts-ratelab").textContent = rate.value; });
  pitch.addEventListener("input", () => { box.querySelector(".tts-pitchlab").textContent = pitch.value; });

  box.querySelector(".tts-go").addEventListener("click", async () => {
    const text = box.querySelector(".tts-text").value.trim();
    const status = box.querySelector(".tts-status");
    if (!text) return alert("Chị gõ/dán văn bản cần đọc trước nhé.");
    const btn = box.querySelector(".tts-go");
    btn.disabled = true; status.textContent = "⏳ đang tạo giọng AI…";
    try {
      const r = await fetch("/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: sel.value, rate: +rate.value, pitch: +pitch.value }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      await new Promise((resolve, reject) => pollJob(r.jobId, (j) => {
        if (j.status === "error") return reject(new Error(j.error));
        const res = j.result;
        const a = box.querySelector(".tts-prev");
        a.src = "/api/file?path=" + encodeURIComponent(res.path) + "&t=" + Date.now();
        a.style.display = "block";
        status.textContent = `✔ xong (${(res.duration || 0).toFixed(1)}s) — đã điền vào ô giọng`;
        onVoice(res.path, res);
        resolve();
      }));
    } catch (err) { status.textContent = "❌ " + err.message; alert(err.message); }
    finally { btn.disabled = false; }
  });
  return box;
}

// Gắn khối TTS vào 1 vùng theo id.
function injectTts(hostId, onVoice, opts) {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.appendChild(makeTtsBox(onVoice, opts));
}

// ================= 🛋️ NỘI THẤT CHO CON =================
let intVideoPath = null, intVoicePath = null, intLastResult = null;

(function wireInterior() {
  if (!$("#btn-interior")) return;
  // Nhãn thanh trượt
  const bindLab = (id, lab) => { const e = $("#" + id); if (e) e.addEventListener("input", () => { $("#" + lab).textContent = e.value; }); };
  bindLab("int-pitch", "int-pitchval"); bindLab("int-vv", "int-vvval"); bindLab("int-logosize", "int-logosizeval");

  // Chọn file giọng (audio hoặc video có tiếng)
  $("#int-voicefile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    showLog("Tải giọng…");
    try {
      intVoicePath = await uploadFile(f); $("#int-voice").value = intVoicePath;
      const a = $("#int-voice-preview"); a.src = URL.createObjectURL(f); a.style.display = "block";
      $("#int-rec-status").textContent = "đã chọn: " + f.name;
    } catch (err) { alert(err.message); }
  });

  // Chọn logo
  $("#int-logofile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { $("#int-logo").value = await uploadFile(f); setLog(["✔ Logo: " + f.name]); } catch (err) { alert(err.message); }
  });

  // 🔴 Ghi âm trực tiếp bằng micro (MediaRecorder)
  let rec = null, chunks = [];
  $("#int-rec").addEventListener("click", async () => {
    const btn = $("#int-rec"), st = $("#int-rec-status");
    if (rec && rec.state === "recording") { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = (chunks[0] && chunks[0].type) || "audio/webm";
        const blob = new Blob(chunks, { type });
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], "ghi-am-" + Date.now() + "." + ext, { type });
        const a = $("#int-voice-preview"); a.src = URL.createObjectURL(blob); a.style.display = "block";
        st.textContent = "⏳ đang tải bản ghi…";
        try { intVoicePath = await uploadFile(file); $("#int-voice").value = intVoicePath; st.textContent = "✔ đã ghi & tải giọng"; }
        catch (err) { st.textContent = "❌ " + err.message; }
        btn.textContent = "🔴 Ghi âm"; btn.classList.remove("recording");
      };
      rec.start();
      btn.textContent = "⏹ Dừng ghi"; btn.classList.add("recording");
      st.textContent = "🔴 đang ghi… bấm Dừng để xong";
    } catch (err) { alert("Không truy cập được micro: " + err.message); }
  });

  function buildBody() {
    return {
      path: $("#int-path").value.trim() || intVideoPath,
      voicePath: $("#int-voice").value.trim() || intVoicePath || null,
      voiceMode: $("#int-voicemode").value,
      voiceVol: (+$("#int-vv").value) / 100,
      voiceTone: $("#int-tone").value,
      voicePitch: +$("#int-pitch").value,
      voiceSpeed: +$("#int-vspeed").value,
      voiceClean: $("#int-voiceclean").value,
      flip: $("#int-flip").checked,
      videoSpeed: +$("#int-speed").value,
      aspect: $("#int-aspect").value,
      colorLevel: $("#int-color").value,
      smooth: $("#int-smooth").value,
      cutFillers: $("#int-cutfillers").checked,
      doCaptions: $("#int-cap").checked,
      captionStyle: $("#int-capstyle").value,
      keywords: $("#int-keywords").value.trim(),
      hookText: $("#int-hook").value.trim() || null,
      overlayText: $("#int-overlay").value.trim() || null,
      overlayPos: $("#int-overlaypos").value,
      logoPath: $("#int-logo").value.trim() || null,
      logoPos: $("#int-logopos").value,
      logoScale: (+$("#int-logosize").value) / 100,
      normalize: $("#int-norm").checked,
      makeThumb: $("#int-mkthumb").checked,
      makeContent: $("#int-mkcontent").checked,
      postLark: $("#int-mklark").checked,
    };
  }

  async function run(extra) {
    const body = Object.assign(buildBody(), extra || {});
    if (!body.path) return alert("Chưa có video thô — kéo-thả, chọn file, hoặc dán đường dẫn ở ô ①.");
    if (body.postLark && !extra && !confirm("Sau khi dựng xong, tự đăng video lên Lark Base?\n\nBấm Huỷ để chỉ dựng, đăng tay sau.")) {
      $("#int-mklark").checked = false; body.postLark = false;
    }
    $("#btn-interior").disabled = true; if (!extra) $("#interior-out").innerHTML = "";
    try {
      const r = await fetch("/api/interior", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      await new Promise((resolve, reject) => pollJob(r.jobId, (j) => {
        if (j.status === "error") return reject(new Error(j.error));
        renderResult(j.result); resolve();
      }));
    } catch (err) { alert(err.message); }
    finally { $("#btn-interior").disabled = false; }
  }
  $("#btn-interior").addEventListener("click", () => run());

  function renderResult(res) {
    intLastResult = res;
    const url = "/api/file?path=" + encodeURIComponent(res.outPath) + "&t=" + Date.now();
    const subText = (res.segments || []).map((s) => s.text).join("\n");
    $("#interior-out").innerHTML = `
      <div class="result-video">
        <video src="${url}" controls preload="metadata"></video>
        <div style="margin-top:8px">
          <a class="dl" href="/api/file?dl=1&path=${encodeURIComponent(res.outPath)}" download>⬇ Tải video</a>
        </div>
        <div class="optgroup" style="margin-top:12px;flex:1 1 100%">
          <div class="optgroup-h">✍️ Sửa phụ đề rồi dựng lại (mỗi dòng = 1 câu; để trống dòng = ẩn câu đó)</div>
          <textarea class="pathbox" id="int-subedit" rows="5" spellcheck="false">${esc(subText)}</textarea>
          <button class="dl" id="int-resub">🔁 Dựng lại (áp phụ đề đã sửa)</button>
          <span class="muted" id="int-resub-status" style="font-size:12px;margin-left:8px"></span>
        </div>
        ${publishHtml(res)}
      </div>`;
    const rb = $("#int-resub");
    if (rb) rb.addEventListener("click", async () => {
      const lines = $("#int-subedit").value.split("\n").map((s) => s.trim());
      $("#int-resub-status").textContent = "⏳ đang dựng lại…";
      await run({ editedSegments: lines });
    });
  }
})();

// ================= 🔊 GẮN KHỐI "VĂN BẢN → GIỌNG AI" VÀO MỌI TAB CẦN VOICE =================
(function wireTtsEverywhere() {
  // 🛋️ Nội thất cho con → điền thẳng vào ô giọng của tab.
  injectTts("int-tts-mount", (p) => {
    intVoicePath = p;
    const el = $("#int-voice"); if (el) el.value = p;
    const st = $("#int-rec-status"); if (st) st.textContent = "✔ đang dùng giọng AI";
  }, { placeholder: "VD: Nội thất cho con mang lại không gian ấm áp và an toàn cho bé…" });

  // 🎙️ Short lồng voice → điền vào ô giọng đọc (bắt buộc của tab này).
  injectTts("voice-tts-mount", (p) => {
    const el = $("#voice-audio"); if (el) el.value = p;
  }, { placeholder: "Dán kịch bản kể chuyện → AI đọc thành voice-over…" });

  // 🔊 Tab Giọng AI độc lập → hiện đường dẫn để chị copy dùng cho tab bất kỳ.
  injectTts("tts-mount", (p, res) => {
    $("#tts-out").innerHTML = `
      <div class="pub-box">
        <div class="pub-title">✅ Đã tạo giọng AI (${(res.duration || 0).toFixed(1)}s)</div>
        <div class="muted" style="font-size:12px;margin:4px 0">Copy đường dẫn này dán vào ô giọng của tab bất kỳ:</div>
        <input class="pathbox sm wide" id="tts-path" readonly value="${p.replace(/"/g, "&quot;")}">
        <div style="margin-top:6px">
          <button class="dl" id="tts-copy">📋 Copy đường dẫn</button>
          <a class="dl" href="/api/file?dl=1&path=${encodeURIComponent(p)}" download>⬇ Tải file giọng</a>
        </div>
      </div>`;
    const cp = $("#tts-copy");
    if (cp) cp.addEventListener("click", () => {
      const inp = $("#tts-path"); inp.select();
      navigator.clipboard.writeText(inp.value).then(
        () => { cp.textContent = "✔ Đã copy"; setTimeout(() => (cp.textContent = "📋 Copy đường dẫn"), 1500); },
        () => { document.execCommand("copy"); }
      );
    });
  }, { placeholder: "Gõ/dán văn bản bất kỳ → AI đọc thành file giọng dùng cho mọi tab…" });
})();

// ================= 📁🗂️ GẮN THANH TẢI LÊN (file lẻ + cả thư mục) VÀO MỌI TAB =================
// Mọi chỗ cần video giờ có CẢ HAI: dán đường dẫn/link (sẵn có) VÀ tải từ máy (file + thư mục).
(function wireUploadersEverywhere() {
  // 🧠 Cắt tự động — 1 video nguồn (nếu chọn nhiều/thư mục → dùng file đầu).
  injectUploader("dz-ac", (paths) => {
    if (!paths.length) return;
    acPath = paths[0]; $("#path-ac").value = paths[0];
    if (paths.length > 1) setLog(["✔ Đã tải " + paths.length + " file — dùng file đầu cho Cắt tự động. (Ghép nhiều → tab Video dài)"]);
  }, { multi: true });

  // 🎬 Video dài YouTube — NHIỀU video ghép: nối tất cả vào danh sách.
  injectUploader("dz-long", (paths) => {
    const ta = $("#long-paths");
    for (const p of paths) ta.value += (ta.value.trim() ? "\n" : "") + p;
  }, { multi: true });

  // 🎙️ Short lồng voice — nhiều clip bối cảnh.
  injectUploader("dz-voice", (paths) => {
    const ta = $("#voice-clips");
    for (const p of paths) ta.value += (ta.value.trim() ? "\n" : "") + p;
  }, { multi: true });

  // 🛋️ Nội thất cho con — 1 video thô.
  injectUploader("dz-interior", (paths) => {
    if (!paths.length) return;
    intVideoPath = paths[0]; $("#int-path").value = paths[0];
  }, { multi: false });

  // ⭐ Đánh giá — 1 video.
  injectUploader("dz-eval", (paths) => {
    if (!paths.length) return;
    evalPath = paths[0]; $("#path-eval").value = paths[0];
  }, { multi: false });

  // ✂️ Tự biên tập — 1 video.
  injectUploader("dz-edit", (paths) => {
    if (!paths.length) return;
    editPath = paths[0]; $("#path-edit").value = paths[0];
  }, { multi: false });

  // 🔎 Bóc ý tưởng — 1 video (hoặc dùng link ở trên).
  injectUploader("dz-extract", (paths) => {
    if (!paths.length) return;
    $("#ex-path").value = paths[0];
  }, { multi: false });

  // 📦 Hàng loạt — tải CẢ THƯ MỤC (hoặc nhiều file gom 1 thư mục) → điền đường dẫn thư mục.
  injectUploader("dz-batch", (paths, info) => {
    if (info && info.dir) $("#b-folder").value = info.dir;
  }, { multi: true, groupDir: true, label: "video vào thư mục" });
})();
