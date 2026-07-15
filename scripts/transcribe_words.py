# -*- coding: utf-8 -*-
"""
Gõ chữ có mốc thời gian TỪNG TỪ (word-level) bằng faster-whisper (offline, GPU nếu có).
Dùng cho phụ đề động kiểu viral (từng chữ nảy lên/đổi màu).

Cách dùng:
    python transcribe_words.py <video_hoac_audio> <out.json> [model] [ngon-ngu]

Mặc định: model=medium, ngon-ngu=vi
Xuất ra JSON: { language, duration, segments:[{start,end,text,words:[{start,end,word}]}], words:[...] }
"""
import os
import sys
import json
import glob

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# Nạp DLL CUDA (cuBLAS/cuDNN) cài qua pip để GPU NVIDIA hoạt động
try:
    import ctranslate2
    nvidia_base = os.path.join(os.path.dirname(os.path.dirname(ctranslate2.__file__)), "nvidia")
    for bindir in glob.glob(os.path.join(nvidia_base, "*", "bin")):
        os.add_dll_directory(bindir)
        os.environ["PATH"] = bindir + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass

from faster_whisper import WhisperModel


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "thieu tham so: <input> <out.json> [model] [lang]"}))
        sys.exit(2)

    path = sys.argv[1]
    out_json = sys.argv[2]
    model_size = sys.argv[3] if len(sys.argv) > 3 else "medium"
    language = sys.argv[4] if len(sys.argv) > 4 else "vi"
    if language in ("auto", "", "-"):
        language = None

    if not os.path.isfile(path):
        print(json.dumps({"error": f"khong tim thay file: {path}"}))
        sys.exit(2)

    try:
        print(f"[whisper] nap model '{model_size}' tren GPU...", file=sys.stderr)
        model = WhisperModel(model_size, device="cuda", compute_type="int8")
        dev = "GPU"
    except Exception as e:
        print(f"[whisper] khong dung GPU ({type(e).__name__}), chuyen CPU", file=sys.stderr)
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        dev = "CPU"

    print(f"[whisper] dang go chu ({dev}, lang={language or 'auto'})...", file=sys.stderr)
    segments, info = model.transcribe(
        path,
        language=language,
        vad_filter=True,
        word_timestamps=True,
        vad_parameters=dict(min_silence_duration_ms=400),
    )

    out_segments = []
    all_words = []
    for seg in segments:
        words = []
        for w in (seg.words or []):
            wd = {"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word}
            words.append(wd)
            all_words.append(wd)
        out_segments.append({
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
            "words": words,
        })
        print(f"  [{seg.start:6.1f}s] {seg.text.strip()}", file=sys.stderr)

    result = {
        "language": info.language,
        "language_probability": round(getattr(info, "language_probability", 0) or 0, 3),
        "duration": round(getattr(info, "duration", 0) or 0, 3),
        "device": dev,
        "segments": out_segments,
        "words": all_words,
    }
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print(f"[whisper] xong -> {out_json} ({len(all_words)} tu)", file=sys.stderr)


if __name__ == "__main__":
    main()
