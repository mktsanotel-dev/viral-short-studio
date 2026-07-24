import { RNNOISE_MODEL_REL, RNNOISE_MODELS } from "./models.mjs";

// Bộ hiệu ứng "đặc sắc" dựng bằng ffmpeg: color grade điện ảnh, chuyển động máy quay
// (camera shake) + punch-zoom theo nhịp, vignette/grain, progress bar, flash chuyển cảnh.
// Mỗi hàm trả về một CHUỖI filter nối được bằng dấu phẩy (trừ nơi ghi chú).

const FPS = 30;

// --- Color grade điện ảnh: tương phản + vibrance + nét ---
export function colorGrade(level = "medium") {
  const P = {
    low: { c: 1.06, s: 1.1, b: 0.0, g: 0.99, vib: 0.15, sharp: 0.4 },
    medium: { c: 1.12, s: 1.22, b: 0.01, g: 0.98, vib: 0.25, sharp: 0.7 },
    high: { c: 1.2, s: 1.38, b: 0.02, g: 0.96, vib: 0.38, sharp: 1.0 },
  }[level] || null;
  if (!P) return null;
  return [
    `eq=contrast=${P.c}:saturation=${P.s}:brightness=${P.b}:gamma=${P.g}`,
    `vibrance=intensity=${P.vib}`,
    `unsharp=5:5:${P.sharp}:5:5:0`,
  ].join(",");
}

// --- 🎨 MÀU "CHILL" + DA CAM (HSL sáng da, tông chill điện ảnh) ---
// Da người ấm/cam & sáng, shadow hơi teal, đen nâng nhẹ (faded chill), bão hoà dịu.
// level: off | chill | warm (đậm hơn) | soft (chill nhạt).
export function chillGrade(level = "chill") {
  const P = {
    soft: { c: 1.03, b: 0.03, g: 1.02, s: 0.98, rm: 0.04, bm: -0.035, bs: 0.035, rh: 0.02, bh: -0.015, vib: 0.08, lift: 0.025, roll: 0.98 },
    chill: { c: 1.05, b: 0.035, g: 1.03, s: 1.0, rm: 0.07, bm: -0.055, bs: 0.05, rh: 0.03, bh: -0.02, vib: 0.14, lift: 0.03, roll: 0.97 },
    warm: { c: 1.06, b: 0.045, g: 1.02, s: 1.05, rm: 0.11, gm: 0.03, bm: -0.08, bs: 0.05, rh: 0.05, bh: -0.03, vib: 0.2, lift: 0.03, roll: 0.97 },
  }[level];
  if (!P) return null;
  const gm = P.gm != null ? P.gm : 0.02;
  return [
    // sáng + tương phản dịu + gamma nâng (da sáng)
    `eq=contrast=${P.c}:brightness=${P.b}:saturation=${P.s}:gamma=${P.g}`,
    // midtones ấm (da → cam), shadow hơi lạnh/teal, highlight ấm nhẹ
    `colorbalance=rm=${P.rm}:gm=${gm}:bm=${P.bm}:bs=${P.bs}:rh=${P.rh}:bh=${P.bh}`,
    // nâng đen + hạ trắng nhẹ → faded "chill"
    `curves=all='0/${P.lift} 0.5/0.5 1/${P.roll}'`,
    // rực rạo dịu (vibrance ưu tiên tông da), giữ nét
    `vibrance=intensity=${P.vib}`,
    `unsharp=5:5:0.4:5:5:0`,
  ].join(",");
}

// --- Chỉnh MÀU & ÁNH SÁNG thủ công (thanh trượt) ---
// brightness/contrast/saturation/warmth: -100..100 (0 = giữ nguyên).
export function manualColor({ brightness = 0, contrast = 0, saturation = 0, warmth = 0 } = {}) {
  const b = Number(brightness) || 0, c = Number(contrast) || 0,
        s = Number(saturation) || 0, w = Number(warmth) || 0;
  if (!b && !c && !s && !w) return null;
  const parts = [];
  if (b || c || s) {
    parts.push(
      `eq=brightness=${(b / 200).toFixed(3)}:contrast=${(1 + c / 100).toFixed(3)}:saturation=${(1 + s / 100).toFixed(3)}`
    );
  }
  if (w) {
    // ấm (+): thêm đỏ bớt xanh; lạnh (−): ngược lại
    const g = (w / 100) * 0.35;
    parts.push(`colorbalance=rm=${g.toFixed(3)}:gm=0:bm=${(-g).toFixed(3)}`);
  }
  return parts.join(",");
}

// --- Làm mịn video: khử nhiễu (hqdn3d) + làm mượt vùng phẳng giữ cạnh (smartblur) ---
// level: off | low | medium | high. Dùng cho video máy quay hạt/nhiễu, làm mịn da & nền.
export function smoothFilter(level = "off") {
  const P = {
    low: { dn: "2:1.5:4:4", sb: "1.0:0.3:-12" },
    medium: { dn: "3:2:6:6", sb: "1.6:0.4:-18" },
    high: { dn: "5:4:9:9", sb: "2.2:0.5:-24" },
  }[level];
  if (!P) return null;
  // hqdn3d: luma_spatial:chroma_spatial:luma_tmp:chroma_tmp
  // smartblur: luma_radius:luma_strength:luma_threshold (ngưỡng ÂM = chỉ làm mượt vùng phẳng, giữ nét cạnh)
  const [lr, ls, lt] = P.sb.split(":");
  return `hqdn3d=${P.dn},smartblur=luma_radius=${lr}:luma_strength=${ls}:luma_threshold=${lt}`;
}

// --- Logo: chuỗi scale + opacity cho input logo (overlay đặt riêng ở edit.mjs) ---
export function logoScaleFilter({ scale = 0.16, opacity = 0.9, targetW = 1080 }) {
  const w = Math.max(40, Math.round(targetW * scale));
  return `scale=${w}:-1,format=rgba,colorchannelmixer=aa=${Math.max(0, Math.min(1, opacity)).toFixed(2)}`;
}

// Vị trí overlay logo theo góc (margin M).
export function logoPosition(pos = "br", m = 40) {
  return {
    br: `W-w-${m}:H-h-${m}`, tr: `W-w-${m}:${m}`,
    tl: `${m}:${m}`, bl: `${m}:H-h-${m}`, center: `(W-w)/2:(H-h)/2`,
  }[pos] || `W-w-${m}:H-h-${m}`;
}

// Vị trí overlay logo TỰ DO theo % (x,y = 0..100: trái→phải, trên→dưới).
export function logoPositionXY(x = 92, y = 92) {
  const cx = Math.max(0, Math.min(100, Number(x))) / 100;
  const cy = Math.max(0, Math.min(100, Number(y))) / 100;
  return `(W-w)*${cx.toFixed(3)}:(H-h)*${cy.toFixed(3)}`;
}

// --- Giữ GIỌNG, KHỬ ỒN NỀN (ồn nền, hiss, ù, quạt, đường phố…) ---
// level: off | low | medium | high.
// 🤖 Ưu tiên RNNoise (arnndn) — khử ồn bằng AI, SẠCH như CapCut/Krisp; giữ giọng tự nhiên.
//    mix = độ mạnh (0.65 nhẹ → 1.0 triệt để). Có kèm highpass bỏ ù tần thấp.
// Nếu máy KHÔNG có model / ffmpeg thiếu arnndn → rơi về afftdn (khử nhiễu FFT) như cũ,
// không làm vỡ render. (Nhạc chồng lên giọng chỉ GIẢM được, muốn tách hẳn cần Demucs.)
export function voiceCleanFilter(level = "off") {
  if (!level || level === "off") return null;
  const models = (RNNOISE_MODELS && RNNOISE_MODELS.length) ? RNNOISE_MODELS : (RNNOISE_MODEL_REL ? [RNNOISE_MODEL_REL] : []);
  const m = models[0] || null;
  if (m) {
    // 🔇 MAX — CÁCH LY GIỌNG: triệt tiêu tối đa tiếng môi trường (như Krisp/CapCut). Chuỗi:
    //   highpass → afftdn (tiền lọc phổ) → RNNoise XẾP TẦNG mọi model (bd+cb) → anlmdn (broadband)
    //   → agate (cổng nhiễu: dập nền lúc ngừng nói, giảm ~-18dB, KHÔNG mute cứng) → lowpass (cắt hiss).
    //   Mạnh nhất; đổi lại giọng có thể hơi "khô/gần" hơn studio.
    if (level === "max") {
      const cascade = models.map((mm) => `arnndn=m=${mm}:mix=1.00`).join(",");
      return `highpass=f=100,afftdn=nr=24:nf=-40:tn=1,${cascade},anlmdn=s=0.001,` +
             `agate=threshold=0.02:ratio=2:range=0.12:attack=10:release=250,lowpass=f=12000`;
    }
    // 🎚️ STUDIO: khử ồn mạnh + xoá click/pop (adeclick) + sửa méo (adeclip) — vẫn tự nhiên.
    if (level === "studio") return `highpass=f=90,arnndn=m=${m}:mix=1.00,adeclick,adeclip`;
    const P = {
      low:    { hp: 70, mix: 0.65 },
      medium: { hp: 80, mix: 0.90 },
      high:   { hp: 90, mix: 1.00 },
    }[level] || { hp: 80, mix: 0.90 };
    return `highpass=f=${P.hp},arnndn=m=${m}:mix=${P.mix.toFixed(2)}`;
  }
  // Dự phòng (thiếu model / build ffmpeg không có arnndn):
  const P = {
    low: "highpass=f=80,afftdn=nr=10:nf=-25:tn=1",
    medium: "highpass=f=100,afftdn=nr=18:nf=-30:tn=1,anlmdn=s=0.0006",
    high: "highpass=f=120,afftdn=nr=24:nf=-34:tn=1,anlmdn=s=0.001,lowpass=f=9000",
    studio: "highpass=f=110,afftdn=nr=26:nf=-35:tn=1,anlmdn=s=0.001,adeclick,adeclip,lowpass=f=9500",
    max: "highpass=f=120,afftdn=nr=34:nf=-42:tn=1,anlmdn=s=0.0015,agate=threshold=0.025:ratio=2.5:range=0.1:attack=10:release=300,lowpass=f=9000",
  }[level];
  return P || null;
}

// --- 🔊 LÀM RÕ GIỌNG (voice clarity/presence) ---
// Mục tiêu: giọng "rõ – gần – chắc" hơn mà KHÔNG méo tiếng. Chuỗi xử lý:
//   highpass (bỏ ù/rung tay) → cắt bùn (~220Hz) → nâng hiện diện (~3kHz, giúp nghe rõ chữ)
//   → de-ess (bớt xì "s/x") → nén nhẹ (đều âm lượng, giọng nghe gần & chắc).
// loudnorm chuẩn -14 LUFS vẫn chạy Ở SAU (trong từng pipeline) nên đây chỉ lo ĐỘ RÕ.
// level: off | low | medium | high. Mặc định medium (bật đồng nhất mọi tab có giọng).
export function voiceEnhance(level = "medium") {
  // 🎚️ STUDIO: "phần đánh bóng" — cắt bùn/boomy (bớt cảm giác phòng) + hiện diện + AIR (sáng)
  //   + de-ess + nén chắc + speechnorm (đều âm lượng lời nói) → giọng gần, sáng, chắc như thu phòng.
  if (level === "studio") {
    return [
      "equalizer=f=180:t=q:w=1.1:g=-3",   // bớt bùm/boomy (giảm tiếng phòng)
      "equalizer=f=3000:t=q:w=1.4:g=4",   // hiện diện → rõ chữ
      "treble=g=3:f=8000",                // air (cao) → sáng, "studio"
      "deesser=i=0.50:m=0.5:f=0.5",       // bớt xì
      "acompressor=threshold=0.09:ratio=3.5:attack=8:release=160:makeup=1.8",
      "speechnorm=e=12.5:r=0.0004:l=1",   // đều âm lượng lời nói kiểu thu phòng
    ].join(",");
  }
  const P = {
    low:    { hp: 80, mud: 0, pres: 2, deess: 0.30, thr: 0.14, ratio: 2.5, makeup: 1.3 },
    medium: { hp: 85, mud: 2, pres: 3, deess: 0.40, thr: 0.12, ratio: 3.0, makeup: 1.5 },
    high:   { hp: 95, mud: 3, pres: 4, deess: 0.50, thr: 0.10, ratio: 3.5, makeup: 1.7 },
  }[level];
  if (!P) return null;
  const parts = [`highpass=f=${P.hp}`];
  if (P.mud) parts.push(`equalizer=f=220:t=q:w=1.0:g=-${P.mud}`);        // bớt bùn/ồm
  parts.push(`equalizer=f=3000:t=q:w=1.4:g=${P.pres}`);                  // nâng hiện diện → rõ chữ
  parts.push(`deesser=i=${P.deess.toFixed(2)}:m=0.5:f=0.5`);            // giảm xì
  parts.push(`acompressor=threshold=${P.thr}:ratio=${P.ratio}:attack=10:release=180:makeup=${P.makeup}`);
  return parts.join(",");
}

// --- 🎚️ CHỈNH GIỌNG KIỂU CAPCUT: cao độ (pitch) + tốc độ (tempo) + tông (tone) ---
// pitch: nửa cung (-12..12). tempo: hệ số tốc độ cuối (1 = giữ nguyên, 1.2 = nhanh 20%).
// tone preset cộng thêm cao độ: normal 0 · warm/trầm ấm −3 · bright/trong trẻo +2 · child/trẻ em +5 · deep/rất trầm −6.
// Dùng rubberband (chất lượng cao, giữ formant) — build ffmpeg này CÓ rubberband.
export function voicePitchTempo({ pitch = 0, tempo = 1, tone = "normal" } = {}) {
  const toneAdd = { normal: 0, warm: -3, bright: 2, child: 5, deep: -6 }[tone] ?? 0;
  const semis = (Number(pitch) || 0) + toneAdd;
  const t = Math.max(0.5, Math.min(2, Number(tempo) || 1));
  const ratio = Math.pow(2, semis / 12); // nửa cung → tỉ lệ tần số
  // Không đổi gì thì bỏ qua filter.
  if (Math.abs(semis) < 0.01 && Math.abs(t - 1) < 0.001) return null;
  return `rubberband=pitch=${ratio.toFixed(4)}:tempo=${t.toFixed(4)}`;
}

// --- Chuyển động: camera shake + punch-zoom theo các điểm cắt cảnh (zoompan) ---
// sceneCuts: mảng giây (mốc cắt/nhấn). shake/punch bật/tắt.
export function motionZoompan({ sceneCuts = [], shake = true, punch = true, baseZoom = 1.03 } = {}) {
  // pulse zoom quanh mỗi cut: cộng dồn các gauss (giới hạn để biểu thức không quá dài)
  const cuts = sceneCuts.slice(0, 24);
  let pulse = "0";
  if (punch && cuts.length) {
    pulse = cuts
      .map((c) => `0.12*exp(-pow((on/${FPS}-${c.toFixed(2)})/0.16\\,2))`)
      .join("+");
  }
  const z = `'min(1.6\\,${baseZoom}${punch ? "+" + pulse : ""})'`;
  const shx = shake ? `+7*sin(on/${FPS}*6.283*0.9)` : "";
  const shy = shake ? `+7*cos(on/${FPS}*6.283*1.13)` : "";
  const x = `'iw/2-(iw/zoom/2)${shx}'`;
  const y = `'ih/2-(ih/zoom/2)${shy}'`;
  return `zoompan=z=${z}:d=1:x=${x}:y=${y}:s=1080x1920:fps=${FPS}`;
}

// --- Vignette + film grain nhẹ ---
export function filmLook({ vignette = true, grain = 6 } = {}) {
  const parts = [];
  if (vignette) parts.push("vignette=PI/5");
  if (grain > 0) parts.push(`noise=alls=${grain}:allf=t`);
  return parts.length ? parts.join(",") : null;
}

// --- Progress bar chạy trên cùng (t phụ thuộc thời lượng) ---
export function progressBar(durSec, color = "0xFF2D6F") {
  return `drawbox=x=0:y=0:w='iw*t/${durSec.toFixed(3)}':h=12:color=${color}@0.95:t=fill`;
}

// --- Chuỗi filter chuẩn hoá 1 clip b-roll về 1080x1920 có alpha + fade chuyển cảnh ---
// kind: 'video' | 'image'. dur: độ dài hiển thị. start: mốc đặt trên timeline chính.
export function brollNormalize({ kind, dur, start, flash = true }) {
  const fadeD = 0.15;
  const fadeOutSt = Math.max(0, dur - fadeD).toFixed(3);
  const chain = [];
  if (kind === "video") {
    chain.push(`trim=0:${dur.toFixed(3)}`, `setpts=PTS-STARTPTS`);
    chain.push(`scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`);
    chain.push(`fps=${FPS}`);
  } else {
    // ảnh: kenburns nhẹ cho đỡ tĩnh
    chain.push(`scale=1188:2112`);
    chain.push(
      `zoompan=z='min(1.15\\,1.001+0.0016*on)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${FPS}`
    );
  }
  chain.push("format=yuva420p");
  chain.push(`fade=t=in:st=0:d=${fadeD}:alpha=1`);
  chain.push(`fade=t=out:st=${fadeOutSt}:d=${fadeD}:alpha=1`);
  // dịch PTS để hiển thị đúng mốc start trên timeline chính
  chain.push(`setpts=PTS-STARTPTS+${start.toFixed(3)}/TB`);
  return chain.join(",");
}

// --- Flash trắng chớp nhanh tại các mốc chuyển cảnh (overlay lớp trắng mờ) ---
export function flashEnable(cuts, halfWidth = 0.06) {
  if (!cuts || !cuts.length) return null;
  return cuts
    .slice(0, 30)
    .map((c) => `between(t,${(c - halfWidth).toFixed(2)},${(c + halfWidth).toFixed(2)})`)
    .join("+");
}

export { FPS };
