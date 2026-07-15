# NGUYÊN LÝ VẬN HÀNH CẢNH TRÁM (B-ROLL)

## 1. Cơ chế khớp — tóm gọn
B-roll khớp theo **TỪ KHOÁ TRONG TÊN FILE** ↔ **TỪ ĐANG NÓI** tại từng khoảnh khắc.
- Hệ thống chia lời nói thành các **cửa sổ ~3 giây**.
- Mỗi cửa sổ: lấy các từ khoá đang nói → so với từ khoá trong tên file b-roll → chọn file **trùng nhiều từ nhất** → phủ lên đúng lúc đó (~80% cửa sổ, chừa đuôi để còn thấy người nói).
- Dấu tiếng Việt được bỏ khi so khớp → `doanh-thu.mp4` khớp "doanh thu".
- Ưu tiên file **ít dùng** để không lặp lại một cảnh.

## 2. NHÓM ĐỒNG NGHĨA (mới) — khớp thông minh hơn
Không cần đặt tên trùng khít. Khi lời nói chứa 1 từ trong nhóm → coi như chứa cả nhóm. Ví dụ nhóm:
- **Tiền/kinh doanh:** tien · doanh-thu · loi-nhuan · ban-hang · bieu-do · vang · gia
- **Khách hàng:** khach · mua · client · leads
- **Nhân sự:** nhan-su · doi-nhom · team · tuyen-dung
- **Quy trình:** quy-trinh · he-thong · van-hanh
- **Mục tiêu:** muc-tieu · ke-hoach · chien-luoc
- **Gia đình:** gia-dinh · vo-chong · con-cai
- **Tâm lý:** tam-ly · cam-xuc · hanh-phuc · ap-luc
- **Marketing/AI/Công nghệ/Học tập/Công việc...**
→ Nói "doanh thu" mà file tên `tien.mp4` hay `bieu-do.mp4` vẫn khớp.

## 3. CÁCH TỐI ƯU THEO NHU CẦU (làm đúng 3 điều)
**a) Đặt tên file = nội dung nó minh hoạ (gói nhiều từ khoá).**
- ✅ `doanh-thu-tien-bieu-do.mp4` · `khach-hang-mua-tu-van.mp4` · `nhan-su-hop-team.mp4`
- ❌ `IMG_2931.mp4` · `canh-dep.mp4` (không nói lên nội dung → không khớp).

**b) Đúng nội dung, KHÔNG lấy cho có (tiêu chuẩn VII).**
- Nói "doanh thu" → cảnh **tiền / biểu đồ / cửa hàng / khách** (KHÔNG lấy ảnh thiên nhiên).
- Nói "gia đình" → cảnh gia đình. Nói "áp lực" → cảnh căng thẳng/công việc.

**c) Đủ đa dạng:** mỗi khái niệm 2–4 clip khác nhau để không lặp cảnh.

## 4. MAP RIÊNG (kiểm soát tuyệt đối) — tuỳ chọn nâng cao
Bỏ file **`_synonyms.json`** vào thư mục b-roll để tự định nghĩa nhóm đồng nghĩa của anh:
```json
[
  ["doanh thu", "tien", "bieu do", "ban hang"],
  ["mentor", "dao tao", "hoc vien", "lop hoc"],
  ["studio", "chup anh", "may anh"]
]
```
Mỗi mảng = một nhóm coi như đồng nghĩa. Khi lời nói chạm 1 từ trong nhóm → mọi file tên chứa từ nào trong nhóm đều được ưu tiên. → Anh "dạy" hệ thống khớp đúng ngành của mình.

## 5. 2 CHẾ ĐỘ TRÁM
- **Chỉ cảnh khớp từ khoá** (mặc định): chỉ chèn khi thật sự khớp → an toàn, đúng nội dung.
- **Trám dày:** khớp thì chèn, không khớp thì xoay vòng lấp cho video đỡ tĩnh (dùng khi cần nhịp nhanh, chấp nhận b-roll chung).

## 6. Thư mục b-roll mẫu (khuyến nghị)
```
BROLL/
├── _synonyms.json            (map riêng của anh — tuỳ chọn)
├── doanh-thu-bieu-do.mp4
├── tien-dem-tien.mp4
├── khach-hang-tu-van.mp4
├── nhan-su-hop-team.mp4
├── gia-dinh-am-cung.mp4
├── ap-luc-cong-viec.mp4
└── mentor-dao-tao-lop-hoc.mp4
```
Đặt tên đúng + đủ đa dạng = b-roll tự khớp chuẩn, không phải chỉnh tay.
