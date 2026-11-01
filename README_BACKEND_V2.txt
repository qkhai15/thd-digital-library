THD LIBRARY - BACKEND V2
========================

Bản này là bản nâng cấp trực tiếp từ thd-library-backend-v1.

ĐÃ BỔ SUNG
----------

1. BÁO TƯỜNG QUẢN LÝ BẰNG ADMIN
- Database: wall_banners
- Public API: /api/banners
- Admin API: /api/admin/banners
- Upload riêng vào public/uploads/banners/YYYY/MM/
- Trang chủ lấy Báo tường từ database
- Tự chạy 4 giây / ảnh
- Nút trước / sau
- Chấm chuyển ảnh
- Click phóng to
- Admin có thể:
  + upload ảnh
  + đặt tiêu đề
  + đặt thứ tự
  + ẩn / hiện
  + sửa
  + xóa

Quản lý tại:
http://localhost:3000/admin/operations
=> tab "Báo tường"

Nếu database wall_banners đang trống, hệ thống tự thêm:
- /bao-tuong/bao-tuong-1.jpg
- /bao-tuong/bao-tuong-2.jpg

2. ALBUM ẢNH: BỎ HOÀN TOÀN ẢNH BÌA RIÊNG
- Không còn cột ảnh bìa lỗi ở trang chi tiết Album.
- Trang chi tiết Album dùng toàn chiều ngang.
- Album hiển thị ảnh thật bên dưới bằng gallery viewer.
- Admin Album KHÔNG còn trường "Ảnh bìa".
- Admin cho chọn nhiều ảnh cùng lúc.
- Ảnh đầu tiên trong gallery tự làm ảnh đại diện ở danh sách/trang chủ.
- Có thể xóa từng ảnh trước khi lưu.

3. VIDEO
- Trang chi tiết Video cũng không còn cột ảnh bìa bên trái.
- Video player thật nằm trong phần nội dung.
- Thumbnail video trên trang chủ tiếp tục dùng khung video thật.

4. ADMIN NỘI DUNG
- Có Draft / Published / Archived.
- Tạm ẩn Bài giảng điện tử và Kỹ năng sống khỏi danh sách loại để thêm mới.
- Album upload nhiều ảnh thật.
- Link nhanh:
  + Vận hành & Báo tường
  + Xem website

5. GIỮ NGUYÊN BACKEND V1
- Session Admin bằng database
- CRUD tài liệu
- Upload
- Lượt xem chống refresh spam
- Like
- Bình luận
- Mượn sách
- Stock tự giảm/tăng
- News API
- Audit log
- Health check
- Dashboard

CÁCH CÀI
--------
1. Backup project.

2. Giải nén ZIP này.

3. Copy thư mục src vào:
   C:\Projects\thd-library\
   chọn Merge + Replace.

4. KHÔNG thay .env.local.

5. Restart sạch:

cd C:\Projects\thd-library

Ctrl + C

Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue

npm run dev -- --hostname 0.0.0.0

6. Kiểm tra database:
http://localhost:3000/api/health

Phải có:
"ok": true
"database": "connected"

7. Quản lý:
http://localhost:3000/admin

8. Báo tường / Bình luận / Mượn sách:
http://localhost:3000/admin/operations

LƯU Ý
-----
- Không cần xóa database cũ.
- Schema mới tự bổ sung khi web chạy.
- Album cũ có cover_url vẫn được giữ trong DB nhưng trang chi tiết và Admin không dùng cover đó nữa.
- File báo tường cũ trong public/bao-tuong vẫn có thể dùng làm dữ liệu khởi tạo/fallback.
- Upload local phù hợp PC/VPS. Nếu deploy Vercel/serverless thì nên chuyển file sang Supabase Storage/S3.

KIỂM TRA
--------
Đã chạy:
npx tsc --noEmit

Kết quả:
PASS
