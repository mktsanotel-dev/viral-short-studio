// "Mức độ khác biệt dự kiến" (spec #10). LƯU Ý: KHÔNG kết luận không-trùng-lặp chỉ bằng %.
// Ta chấm nhiều chiều: câu chữ (từ trùng), cấu trúc (số câu/thời lượng), rồi tổng hợp.
const stop = new Set(["và","là","của","có","cho","một","các","những","được","này","đó","khi","thì","mà","ở","với","để","cũng","rất","đã","sẽ","không","người","ta","mình"]);

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && w.length > 1 && !stop.has(w));
}

// Trùng lặp câu chữ: tỉ lệ từ (khác stopword) của bản MỚI có trong bản CŨ.
function wordOverlap(oldText, newText) {
  const a = new Set(tokens(oldText));
  const b = tokens(newText);
  if (!b.length) return 0;
  const hit = b.filter((w) => a.has(w)).length;
  return hit / b.length; // 0 = mới hoàn toàn, 1 = trùng hết
}

export function computeDifference(oldText, newText, oldStruct = {}, newStruct = {}) {
  const overlap = wordOverlap(oldText, newText);
  const textDiff = Math.round((1 - overlap) * 100);

  const durOld = oldStruct.duration || 0, durNew = newStruct.duration || 0;
  const durDelta = durOld ? Math.min(1, Math.abs(durNew - durOld) / durOld) : (durNew ? 1 : 0);
  const nOld = oldStruct.scenes || 0, nNew = newStruct.scenes || 0;
  const sceneDelta = Math.max(nOld, nNew) ? Math.abs(nNew - nOld) / Math.max(nOld, nNew) : 0;
  const structDiff = Math.round((durDelta * 0.5 + sceneDelta * 0.5) * 100);

  const overall = Math.round(textDiff * 0.7 + structDiff * 0.3);
  return {
    overall,
    textDiff,
    structDiff,
    wordOverlapPct: Math.round(overlap * 100),
    note: "Chỉ số tham khảo — nên đối chiếu thêm câu chữ, cấu trúc, hình ảnh & cách triển khai bằng mắt.",
  };
}
