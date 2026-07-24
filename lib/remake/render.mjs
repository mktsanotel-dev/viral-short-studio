// BƯỚC 8 (spec): DỰNG video remake. Engine TỰ CHỌN theo "Mức độ thay đổi":
//   • Nhẹ (hoặc "giữ giọng gốc")  → autoEdit(): giữ giọng+footage gốc, đổi hook/phụ đề/nhịp/nhạc.
//   • Vừa/Mạnh                     → textToSpeech() giọng mới + voiceShort(): voiceover + b-roll + phụ đề.
// Tái sử dụng hoàn toàn pipeline render sẵn có. Xuất kèm SRT/kịch bản/storyboard/báo cáo so sánh.
import fs from "node:fs";
import path from "node:path";
import { autoEdit } from "../edit.mjs";
import { voiceShort } from "../voiceshort.mjs";
import { textToSpeech } from "../tts.mjs";
import { outDir } from "./project.mjs";
import { computeDifference } from "./diff.mjs";
import { hasOpeningTitle } from "./detect-title.mjs";

const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, "0");
function srtTime(s) {
  s = Math.max(0, s || 0);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(Math.floor(s))},${pad(ms, 3)}`;
}
function buildSrt(segments = []) {
  return segments.map((s, i) =>
    `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${(s.text || "").trim()}\n`).join("\n");
}
function scriptToMd(script = {}) {
  const lines = [`# ${script.tieuDe || "Kịch bản remake"}`, "", `**Hook:** ${script.hook || ""}`, ""];
  (script.scenes || []).forEach((s) => {
    lines.push(`## Cảnh ${s.stt} (${s.tStart}s–${s.tEnd}s) · ${s.nguon === "giu" ? "GIỮ cảnh gốc" : "THAY cảnh"}`);
    lines.push(`- **Lời thoại:** ${s.loiThoai}`);
    if (s.hinhAnh) lines.push(`- **Hình ảnh:** ${s.hinhAnh}`);
    if (s.phuDe) lines.push(`- **Phụ đề:** ${s.phuDe}`);
    if (s.hieuUng) lines.push(`- **Hiệu ứng:** ${s.hieuUng} · Chuyển: ${s.chuyenCanh} · Tốc độ: ${s.tocDo}`);
    if (s.ghiChu) lines.push(`- **Ghi chú:** ${s.ghiChu}`);
    lines.push("");
  });
  if (script.cta) lines.push(`**CTA:** ${script.cta}`);
  return lines.join("\n");
}
function comparisonReport(project, result, diff) {
  const a = project.analysis || {}, s = project.script || {};
  return [
    `# Báo cáo so sánh: Gốc ↔ Remake`,
    "",
    `- **Mức độ thay đổi:** ${project.config?.mucDo || "?"} · **Engine:** ${result.engine}`,
    `- **Mức độ khác biệt dự kiến:** ${diff.overall}% (câu chữ ${diff.textDiff}% · cấu trúc ${diff.structDiff}%)`,
    `- ${diff.note}`,
    "",
    `| | Video gốc | Video remake |`,
    `|---|---|---|`,
    `| Hook | ${(a.hook || "").replace(/\|/g, " ")} | ${(s.hook || "").replace(/\|/g, " ")} |`,
    `| Thông điệp | ${(a.thongDiepCotLoi || "").replace(/\|/g, " ")} | (giữ nguyên) |`,
    `| CTA | ${(a.cta || "").replace(/\|/g, " ")} | ${(s.cta || "").replace(/\|/g, " ")} |`,
    `| Thời lượng | ${Math.round(a.meta?.duration || 0)}s | ${Math.round(result.meta?.duration || 0)}s |`,
    `| Số cảnh | ${(a.scenes || []).length} | ${(s.scenes || []).length} |`,
    "",
    `## Dữ kiện cốt lõi phải giữ`,
    ...(a.duKienGiu || []).map((x) => `- ${x}`),
  ].join("\n");
}

export async function renderRemake(project, { onLog = () => {} } = {}) {
  const { id, script, analysis = {} } = project;
  const config = project.config || {};
  const mucDo = config.mucDo || "vua";
  if (!script || !(script.scenes || []).length) throw new Error("Chưa có kịch bản để dựng.");

  const oDir = outDir(id);
  const ts = Date.now();
  const outPath = path.join(oDir, `remake-${ts}.mp4`); // KHÔNG đè video gốc
  let src = project.sourceSdr && fs.existsSync(project.sourceSdr) ? project.sourceSdr : project.sourceVideo;
  if (!src || !fs.existsSync(src)) throw new Error("Không tìm thấy video nguồn để dựng.");

  const keepVoice = mucDo === "nhe" || config.keep?.giongGoc === true;
  const reframe = config.change?.doc ? "blur" : (analysis.meta?.is916 ? "fill" : "blur");
  const captionStyle = config.captionStyle || "karaoke";
  const musicPath = config.musicPath || null;
  const keepBrand = config.keep?.thuongHieu !== false;
  const audioFiles = [];
  let result, engine;

  // 🔎 TIÊU ĐỀ ĐẦU: nếu video GỐC đã có sẵn tiêu đề chữ to → KHÔNG thêm tiêu đề remake (tránh chồng chữ).
  //   hookMode: "auto" (mặc định, tự nhận diện) | "always" (luôn thêm) | "never" (không thêm).
  let hookText = script.hook || null;
  const hookMode = config.hookMode || "auto";
  if (hookText && hookMode === "never") {
    hookText = null; onLog("↪ Bỏ tiêu đề đầu (theo cấu hình).");
  } else if (hookText && hookMode === "auto") {
    onLog("→ Kiểm tra video gốc đã có sẵn tiêu đề đầu chưa (AI nhìn khung hình)...");
    const has = await hasOpeningTitle(src, { onLog }).catch(() => null);
    if (has === true) { hookText = null; onLog("  ✓ Video gốc ĐÃ có tiêu đề đầu → KHÔNG thêm tiêu đề remake (tránh chồng chữ)."); }
    else if (has === false) onLog("  ✓ Video gốc chưa có tiêu đề → GIỮ tiêu đề remake.");
    else onLog("  ⚠ Không chắc → giữ tiêu đề remake (mặc định an toàn).");
  }

  if (keepVoice) {
    onLog("→ Dựng (giữ giọng+footage gốc): đổi hook/phụ đề/nhịp/nhạc...");
    engine = "autoEdit (giữ giọng gốc)";
    result = await autoEdit(src, {
      onLog, id: `${id}-r`, outPath,
      doCutSilence: true, removeFillers: true,
      reframe, doCaptions: config.doCaptions !== false, captionStyle,
      hookText,
      colorLevel: "off", smooth: "off", film: false, voiceClean: "studio",
      musicPath, watermark: keepBrand,
      model: "medium", lang: "vi",
    });
  } else {
    onLog("→ Tạo giọng đọc AI cho kịch bản mới...");
    engine = "voiceShort (giọng AI + b-roll)";
    const narration = script.narration || (script.scenes || []).map((s) => s.loiThoai).join(" ");
    if (!narration.trim()) throw new Error("Kịch bản không có lời thoại để đọc.");
    const voice = await textToSpeech(narration, { voice: config.voice || "namminh", onLog });
    audioFiles.push(voice.path);
    onLog("→ Dựng voiceover mới + b-roll + phụ đề...");
    result = await voiceShort([src], voice.path, {
      onLog, id: `${id}-r`, outPath,
      hookText,
      doCaptions: config.doCaptions !== false, captionStyle,
      voiceClean: "studio", colorLevel: "off", smooth: "off", film: false,
      musicPath, brollFolder: config.brollFolder || null,
      watermark: keepBrand, transition: "cut",
      model: "medium", lang: "vi",
    });
  }

  // ---- Xuất kèm: SRT · kịch bản · storyboard · báo cáo so sánh ----
  const finalOut = result.outPath || outPath;
  const srtPath = path.join(oDir, `remake-${ts}.srt`);
  fs.writeFileSync(srtPath, buildSrt(result.segments || []), "utf-8");
  const scriptPath = path.join(oDir, `kich-ban-${ts}.md`);
  fs.writeFileSync(scriptPath, scriptToMd(script), "utf-8");
  const storyPath = path.join(oDir, `storyboard-${ts}.json`);
  fs.writeFileSync(storyPath, JSON.stringify(script.scenes || [], null, 2), "utf-8");

  const diff = computeDifference(
    project.transcriptText || analysis.transcriptText || "",
    result.transcriptText || script.narration || "",
    { duration: analysis.meta?.duration, scenes: (analysis.scenes || []).length },
    { duration: result.meta?.duration, scenes: (script.scenes || []).length }
  );
  const reportPath = path.join(oDir, `bao-cao-so-sanh-${ts}.md`);
  fs.writeFileSync(reportPath, comparisonReport({ ...project, analysis }, { ...result, engine }, diff), "utf-8");

  return {
    outPath: finalOut,
    meta: result.meta,
    segments: result.segments || [],
    transcriptText: result.transcriptText || "",
    engine,
    audioFiles,
    subtitleFile: srtPath,
    diff,
    exports: { video: finalOut, srt: srtPath, script: scriptPath, storyboard: storyPath, report: reportPath },
  };
}
