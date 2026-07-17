// Viral Short Studio — web server local zero-dependency.
// Chạy: node server.mjs  → mở http://localhost:5178
import "./lib/env.mjs"; // NẠP .env ĐẦU TIÊN (trước mọi cấu hình thương hiệu/Lark)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORK, __root, slug, run } from "./lib/util.mjs";
import { hasNvenc } from "./lib/ffmpeg.mjs";
import { evaluate } from "./lib/evaluate.mjs";
import { autoEdit } from "./lib/edit.mjs";
import { download, extractIdeas } from "./lib/extract.mjs";
import { askClaude, buildViralPrompt } from "./lib/ai.mjs";
import { autoClip, reclip } from "./lib/autoclip.mjs";
import { finalizeVideo } from "./lib/finalize.mjs";
import { postToLark, parseBaseUrl, probeBase, larkStatus } from "./lib/larkpost.mjs";
import { longEdit } from "./lib/longedit.mjs";
import { voiceShort } from "./lib/voiceshort.mjs";
import { interiorEdit } from "./lib/interior.mjs";
import { textToSpeech, TTS_VOICES } from "./lib/tts.mjs";
import { runStandard } from "./lib/standard.mjs";
import { BRAND, DEFAULTS, PRESETS, applyBrandSettings } from "./lib/presets.mjs";
import { publishOutputs } from "./lib/publish.mjs";
import { loadSettings, saveSettings } from "./lib/settings.mjs";

// Đọc bộ tuỳ chọn XUẤT BẢN dùng chung (Thumbnail + Content AI + đăng Lark) từ body.
// Áp GIỐNG NHAU cho mọi tính năng làm video → hành vi đồng nhất.
function publishOpts(body, loai) {
  return {
    makeThumb: body.makeThumb != null ? body.makeThumb : DEFAULTS.makeThumb,
    makeContent: body.makeContent != null ? body.makeContent : DEFAULTS.makeContent,
    postLark: body.postLark != null ? body.postLark : DEFAULTS.autoPostLark,
    thumbPhotoDir: body.thumbPhotoDir || BRAND.thumbPhotoDir,
    thumbName: body.thumbName || BRAND.name,
    loai: loai || "Video",
  };
}

const PORT = process.env.VSS_PORT || 5178;
const PUBLIC = path.join(__root, "public");
const OUT = path.join(WORK, "out");
const UP = path.join(WORK, "uploads");
for (const d of [OUT, UP]) fs.mkdirSync(d, { recursive: true });

// ---- Kho job trong bộ nhớ ----
const jobs = new Map();
let jobSeq = 0;
function newJob(kind) {
  const id = `${kind}-${Date.now()}-${++jobSeq}`;
  const job = { id, kind, status: "running", log: [], result: null, error: null, startedAt: Date.now() };
  jobs.set(id, job);
  return job;
}
function jlog(job, line) {
  job.log.push(line);
  if (job.log.length > 2000) job.log.shift();
}
async function runJob(job, fn) {
  try {
    job.result = await fn((l) => jlog(job, l));
    job.status = "done";
  } catch (e) {
    job.error = e.message || String(e);
    job.status = "error";
    jlog(job, "❌ LỖI: " + job.error);
  }
}

// ---- Helpers HTTP ----
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
async function readJSONBody(req) {
  const b = await readBody(req);
  try { return JSON.parse(b.toString("utf-8") || "{}"); } catch { return {}; }
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".mp4": "video/mp4", ".jpg": "image/jpeg",
  ".png": "image/png", ".json": "application/json", ".srt": "text/plain",
  // âm thanh (nghe thử giọng AI / voice tải lên)
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  ".ogg": "audio/ogg", ".webm": "audio/webm",
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;

  try {
    // ---- Tĩnh ----
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, "index.html")), MIME[".html"]);
    }
    if (req.method === "GET" && (p === "/app.js" || p === "/style.css")) {
      const f = path.join(PUBLIC, p.slice(1));
      return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)]);
    }
    // Logo thương hiệu (thả file vào assets/logo.png là dùng được cho header + watermark)
    if (req.method === "GET" && p === "/logo-mentor.png") {
      for (const n of ["logo.png", "logo-mentor.png"]) {
        const f = path.join(__root, "assets", n);
        if (fs.existsSync(f)) return send(res, 200, fs.readFileSync(f), MIME[".png"]);
      }
      return send(res, 404, { error: "chưa có logo trong assets (thả assets/logo.png)" });
    }

    // ---- Kiểm tra môi trường ----
    if (p === "/api/health") {
      const gpu = await hasNvenc().catch(() => false);
      // Cảnh báo sớm nếu thư mục ảnh thumbnail thương hiệu không truy cập được (vd ổ Y: chưa gắn).
      let thumbDirExists = false;
      try { thumbDirExists = !!BRAND.thumbPhotoDir && fs.existsSync(BRAND.thumbPhotoDir); } catch { thumbDirExists = false; }
      return send(res, 200, { ok: true, gpu, port: PORT, outDir: OUT, thumbDirExists });
    }

    // ---- Cấu hình cho giao diện (NGUỒN SỰ THẬT DUY NHẤT: presets.mjs) ----
    // Giao diện nạp cái này khi mở → điền mặc định + tên thương hiệu + thư mục ảnh
    // đúng MỘT chỗ, không hardcode value trong index.html nữa.
    if (p === "/api/config") {
      const presetList = Object.entries(PRESETS).map(([key, v]) => ({ key, label: v.label, hint: v.hint }));
      return send(res, 200, { brand: BRAND, defaults: DEFAULTS, presets: presetList, lark: larkStatus() });
    }

    // ---- ⚙️ CẤU HÌNH HỌC VIÊN: đọc cấu hình đã lưu để điền vào tab Cấu hình ----
    if (req.method === "GET" && p === "/api/settings") {
      const s = loadSettings();
      return send(res, 200, {
        lark: s.lark || {},
        brand: { name: BRAND.name, system: BRAND.system, color: BRAND.color, niche: BRAND.niche, thumbPhotoDir: BRAND.thumbPhotoDir },
        larkStatus: larkStatus(),
      });
    }

    // ---- ⚙️ CẤU HÌNH HỌC VIÊN: lưu cấu hình Lark Base + Thương hiệu/Thumbnail ----
    // Áp NGAY (mutate BRAND, Lark đọc tại thời điểm gọi) → không cần khởi động lại.
    if (req.method === "POST" && p === "/api/settings") {
      const body = await readJSONBody(req);
      const patch = {};
      if (body.lark && typeof body.lark === "object") patch.lark = body.lark;
      if (body.brand && typeof body.brand === "object") patch.brand = body.brand;
      saveSettings(patch);
      if (patch.brand) applyBrandSettings(patch.brand); // áp thương hiệu live
      return send(res, 200, { ok: true, larkStatus: larkStatus(), brand: BRAND });
    }

    // ---- 🔎 DÒ BẢNG LARK: dán link Base → liệt kê bảng + cột để map cột ----
    if (req.method === "POST" && p === "/api/lark/probe") {
      const body = await readJSONBody(req);
      const parsed = parseBaseUrl(body.baseLink || "");
      const baseToken = (body.baseToken || parsed.baseToken || "").trim();
      const tableId = (body.tableId || parsed.tableId || "").trim();
      if (!baseToken) return send(res, 400, { error: "Chưa nhận ra base token từ link. Kiểm tra lại link Base (dạng .../base/XXXX?table=tblYYYY)." });
      try {
        const r = await probeBase({ baseToken, tableId, onLog: () => {} });
        return send(res, 200, { ok: true, ...r });
      } catch (e) {
        return send(res, 200, { ok: false, error: e.message, baseToken, tableId });
      }
    }

    // ---- Upload file (raw body + header X-Filename) ----
    // X-Subdir (tuỳ chọn): gom nhiều file vào CÙNG một thư mục con trong uploads/
    // → dùng cho "tải cả thư mục" (tab Hàng loạt cần 1 đường dẫn thư mục thật).
    if (req.method === "POST" && p === "/api/upload") {
      const name = decodeURIComponent(req.headers["x-filename"] || "video.mp4");
      const buf = await readBody(req);
      let baseDir = UP;
      const sub = decodeURIComponent(req.headers["x-subdir"] || "").trim();
      if (sub) {
        const safeSub = slug(sub) || "folder";
        baseDir = path.join(UP, safeSub);
        fs.mkdirSync(baseDir, { recursive: true });
      }
      const safe = `${Date.now()}-${slug(name.replace(/\.[^.]+$/, ""))}${path.extname(name) || ".mp4"}`;
      const dest = path.join(baseDir, safe);
      fs.writeFileSync(dest, buf);
      return send(res, 200, { ok: true, path: dest, name, dir: baseDir });
    }

    // ---- 🔊 VĂN BẢN → GIỌNG AI (dùng chung cho MỌI tab cần voice) ----
    // GET: danh sách giọng · POST: tạo file giọng từ văn bản, trả đường dẫn dùng được ngay.
    if (req.method === "GET" && p === "/api/tts/voices") {
      return send(res, 200, { voices: TTS_VOICES });
    }
    if (req.method === "POST" && p === "/api/tts") {
      const body = await readJSONBody(req);
      if (!String(body.text || "").trim()) return send(res, 400, { error: "chưa có văn bản để đọc" });
      const job = newJob("tts");
      runJob(job, async (onLog) => textToSpeech(body.text, {
        voice: body.voice || "vi-VN-HoaiMyNeural",
        rate: body.rate ?? 0,
        pitch: body.pitch ?? 0,
        volume: body.volume ?? 0,
        onLog,
      }));
      return send(res, 200, { jobId: job.id });
    }

    // ---- Phục vụ / tải file (preview, download) ----
    if (req.method === "GET" && p === "/api/file") {
      const f = u.searchParams.get("path");
      if (!f || !fs.existsSync(f)) return send(res, 404, { error: "không thấy file" });
      const stat = fs.statSync(f);
      const range = req.headers.range;
      const type = MIME[path.extname(f).toLowerCase()] || "application/octet-stream";
      // dl=1 → ép TẢI VỀ (không phát inline / không chuyển trang). Tên file UTF-8.
      const dispo = u.searchParams.get("dl")
        ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` }
        : {};
      if (range) {
        const [s, e] = range.replace("bytes=", "").split("-");
        const start = parseInt(s, 10);
        const end = e ? parseInt(e, 10) : stat.size - 1;
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Content-Type": type, ...dispo,
        });
        return fs.createReadStream(f, { start, end }).pipe(res);
      }
      res.writeHead(200, { "Content-Length": stat.size, "Content-Type": type, ...dispo });
      return fs.createReadStream(f).pipe(res);
    }

    // ---- Trạng thái job ----
    if (req.method === "GET" && p.startsWith("/api/job/")) {
      const id = p.split("/").pop();
      const job = jobs.get(id);
      if (!job) return send(res, 404, { error: "job không tồn tại" });
      return send(res, 200, {
        id: job.id, kind: job.kind, status: job.status,
        log: job.log.slice(-200), result: job.result, error: job.error,
      });
    }

    // ---- ĐÁNH GIÁ ----
    if (req.method === "POST" && p === "/api/evaluate") {
      const { path: file, deep, model = DEFAULTS.model, lang = DEFAULTS.lang } = await readJSONBody(req);
      if (!file || !fs.existsSync(file)) return send(res, 400, { error: "thiếu/không thấy file" });
      const job = newJob("eval");
      runJob(job, async (onLog) => {
        const ev = await evaluate(file, { onLog, model, lang });
        if (deep) {
          try {
            ev.aiAnalysis = await askClaude(buildViralPrompt(ev), { onLog });
          } catch (e) { onLog("⚠ AI cloud lỗi: " + e.message); ev.aiAnalysis = null; }
        }
        delete ev._transcript;
        return ev;
      });
      return send(res, 200, { jobId: job.id });
    }

    // ---- 🏅 CHẠY TIÊU CHUẨN (100 điểm) ----
    if (req.method === "POST" && p === "/api/standard") {
      const { path: file, model = DEFAULTS.model, lang = DEFAULTS.lang } = await readJSONBody(req);
      if (!file || !fs.existsSync(file)) return send(res, 400, { error: "thiếu/không thấy file" });
      const job = newJob("standard");
      runJob(job, async (onLog) => {
        const r = await runStandard(file, { onLog, model, lang });
        delete r.transcriptText;
        return r;
      });
      return send(res, 200, { jobId: job.id });
    }

    // ---- BIÊN TẬP ----
    if (req.method === "POST" && p === "/api/edit") {
      const body = await readJSONBody(req);
      const file = body.path;
      if (!file || !fs.existsSync(file)) return send(res, 400, { error: "thiếu/không thấy file" });
      const job = newJob("edit");
      const base = slug(path.basename(file).replace(/\.[^.]+$/, ""));
      const outPath = path.join(OUT, `${base}-viral-${Date.now()}.mp4`);
      runJob(job, async (onLog) => {
        const r = await autoEdit(file, {
          onLog, id: job.id, outPath,
          doCutSilence: body.doCutSilence !== false,
          removeFillers: !!body.removeFillers,
          reframe: body.reframe || "blur",
          doCaptions: body.doCaptions !== false,
          captionStyle: body.captionStyle || "karaoke",
          colorLevel: body.colorLevel || "medium",
          manual: body.manual || null,
          smooth: body.smooth || "off",
          punch: body.punch !== false,
          shake: body.shake !== false,
          film: body.film !== false,
          progress: body.progress !== false,
          flash: body.flash !== false,
          brollTransition: body.brollTransition || "fade",
          brollFolder: body.brollFolder || null,
          brollFill: body.brollFill || "match",
          aiBroll: !!body.aiBroll,
          aiBrollCount: body.aiBrollCount ?? 6,
          logoPath: body.logoPath || null,
          logoPos: body.logoPos || "br",
          logoScale: body.logoScale ?? 0.16,
          logoOpacity: body.logoOpacity ?? 0.9,
          logoX: body.logoX ?? null,
          logoY: body.logoY ?? null,
          sfx: !!body.sfx,
          sfxVol: body.sfxVol ?? 0.6,
          voiceClean: body.voiceClean || "off",
          musicPath: body.musicPath || null,
          musicVol: body.musicVol ?? 0.18,
          normalize: body.normalize !== false,
          model: body.model || DEFAULTS.model,
          lang: body.lang || DEFAULTS.lang,
        });
        // 🖼️✍️📤 Thumbnail + Content AI + (tuỳ chọn) đăng Lark — ĐỒNG NHẤT mọi tính năng làm video.
        const title = slug(path.basename(file).replace(/\.[^.]+$/, "")).replace(/-/g, " ");
        const pub = await publishOutputs([{ outPath: r.outPath, title, transcriptText: r.transcriptText }], { ...publishOpts(body, "Video"), onLog });
        return { ...r, ...pub[0], clips: pub };
      });
      return send(res, 200, { jobId: job.id });
    }

    // ---- 🎙️ SHORT LỒNG VOICE (9:16) ----
    if (req.method === "POST" && p === "/api/voiceshort") {
      const body = await readJSONBody(req);
      const clips = (body.clips || []).map((s) => String(s).trim()).filter(Boolean);
      if (!clips.length) return send(res, 400, { error: "chưa có video bối cảnh" });
      if (!body.voicePath || !fs.existsSync(body.voicePath)) return send(res, 400, { error: "chưa có file giọng đọc (voice)" });
      for (const f of clips) if (!fs.existsSync(f)) return send(res, 400, { error: "không thấy file: " + f });
      const job = newJob("voiceshort");
      const b0 = slug(path.basename(clips[0]).replace(/\.[^.]+$/, "")) || "voice-short";
      const outPath = path.join(OUT, `voice-${b0}-${Date.now()}.mp4`);
      runJob(job, async (onLog) => {
        const r = await voiceShort(clips, body.voicePath, {
          onLog, id: job.id, outPath,
          voiceVol: body.voiceVol ?? 1.0,
          musicPath: body.musicPath || null, musicVol: body.musicVol ?? DEFAULTS.musicVolVoice,
          normalize: body.normalize !== false,
          colorLevel: body.colorLevel || DEFAULTS.colorLevel,
          smooth: body.smooth || DEFAULTS.smooth, film: body.film != null ? body.film : DEFAULTS.film,
          doCaptions: body.doCaptions !== false, captionStyle: body.captionStyle || DEFAULTS.captionStyle,
          hookText: body.hookText || null, progress: !!body.progress,
          brollFolder: body.brollFolder || null, brollFill: body.brollFill || DEFAULTS.brollFill,
          watermark: body.watermark !== false,
          transition: body.transition || "cut",
          model: body.model || DEFAULTS.model, lang: body.lang || DEFAULTS.lang,
        });
        // 🖼️✍️📤 Thumbnail + Content AI + (tuỳ chọn) đăng Lark — đồng nhất.
        const pub = await publishOutputs([{ outPath: r.outPath, title: body.hookText || "", transcriptText: r.transcriptText }], { ...publishOpts(body, "Video"), onLog });
        return { ...r, ...pub[0], clips: pub };
      });
      return send(res, 200, { jobId: job.id });
    }

    // ---- 🛋️ NỘI THẤT CHO CON (lật · voice · tăng tốc · cắt à ừ · logo · từ khóa · chỉnh giọng) ----
    if (req.method === "POST" && p === "/api/interior") {
      const body = await readJSONBody(req);
      const file = body.path;
      if (!file || !fs.existsSync(file)) return send(res, 400, { error: "thiếu/không thấy video thô" });
      if (body.voicePath && !fs.existsSync(body.voicePath)) return send(res, 400, { error: "không thấy file giọng đọc (voice)" });
      const job = newJob("interior");
      const base = slug(path.basename(file).replace(/\.[^.]+$/, "")) || "noi-that";
      const outPath = path.join(OUT, `noithat-${base}-${Date.now()}.mp4`);
      // Logo mặc định: Tài nguyên/logo-noi-that-cho-con.png (nếu học viên đã thả vào).
      let logoPath = body.logoPath || null;
      if (!logoPath) {
        for (const n of ["logo-noi-that-cho-con.png", "logo-noi-that.png", "logo.png"]) {
          const cand = path.join(__root, "Tài nguyên", n);
          if (fs.existsSync(cand)) { logoPath = cand; break; }
        }
      }
      runJob(job, async (onLog) => {
        const r = await interiorEdit(file, {
          onLog, id: job.id, outPath,
          flip: !!body.flip,
          aspect: body.aspect || "keep",
          videoSpeed: Number(body.videoSpeed) || 1,
          voicePath: body.voicePath || null,
          voiceMode: body.voiceMode || "replace",
          voiceSpeed: Number(body.voiceSpeed) || 1,
          voicePitch: Number(body.voicePitch) || 0,
          voiceTone: body.voiceTone || "normal",
          voiceVol: body.voiceVol ?? 1.0,
          voiceClean: body.voiceClean || "off",
          cutFillers: body.cutFillers !== false,
          doCaptions: body.doCaptions !== false,
          captionStyle: body.captionStyle || "karaoke",
          keywords: body.keywords || "",
          logoPath,
          logoPos: body.logoPos || "br",
          logoScale: body.logoScale ?? 0.16,
          logoOpacity: body.logoOpacity ?? 0.95,
          logoX: body.logoX ?? null, logoY: body.logoY ?? null,
          overlayText: body.overlayText || null,
          overlayPos: body.overlayPos || "bottom",
          hookText: body.hookText || null,
          colorLevel: body.colorLevel || "off",
          smooth: body.smooth || "off",
          normalize: body.normalize !== false,
          model: body.model || DEFAULTS.model,
          lang: body.lang || DEFAULTS.lang,
          editedSegments: body.editedSegments || null,
        });
        // 🖼️✍️📤 Thumbnail + Content AI + (tuỳ chọn) đăng Lark — đồng nhất.
        const pub = await publishOutputs([{ outPath: r.outPath, title: body.hookText || base.replace(/-/g, " "), transcriptText: r.transcriptText }], { ...publishOpts(body, "Video"), onLog });
        return { ...r, ...pub[0] };
      });
      return send(res, 200, { jobId: job.id });
    }

    // ---- 🎬 BIÊN TẬP VIDEO DÀI (YouTube 16:9) ----
    if (req.method === "POST" && p === "/api/longedit") {
      const body = await readJSONBody(req);
      const paths = (body.paths || []).map((s) => String(s).trim()).filter(Boolean);
      if (!paths.length) return send(res, 400, { error: "chưa có video đầu vào" });
      for (const f of paths) if (!fs.existsSync(f)) return send(res, 400, { error: "không thấy file: " + f });
      const job = newJob("longedit");
      const base = slug(path.basename(paths[0]).replace(/\.[^.]+$/, "")) || "video-dai";
      const outPath = path.join(OUT, `long-${base}-${Date.now()}.mp4`);
      runJob(job, async (onLog) => {
        const r = await longEdit(paths, {
          onLog, id: job.id, outPath,
          removeFillers: !!body.removeFillers,
          doCutSilence: body.doCutSilence !== false,
          doCaptions: body.doCaptions !== false,
          captionStyle: body.captionStyle || DEFAULTS.captionStyle,
          colorLevel: body.colorLevel || DEFAULTS.colorLevel,
          manual: body.manual || null,
          smooth: body.smooth || DEFAULTS.smooth,
          film: body.film != null ? body.film : DEFAULTS.film,
          voiceClean: body.voiceClean || DEFAULTS.voiceClean,
          musicPath: body.musicPath || null,
          musicVol: body.musicVol ?? DEFAULTS.musicVolLong,
          normalize: body.normalize !== false,
          watermark: body.watermark !== false,
          reframe: body.reframe || DEFAULTS.reframeLong,
          model: body.model || DEFAULTS.model,
          lang: body.lang || DEFAULTS.lang,
          transition: body.transition || "cut",
          introPath: body.introPath || null,
          outroPath: body.outroPath || null,
          aspect: body.aspect || "16:9",
          titleTop: body.titleTop || "",
          titleBottom: body.titleBottom || "",
          smartPrune: !!body.smartPrune,
          brollFolder: body.brollFolder || null,
          brollFill: body.brollFill || DEFAULTS.brollFill,
          makeThumb: false, // thumbnail do publish.mjs lo (một đường thống nhất mọi tính năng)
          maxMinutes: body.maxMinutes ?? 10,
        });
        // 🖼️✍️📤 Thumbnail + Content AI + (tuỳ chọn) đăng Lark cho TỪNG phần — đồng nhất.
        const multi = (r.parts || []).length > 1;
        const items = (r.parts || []).map((pt, i) => ({
          outPath: pt.outPath, thumbPath: pt.thumbPath || null,
          title: ((body.thumbTitle || body.titleTop || base).trim()) + (multi ? ` (Phần ${i + 1})` : ""),
          transcriptText: r.transcriptText,
        }));
        const pub = await publishOutputs(items, { ...publishOpts(body, "Video"), onLog });
        const parts = pub.map((it, i) => ({ ...r.parts[i], ...it }));
        return { ...r, parts };
      });
      return send(res, 200, { jobId: job.id });
    }

    // ---- BÓC Ý TƯỞNG ----
    if (req.method === "POST" && p === "/api/extract") {
      const body = await readJSONBody(req);
      const job = newJob("extract");
      runJob(job, async (onLog) => {
        let file = body.path;
        if (body.url) file = await download(body.url, { onLog, id: job.id });
        if (!file || !fs.existsSync(file)) throw new Error("không có file/URL hợp lệ");
        const ideas = await extractIdeas(file, { onLog, lang: body.lang || "vi", model: body.model || "small" });
        if (body.deep) {
          try {
            const prompt = `Đây là 1 video short đang viral. Bóc "công thức" để tôi làm lại phiên bản của mình.
Thời lượng ${ideas.structure.durationSec}s, ${ideas.structure.cutsPerMin} cắt/phút.
HOOK: "${ideas.hook}"
TRANSCRIPT:
"""${(ideas.transcript||"").slice(0,3500)}"""
Hãy trả lời tiếng Việt, gọn: (1) công thức hook, (2) cấu trúc kịch bản theo mốc giây, (3) vì sao nó giữ chân, (4) 3 ý tưởng biến thể tôi có thể quay lại cho lĩnh vực của tôi.`;
            ideas.aiAnalysis = await askClaude(prompt, { onLog });
          } catch (e) { onLog("⚠ AI cloud lỗi: " + e.message); }
        }
        return ideas;
      });
      return send(res, 200, { jobId: job.id });
    }

    // ---- 🧠 CẮT TỰ ĐỘNG (video dài → nhiều short) ----
    if (req.method === "POST" && p === "/api/autoclip") {
      const body = await readJSONBody(req);
      const job = newJob("autoclip");
      runJob(job, async (onLog) => {
        let file = body.path;
        if (body.url) file = await download(body.url, { onLog, id: job.id });
        if (!file || !fs.existsSync(file)) throw new Error("thiếu/không thấy file hoặc URL");
        const result = await autoClip(file, {
          onLog, id: job.id,
          model: body.model || DEFAULTS.model,
          lang: body.lang || DEFAULTS.lang,
          minScore: body.minScore ?? DEFAULTS.minScore,
          maxClips: body.maxClips ?? DEFAULTS.maxClips,
          burnHook: !!body.burnHook,
          reframe: body.reframe || DEFAULTS.reframeShort,
          captionStyle: body.captionStyle || DEFAULTS.captionStyle,
          colorLevel: body.colorLevel || DEFAULTS.colorLevel,
          punch: body.punch != null ? body.punch : DEFAULTS.punch,
          shake: body.shake != null ? body.shake : DEFAULTS.shake,
          film: body.film != null ? body.film : DEFAULTS.film,
          progress: body.progress != null ? body.progress : DEFAULTS.progress,
          flash: body.flash != null ? body.flash : DEFAULTS.flash,
          normalize: body.normalize !== false,
          scoreClips: body.scoreClips != null ? body.scoreClips : DEFAULTS.scoreClips,
          musicPath: body.musicPath || null,
          brollFolder: body.brollFolder || null,
          brollFill: body.brollFill || "match",
          manual: body.manual || null,
          smooth: body.smooth || "off",
          voiceClean: body.voiceClean || "off",
          brollTransition: body.brollTransition || "fade",
          aiBroll: !!body.aiBroll,
          aiBrollCount: body.aiBrollCount ?? 6,
          logoPath: body.logoPath || null,
          logoPos: body.logoPos || "br",
          logoScale: body.logoScale ?? 0.16,
          logoOpacity: body.logoOpacity ?? 0.9,
          logoX: body.logoX ?? null,
          logoY: body.logoY ?? null,
          sfx: !!body.sfx,
          sfxVol: body.sfxVol ?? 0.6,
          makeThumb: body.makeThumb !== false,
          thumbStyle: body.thumbStyle || "frame",
          thumbPhotoDir: body.thumbPhotoDir || BRAND.thumbPhotoDir,
          thumbName: body.thumbName || BRAND.name,
          musicVol: body.musicVol ?? DEFAULTS.musicVolShort,
          ctaPath: body.ctaPath || null,
        });

        // 📤 ĐĂNG LARK sau khi cắt: MẶC ĐỊNH TẮT (xuất bản phải chủ động).
        // Chỉ chạy khi người dùng bật rõ ràng autoPostLark=true trên giao diện.
        if (body.autoPostLark != null ? body.autoPostLark : DEFAULTS.autoPostLark) {
          const ok = (result.clips || []).filter((c) => !c.error && c.outPath);
          onLog(`\n📤 Tự đăng ${ok.length} short lên Lark Base (Loại=Video)...`);
          let posted = 0;
          for (let i = 0; i < ok.length; i++) {
            const c = ok[i];
            try {
              onLog(`  [${i + 1}/${ok.length}] đăng: ${c.title || path.basename(c.outPath)}`);
              const pr = await postToLark({
                videoPath: c.outPath, caption: c.caption || c.title || "",
                thumbPath: c.thumbPath || null, onLog: (l) => onLog("    " + l),
              });
              c.larkRecordId = pr.recordId; c.larkPosted = true; posted++;
            } catch (e) { onLog(`  ⚠ đăng lỗi short này: ${e.message}`); c.larkError = e.message; }
          }
          onLog(`✅ Đã đăng ${posted}/${ok.length} short lên Lark Base.`);
        }
        return result;
      });
      return send(res, 200, { jobId: job.id });
    }

    // ---- ✏️ TINH CHỈNH: dựng lại 1 short (đổi mốc cắt / sửa phụ đề / hiệu ứng) ----
    if (req.method === "POST" && p === "/api/reclip") {
      const body = await readJSONBody(req);
      if (!body.source || !fs.existsSync(body.source)) return send(res, 400, { error: "thiếu/không thấy video gốc để dựng lại" });
      const job = newJob("reclip");
      runJob(job, async (onLog) => reclip({
        onLog, id: job.id,
        source: body.source, transcriptFile: body.transcriptFile || null,
        start: body.start, end: body.end,
        segments: body.segments || null,
        reframe: body.reframe || "blur",
        captionStyle: body.captionStyle || "karaoke",
        colorLevel: body.colorLevel || "off",
        punch: !!body.punch, film: body.film !== false, progress: body.progress !== false,
        doCaptions: body.doCaptions !== false,
        voiceClean: body.voiceClean || "off", smooth: body.smooth || "off",
        hookText: body.hookText || null,
        speed: body.speed ?? 1,
        overlayText: body.overlayText || null, overlayPos: body.overlayPos || "bottom",
      }));
      return send(res, 200, { jobId: job.id });
    }

    // ---- 📤 ĐĂNG LÊN LARK BASE (video → Ảnh/video, caption → Nội dung) ----
    if (req.method === "POST" && p === "/api/lark-post") {
      const body = await readJSONBody(req);
      if (!body.videoPath || !fs.existsSync(body.videoPath)) return send(res, 400, { error: "thiếu/không thấy video để đăng" });
      const job = newJob("lark");
      runJob(job, async (onLog) => postToLark({
        videoPath: body.videoPath, caption: body.caption || "",
        thumbPath: body.thumbPath || null, onLog,
      }));
      return send(res, 200, { jobId: job.id });
    }

    // ---- 🏷️ NƯỚNG LOGO/NHẠC KHI TẢI (finalize) ----
    if (req.method === "POST" && p === "/api/finalize") {
      const body = await readJSONBody(req);
      const file = body.path;
      if (!file || !fs.existsSync(file)) return send(res, 400, { error: "thiếu/không thấy video" });
      const job = newJob("finalize");
      const base = slug(path.basename(file).replace(/\.[^.]+$/, ""));
      // Ghi bản "final" NGAY CẠNH short nguồn (trong thư mục lần cắt), giữ gọn.
      const outPath = path.join(path.dirname(file), `${base}-final-${Date.now()}.mp4`);
      runJob(job, async (onLog) => {
        const logo = body.logoPath ? {
          path: body.logoPath, x: body.logoX ?? 92, y: body.logoY ?? 92,
          scale: body.logoScale ?? 0.16, opacity: body.logoOpacity ?? 0.9,
        } : null;
        const music = body.musicPath ? { path: body.musicPath, vol: body.musicVol ?? 0.18 } : null;
        const cta = body.ctaPath ? { path: body.ctaPath } : null;
        const color = body.color || null;
        const transition = body.transition || "fade";
        const out = await finalizeVideo(file, outPath, { color, logo, music, cta, transition, onLog });
        return { outPath: out };
      });
      return send(res, 200, { jobId: job.id });
    }

    // ---- HÀNG LOẠT ----
    if (req.method === "POST" && p === "/api/batch") {
      const body = await readJSONBody(req);
      const folder = body.folder;
      if (!folder || !fs.existsSync(folder)) return send(res, 400, { error: "thiếu/không thấy thư mục" });
      const files = fs.readdirSync(folder)
        .filter((f) => /\.(mp4|mov|mkv|webm|avi)$/i.test(f))
        .map((f) => path.join(folder, f));
      if (!files.length) return send(res, 400, { error: "thư mục không có video" });
      const job = newJob("batch");
      runJob(job, async (onLog) => {
        const mode = body.mode || "evaluate";
        const results = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          onLog(`\n===== [${i + 1}/${files.length}] ${path.basename(f)} =====`);
          try {
            if (mode === "edit") {
              const base = slug(path.basename(f).replace(/\.[^.]+$/, ""));
              const outPath = path.join(OUT, `${base}-viral-${Date.now()}.mp4`);
              const r = await autoEdit(f, {
                onLog, id: `${job.id}-${i}`, outPath,
                doCutSilence: body.doCutSilence !== false,
                reframe: body.reframe || "blur",
                doCaptions: body.doCaptions !== false,
                captionStyle: body.captionStyle || "karaoke",
                colorLevel: body.colorLevel || "medium",
                punch: body.punch !== false, shake: body.shake !== false,
                film: body.film !== false, progress: body.progress !== false,
                flash: body.flash !== false,
                brollFolder: body.brollFolder || null, brollFill: body.brollFill || "match",
                normalize: body.normalize !== false,
                model: body.model || DEFAULTS.model, lang: body.lang || DEFAULTS.lang,
              });
              results.push({ file: f, outPath: r.outPath });
            } else {
              const ev = await evaluate(f, { onLog, model: body.model || DEFAULTS.model, lang: body.lang || DEFAULTS.lang });
              delete ev._transcript;
              results.push({ file: f, overall: ev.overall, verdict: ev.verdict, dimensions: ev.dimensions });
            }
          } catch (e) {
            onLog("  ❌ " + e.message);
            results.push({ file: f, error: e.message });
          }
        }
        return { mode, count: files.length, results };
      });
      return send(res, 200, { jobId: job.id });
    }

    return send(res, 404, { error: "không tìm thấy route: " + p });
  } catch (e) {
    return send(res, 500, { error: e.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🎬 Viral Short Studio đang chạy:  http://localhost:${PORT}\n`);
  console.log(`  Thư mục xuất video: ${OUT}\n`);
});
