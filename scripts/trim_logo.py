# Cắt SÁT VIỀN trong suốt của logo PNG (để logo nằm gọn góc, không lệch do padding).
# Dùng: python trim_logo.py <src.png> <dst.png>
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
bbox = im.getbbox()  # khung bao vùng KHÔNG trong suốt
im2 = im.crop(bbox) if bbox else im
# thêm biên trong suốt mỏng cho cân
pad = max(2, round(min(im2.size) * 0.02))
out = Image.new("RGBA", (im2.size[0] + pad * 2, im2.size[1] + pad * 2), (0, 0, 0, 0))
out.paste(im2, (pad, pad))
out.save(dst)
print("OK %dx%d -> %dx%d" % (im.size[0], im.size[1], out.size[0], out.size[1]))
