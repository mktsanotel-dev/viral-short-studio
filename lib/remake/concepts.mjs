// BƯỚC 4 (spec): sinh 2–3 phương án remake từ bản phân tích + cấu hình người dùng.
import { askJSON } from "./ai-json.mjs";
import { conceptsPrompt } from "./prompts.mjs";

export async function generateConcepts(analysis, config = {}, { onLog = () => {} } = {}) {
  const ai = await askJSON(conceptsPrompt(analysis, config), { onLog });
  let list = Array.isArray(ai) ? ai : (ai.concepts || ai.phuongAn || ai.phuong_an || []);
  const concepts = (list || []).slice(0, 3).map((c, i) => ({
    index: i,
    hookMoi: c.hookMoi || c.hook || "",
    concept: c.concept || c.moTa || c.description || "",
    cauTruc: Array.isArray(c.cauTruc) ? c.cauTruc : (c.cauTruc ? [String(c.cauTruc)] : (c.structure || [])),
    mucKhacBiet: c.mucKhacBiet || c.khacBiet || c.difference || "",
    thoiLuongDuKien: String(c.thoiLuongDuKien || c.thoiLuong || c.duration || ""),
  }));
  if (concepts.length < 2) throw new Error("AI chỉ tạo được dưới 2 concept — hãy bấm thử lại.");
  return concepts;
}
