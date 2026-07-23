// BƯỚC 6 (spec): sinh KỊCH BẢN + STORYBOARD chi tiết cho concept đã chọn.
import { askJSON } from "./ai-json.mjs";
import { scriptPrompt } from "./prompts.mjs";

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export async function generateScript(analysis, concept, config = {}, { onLog = () => {} } = {}) {
  const ai = await askJSON(scriptPrompt(analysis, concept, config), { onLog });
  const rawScenes = ai.scenes || ai.storyboard || ai.canh || [];
  const scenes = rawScenes.map((s, i) => ({
    stt: s.stt || i + 1,
    tStart: num(s.tStart ?? s.start ?? s.tstart),
    tEnd: num(s.tEnd ?? s.end ?? s.tend),
    loiThoai: s.loiThoai || s.script || s.thoai || s.text || "",
    hinhAnh: s.hinhAnh || s.visual || s.hinh || "",
    nguon: (s.nguon || s.source || "thay").toString().toLowerCase().includes("gi") ? "giu" : "thay",
    phuDe: s.phuDe || s.caption || s.loiThoai || s.text || "",
    hieuUng: s.hieuUng || s.effect || "",
    chuyenCanh: s.chuyenCanh || s.transition || "cut",
    nhac: s.nhac || s.music || "",
    tocDo: num(s.tocDo || s.speed || 1) || 1,
    ghiChu: s.ghiChu || s.note || "",
  }));
  const narration = scenes.map((s) => s.loiThoai).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return {
    tieuDe: ai.tieuDe || ai.title || concept.hookMoi || "Video remake",
    hook: ai.hook || (scenes[0] && scenes[0].loiThoai) || concept.hookMoi || "",
    scenes,
    cta: ai.cta || "",
    thoiLuong: String(ai.thoiLuong || concept.thoiLuongDuKien || ""),
    narration,
  };
}
