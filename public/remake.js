// 🔄 REMAKE VIDEO — wizard 5 bước (module riêng, nạp sau app.js).
// Tái dùng biến/hàm toàn cục của app.js: pollJob, uploadFile, injectUploader, wireDrop, showLog.
(function () {
  "use strict";
  if (!document.getElementById("tab-remake")) return;

  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fileUrl = (p, dl) => "/api/file?path=" + encodeURIComponent(p) + (dl ? "&dl=1" : "") + "&t=" + Date.now();

  const KEEP_LABELS = { thongDiep: "Thông điệp chính", duKien: "Dữ kiện quan trọng", giongGoc: "Giọng đọc gốc", canhGoc: "Một số cảnh gốc", logo: "Logo", thuongHieu: "Nhận diện thương hiệu", thoiLuong: "Thời lượng gần bằng gốc", cta: "Lời kêu gọi hành động", tyLe: "Tỷ lệ khung hình" };
  const CHANGE_LABELS = { hook: "Viết lại hook", loiThoai: "Viết lại lời thoại", thuTu: "Đổi thứ tự nội dung", hinhAnh: "Thay hình ảnh minh họa", giong: "Đổi giọng đọc", nhac: "Đổi nhạc nền", chuyenCanh: "Đổi chuyển cảnh", phuDe: "Đổi kiểu phụ đề", cta: "Đổi CTA", rutNgan: "Rút ngắn video", nhanh: "Tăng nhịp độ", doc: "Chuyển ngang → dọc" };
  const STEPS = ["Nhập", "Phân tích", "Concept", "Kịch bản", "Dựng"];

  const R = { config: null, projectId: null, analysis: null, concepts: null, chosenConcept: null, script: null, result: null, cancelled: false, busy: false };

  // ---- gọi API dạng job (POST → jobId → poll) ----
  function jobApi(url, body) {
    return new Promise(async (resolve, reject) => {
      let r;
      try { r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }).then((x) => x.json()); }
      catch (e) { return reject(e); }
      if (r && r.error) return reject(new Error(r.error));
      if (!r || !r.jobId) return resolve(r);
      pollJob(r.jobId, (j) => {
        if (j.status === "error") return reject(new Error(j.error || "Lỗi xử lý"));
        resolve(j.result);
      });
    });
  }
  const getJson = (url) => fetch(url).then((x) => x.json());

  function setBusy(b, msg) {
    R.busy = b;
    el("rmk-btn-analyze").disabled = b;
    el("rmk-btn-cancel").hidden = !b;
    el("rmk-status").textContent = msg || "";
  }
  function stepbar(active) {
    el("rmk-stepbar").innerHTML = STEPS.map((s, i) =>
      `<span class="rmk-step ${i === active ? "on" : i < active ? "done" : ""}">${i + 1}. ${s}</span>`).join("");
  }

  // ---- khởi tạo cấu hình + giọng + lịch sử ----
  async function init() {
    stepbar(0);
    try {
      const cfg = await getJson("/api/config");
      R.config = cfg.remake || {};
      el("rmk-mucdo").innerHTML = (R.config.mucDoList || []).map((m) => `<option value="${m.id}"${m.id === R.config.defaultMucDo ? " selected" : ""}>${esc(m.label)}</option>`).join("");
      el("rmk-style").innerHTML = (R.config.phongCachList || []).map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join("");
      el("rmk-keep").innerHTML = flagsHtml("k", KEEP_LABELS, R.config.keepDefault || {});
      el("rmk-change").innerHTML = flagsHtml("c", CHANGE_LABELS, R.config.changeDefault || {});
    } catch { el("rmk-status").textContent = "⚠ Không tải được cấu hình."; }
    try {
      const v = await getJson("/api/tts/voices");
      el("rmk-voice").innerHTML = (v.voices || []).map((x) => `<option value="${x.id}"${x.id === (R.config && R.config.defaultVoice) ? " selected" : ""}>${esc(x.label)}</option>`).join("");
    } catch { /* để trống */ }
    loadHistory();
  }
  function flagsHtml(kind, labels, defaults) {
    return Object.entries(labels).map(([k, label]) =>
      `<label class="rmk-flag"><input type="checkbox" data-${kind}="${k}"${defaults[k] ? " checked" : ""}> ${esc(label)}</label>`).join("");
  }
  function collectConfig() {
    const keep = {}, change = {};
    document.querySelectorAll("#rmk-keep input[data-k]").forEach((c) => keep[c.dataset.k] = c.checked);
    document.querySelectorAll("#rmk-change input[data-c]").forEach((c) => change[c.dataset.c] = c.checked);
    // Hộp "Giữ âm thanh gốc" nổi ở hàng chính → ép giữ giọng/tiếng gốc (engine autoEdit).
    if (el("rmk-keepaudio") && el("rmk-keepaudio").checked) keep.giongGoc = true;
    return {
      mucDo: el("rmk-mucdo").value, phongCach: el("rmk-style").value, voice: el("rmk-voice").value,
      captionStyle: el("rmk-capstyle").value, keep, change,
      brollFolder: el("rmk-broll").value.trim() || null, musicPath: el("rmk-music").value.trim() || null,
      customRequest: el("rmk-custom").value.trim() || "",
    };
  }

  // ---- Bước 1 → 2: Phân tích ----
  el("rmk-btn-analyze").addEventListener("click", async () => {
    const url = el("rmk-url").value.trim(), path = el("rmk-path").value.trim();
    if (!url && !path) return alert("Kéo–thả video, chọn file, hoặc dán link/đường dẫn trước.");
    R.cancelled = false; setBusy(true, "⏳ Đang phân tích video…");
    clearBelow("analysis");
    try {
      const cfg = collectConfig();
      const res = await jobApi("/api/remake/analyze", { url: url || null, path: path || null, ...cfg });
      if (R.cancelled) return;
      R.projectId = res.projectId; R.analysis = res.analysis; R.config._chosen = cfg;
      renderAnalysis();
    } catch (e) { alert("Phân tích lỗi: " + e.message); }
    finally { setBusy(false); }
  });
  el("rmk-btn-cancel").addEventListener("click", async () => {
    R.cancelled = true;
    if (R.projectId) { try { await fetch("/api/remake/cancel/" + encodeURIComponent(R.projectId), { method: "POST" }); } catch {} }
    setBusy(false, "Đã hủy.");
  });

  function renderAnalysis() {
    stepbar(1);
    const a = R.analysis || {};
    const kf = (a.keyframes || []).map((k) => `<img class="rmk-kf" src="${fileUrl(k.path)}" title="${k.t}s">`).join("");
    const list = (arr) => (arr || []).length ? "<ul>" + arr.map((x) => `<li>${esc(x)}</li>`).join("") + "</ul>" : "<div class='muted'>—</div>";
    el("rmk-analysis").innerHTML = `
      <div class="optgroup rmk-card">
        <div class="optgroup-h">🔎 Bản phân tích video gốc</div>
        <div class="rmk-kfrow">${kf}</div>
        <div class="rmk-grid2">
          <div><b>Chủ đề:</b> ${esc(a.chuDe)}</div>
          <div><b>Đối tượng:</b> ${esc(a.doiTuong)}</div>
          <div class="rmk-full"><b>💎 Thông điệp cốt lõi:</b> ${esc(a.thongDiepCotLoi)}</div>
          <div><b>Hook gốc:</b> ${esc(a.hook)}</div>
          <div><b>Cảm xúc:</b> ${esc(a.camXuc)} · <b>Phong cách:</b> ${esc(a.phongCach)}</div>
          <div><b>CTA gốc:</b> ${esc(a.cta) || "—"}</div>
          <div><b>Thời lượng:</b> ${Math.round((a.meta && a.meta.duration) || 0)}s · ${a.meta && a.meta.is916 ? "9:16" : (a.meta ? a.meta.width + "x" + a.meta.height : "")}</div>
        </div>
        <div class="rmk-grid2">
          <div><b>Luận điểm chính:</b>${list(a.luanDiem)}</div>
          <div><b>📌 Dữ kiện phải giữ:</b>${list(a.duKienGiu)}</div>
          <div><b>Cảnh quan trọng:</b>${list(a.canhQuanTrong)}</div>
          <div><b>Phần có thể thay:</b>${list(a.phanCoTheThay)}</div>
        </div>
        <div class="row">
          <button class="go" id="rmk-btn-concepts">💡 Sinh 2–3 concept remake →</button>
        </div>
      </div>`;
    el("rmk-btn-concepts").addEventListener("click", genConcepts);
    el("rmk-analysis").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Bước 2 → 3: Concept ----
  async function genConcepts() {
    R.cancelled = false; setBusy(true, "⏳ Đang tạo concept…"); clearBelow("concepts");
    try {
      const res = await jobApi("/api/remake/concepts", { projectId: R.projectId, config: R.config._chosen });
      if (R.cancelled) return;
      R.concepts = res.concepts; renderConcepts();
    } catch (e) { alert("Tạo concept lỗi: " + e.message); }
    finally { setBusy(false); }
  }
  function renderConcepts() {
    stepbar(2);
    const cards = (R.concepts || []).map((c, i) => `
      <div class="optgroup rmk-concept">
        <div class="optgroup-h">Phương án ${i + 1} <span class="rmk-badge">${esc(c.mucKhacBiet)}</span></div>
        <div><b>🎣 Hook mới:</b> ${esc(c.hookMoi)}</div>
        <div><b>Concept:</b> ${esc(c.concept)}</div>
        <div><b>Cấu trúc:</b> ${(c.cauTruc || []).map((x) => esc(x)).join(" → ")}</div>
        <div class="muted">Thời lượng dự kiến: ${esc(c.thoiLuongDuKien)}</div>
        <button class="go" data-idx="${i}">✍️ Chọn & viết kịch bản →</button>
      </div>`).join("");
    el("rmk-concepts").innerHTML = `<div class="rmk-conceptrow">${cards}</div>`;
    el("rmk-concepts").querySelectorAll("button[data-idx]").forEach((b) =>
      b.addEventListener("click", () => genScript(+b.dataset.idx)));
    el("rmk-concepts").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Bước 3 → 4: Kịch bản (sửa được) ----
  async function genScript(idx) {
    R.cancelled = false; R.chosenConcept = idx; setBusy(true, "⏳ Đang viết kịch bản + storyboard…"); clearBelow("script");
    try {
      const res = await jobApi("/api/remake/script", { projectId: R.projectId, conceptIndex: idx });
      if (R.cancelled) return;
      R.script = res.script; renderScript();
    } catch (e) { alert("Viết kịch bản lỗi: " + e.message); }
    finally { setBusy(false); }
  }
  function renderScript() {
    stepbar(3);
    const s = R.script || {};
    const rows = (s.scenes || []).map((sc, i) => `
      <tr>
        <td>${sc.stt}</td>
        <td class="rmk-t">${sc.tStart}–${sc.tEnd}s<br><span class="rmk-badge ${sc.nguon === "giu" ? "giu" : ""}">${sc.nguon === "giu" ? "giữ" : "thay"}</span></td>
        <td><textarea class="rmk-sc" data-i="${i}" data-f="loiThoai" rows="2">${esc(sc.loiThoai)}</textarea></td>
        <td><input class="rmk-sc" data-i="${i}" data-f="phuDe" value="${esc(sc.phuDe)}"></td>
        <td class="muted">${esc(sc.hinhAnh)}<br>${esc(sc.hieuUng)} · ${esc(sc.chuyenCanh)}</td>
      </tr>`).join("");
    el("rmk-script").innerHTML = `
      <div class="optgroup rmk-card">
        <div class="optgroup-h">✍️ Kịch bản + Storyboard (sửa trước khi dựng)</div>
        <label>Tiêu đề <input class="pathbox" id="rmk-title" value="${esc(s.tieuDe)}"></label>
        <label>Hook <input class="pathbox" id="rmk-hook" value="${esc(s.hook)}"></label>
        <div class="rmk-tablewrap"><table class="rmk-table">
          <thead><tr><th>#</th><th>Thời gian</th><th>Lời thoại</th><th>Phụ đề</th><th>Hình ảnh / hiệu ứng</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <label>CTA <input class="pathbox" id="rmk-cta" value="${esc(s.cta)}"></label>
        <div class="muted" style="font-size:12px">Engine dựng tự chọn theo mức độ: <b>Nhẹ</b>=giữ giọng gốc · <b>Vừa/Mạnh</b>=giọng AI + b-roll.</div>
        <div class="row">
          <button class="go big" id="rmk-btn-build">🎬 Dựng video remake →</button>
        </div>
      </div>`;
    el("rmk-btn-build").addEventListener("click", buildVideo);
    el("rmk-script").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function collectScript() {
    const s = JSON.parse(JSON.stringify(R.script));
    s.tieuDe = el("rmk-title").value; s.hook = el("rmk-hook").value; s.cta = el("rmk-cta").value;
    el("rmk-script").querySelectorAll(".rmk-sc").forEach((inp) => {
      const i = +inp.dataset.i, f = inp.dataset.f;
      if (s.scenes[i]) s.scenes[i][f] = inp.value;
    });
    s.narration = s.scenes.map((x) => x.loiThoai).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return s;
  }

  // ---- Bước 4 → 5: Dựng ----
  async function buildVideo() {
    R.cancelled = false; setBusy(true, "⏳ Đang dựng video remake (có thể lâu)…"); clearBelow("result");
    try {
      const script = collectScript();
      const options = { voice: el("rmk-voice").value, captionStyle: el("rmk-capstyle").value, brollFolder: el("rmk-broll").value.trim() || null, musicPath: el("rmk-music").value.trim() || null, keepGiongGoc: !!(el("rmk-keepaudio") && el("rmk-keepaudio").checked), doCaptions: el("rmk-caption") ? el("rmk-caption").checked : true };
      const res = await jobApi("/api/remake/build", { projectId: R.projectId, script, options });
      if (R.cancelled) return;
      R.result = res; renderResult(); loadHistory();
    } catch (e) { alert("Dựng lỗi: " + e.message); }
    finally { setBusy(false); }
  }
  function renderResult() {
    stepbar(4);
    const r = R.result || {}, d = r.diff || {};
    const orig = r.sourceSdr || r.sourceVideo;
    const ex = r.exports || {};
    const dlBtn = (p, label) => p ? `<a class="dl" href="${fileUrl(p, 1)}" download>${label}</a>` : "";
    el("rmk-result").innerHTML = `
      <div class="optgroup rmk-card">
        <div class="optgroup-h">✅ Video remake (${r.engine || ""})</div>
        <div class="rmk-diffbar"><div class="rmk-difffill" style="width:${Math.min(100, d.overall || 0)}%"></div>
          <span>Mức độ khác biệt dự kiến: <b>${d.overall ?? "?"}%</b> (câu chữ ${d.textDiff ?? "?"}% · cấu trúc ${d.structDiff ?? "?"}%)</span></div>
        <div class="muted" style="font-size:12px">${esc(d.note || "")}</div>
        <div class="rmk-compare">
          <div><div class="rmk-vlabel">Video GỐC</div>${orig ? `<video src="${fileUrl(orig)}" controls></video>` : "<div class='muted'>—</div>"}</div>
          <div><div class="rmk-vlabel">Video REMAKE</div><video src="${fileUrl(r.outPath)}" controls></video></div>
        </div>
        <div class="row rmk-exports">
          ${dlBtn(r.outPath, "⬇ MP4")} ${dlBtn(ex.srt, "⬇ SRT")} ${dlBtn(ex.script, "⬇ Kịch bản")} ${dlBtn(ex.storyboard, "⬇ Storyboard")} ${dlBtn(ex.report, "⬇ Báo cáo so sánh")}
        </div>
        ${r.caption ? `<div class="rmk-caption"><b>Caption đăng bài:</b><br>${esc(r.caption)}</div>` : ""}
        <div class="row">
          <button class="dl" id="rmk-btn-backscript">↩ Sửa lại kịch bản</button>
          <button class="dl" id="rmk-btn-reset">🔄 Remake video khác</button>
        </div>
      </div>`;
    el("rmk-btn-backscript").addEventListener("click", () => { renderScript(); });
    el("rmk-btn-reset").addEventListener("click", resetAll);
    el("rmk-result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- Lịch sử + khôi phục ----
  async function loadHistory() {
    try {
      const j = await getJson("/api/remake/projects");
      const rows = (j.projects || []).slice(0, 30).map((p) => `
        <div class="rmk-hrow">
          <span class="rmk-badge">${esc(p.status)}</span>
          <b>${esc(p.name)}</b>
          <span class="muted">${esc((p.mucDo || "") + " · " + (p.createdAt || "").slice(0, 16).replace("T", " "))}</span>
          <button class="dl sm" data-open="${esc(p.id)}">Mở</button>
          ${p.outPath ? `<a class="dl sm" href="${fileUrl(p.outPath)}" target="_blank">Xem</a>` : ""}
        </div>`).join("");
      el("rmk-history").innerHTML = rows || "<div class='muted'>Chưa có dự án nào.</div>";
      el("rmk-history").querySelectorAll("button[data-open]").forEach((b) =>
        b.addEventListener("click", () => openProject(b.dataset.open)));
    } catch { /* bỏ qua */ }
  }
  async function openProject(id) {
    try {
      const j = await getJson("/api/remake/project/" + encodeURIComponent(id));
      const p = j.project; if (!p) return alert("Không mở được dự án.");
      R.projectId = p.id; R.analysis = p.analysis; R.concepts = p.concepts; R.chosenConcept = p.chosenConcept; R.script = p.script;
      R.config = R.config || {}; R.config._chosen = p.config;
      clearBelow("analysis");
      if (p.analysis) renderAnalysis();
      if (p.concepts) renderConcepts();
      if (p.script) renderScript();
      if (p.outPath) { R.result = { outPath: p.outPath, sourceSdr: p.sourceSdr, sourceVideo: p.sourceVideo, diff: p.diff, exports: p.exports, engine: (p.config && p.config.mucDo) || "" }; renderResult(); }
    } catch (e) { alert("Mở dự án lỗi: " + e.message); }
  }

  // ---- tiện ích ----
  function clearBelow(from) {
    const order = ["analysis", "concepts", "script", "result"];
    const idx = order.indexOf(from);
    order.slice(idx).forEach((k) => { const n = el("rmk-" + k); if (n) n.innerHTML = ""; });
  }
  function resetAll() {
    R.projectId = R.analysis = R.concepts = R.script = R.result = null;
    el("rmk-url").value = ""; el("rmk-path").value = "";
    clearBelow("analysis"); stepbar(0);
    el("rmk-input").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- uploader (file / thư mục) + kéo-thả cho ô nhập ----
  if (typeof injectUploader === "function") {
    injectUploader("dz-remake", (paths) => { if (paths && paths.length) el("rmk-path").value = paths[0]; }, { multi: false });
  }
  if (typeof wireDrop === "function" && typeof uploadFile === "function") {
    wireDrop("dz-remake", null, "rmk-path", async (f) => {
      try { el("rmk-status").textContent = "⏳ Đang tải file…"; const p = await uploadFile(f); el("rmk-path").value = p; el("rmk-status").textContent = "✔ Đã tải: " + f.name; }
      catch (e) { alert(e.message); el("rmk-status").textContent = ""; }
    });
  }

  init();
})();
