THD LIBRARY - BACKEND V1 HOÀN CHỈNH CHO PROJECT HIỆN TẠI
=========================================================

MỤC TIÊU
--------
Bộ này KHÔNG tạo project mới.
Nó ghép trực tiếp vào:
C:\Projects\thd-library

Backend dùng Next.js Route Handlers + PostgreSQL hiện tại.

CÁCH CÀI
--------
1. Backup project hiện tại.

2. Giải nén file ZIP này.

3. Copy thư mục "src" vào:
   C:\Projects\thd-library\
   Chọn Merge + Replace.

4. GIỮ NGUYÊN .env.local hiện tại.
   Tối thiểu phải có:
   DATABASE_URL=...
   ADMIN_USERNAME=...
   ADMIN_PASSWORD=...
   SESSION_SECRET=...

   Tùy chọn:
   COMMENTS_REQUIRE_APPROVAL=false

   Nếu đặt:
   COMMENTS_REQUIRE_APPROVAL=true
   => bình luận mới phải được Admin duyệt mới hiện công khai.

5. Xóa cache và chạy:
   cd C:\Projects\thd-library
   Ctrl+C
   Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
   npm run dev -- --hostname 0.0.0.0

6. Test:
   http://localhost:3000/api/health

   Kết quả đúng:
   {
     "ok": true,
     "database": "connected",
     ...
   }

DATABASE TỰ MIGRATE
-------------------
Không cần xóa database cũ.
Backend tự tạo/bổ sung:

- library_items
- library_comments
- library_likes
- library_views
- borrow_requests
- news_posts
- wall_banners
- site_settings
- admin_sessions
- admin_login_attempts
- audit_logs

Dữ liệu sách cũ được giữ nguyên.

CHỨC NĂNG ĐÃ HOẠT ĐỘNG
-----------------------
1. ADMIN
- Đăng nhập Admin
- Session thật lưu DB, cookie HttpOnly
- Session hết hạn sau 8 giờ
- Đăng xuất xóa session
- Chặn thử sai login quá nhiều
- Audit log thao tác Admin

2. TÀI LIỆU
- Thêm
- Sửa
- Xóa
- Draft / Published / Archived
- Sách giấy
- Sách điện tử
- Sách nói
- Video
- Album
- Tài liệu khác
- Ảnh bìa
- PDF
- Audio
- Video
- Gallery nhiều ảnh
- Featured / thịnh hành
- Tồn kho sách giấy

3. UPLOAD
- Ảnh JPG/PNG/WebP
- PDF
- MP3/WAV/OGG/M4A
- MP4/WebM
- Kiểm tra MIME
- Giới hạn dung lượng
- Tên file ngẫu nhiên
- Lưu theo năm/tháng
- Ngăn upload file lạ

4. LƯỢT XEM
- Không cộng vô hạn khi refresh.
- Một visitor chỉ cộng 1 lượt / tài liệu / ngày.

5. YÊU THÍCH
- Có visitor cookie.
- Một visitor chỉ like 1 lần.
- Bấm lại để bỏ like.
- GET trạng thái liked thật từ backend.

6. BÌNH LUẬN
- Gửi bình luận thật vào DB.
- Chống spam cơ bản.
- Có approved / pending / hidden.
- Admin có thể hiện / ẩn / xóa.
- Trang:
  /admin/operations

7. MƯỢN SÁCH GIẤY
- Form đăng ký mượn thật.
- Họ tên
- Lớp
- Điện thoại
- Email
- Ghi chú
- Không cho gửi trùng pending.
- Không cho mượn nếu stock = 0.
- Admin duyệt / từ chối / đánh dấu đã trả.
- Khi Admin DUYỆT:
  stock tự -1.
- Khi ĐÃ TRẢ / hủy từ trạng thái approved:
  stock tự +1.
- Quản lý tại:
  /admin/operations

8. TÌM KIẾM / FILTER / PHÂN TRANG
- Chỉ trả tài liệu Published ra website công khai.
- Tìm title / author / category.
- Filter type.
- Filter lớp.
- Sort mới nhất / phổ biến.

9. NEWS BACKEND
Public:
  GET /api/news

Admin:
  GET/POST /api/admin/news
  PUT/DELETE /api/admin/news/{id}

10. BÁO TƯỜNG BACKEND
Public:
  GET /api/banners

Admin:
  GET/POST /api/admin/banners
  PUT/DELETE /api/admin/banners/{id}

LƯU Ý:
Giao diện Báo tường hiện tại của bạn đang đọc ảnh tĩnh trong
public/bao-tuong.
API banner đã sẵn sàng, nếu muốn quản trị Báo tường bằng Admin thì nối
HomeClient.tsx sang /api/banners ở bước giao diện tiếp theo.

11. HEALTH CHECK
GET:
  /api/health

12. DASHBOARD DATA
GET:
  /api/admin/dashboard

ADMIN VẬN HÀNH
--------------
Sau khi đăng nhập:
  http://localhost:3000/admin

Trong thanh Admin có thêm:
  "Vận hành"

Hoặc mở trực tiếp:
  http://localhost:3000/admin/operations

Tại đây xử lý:
- Yêu cầu mượn
- Bình luận

UPLOAD LOCAL
------------
Hiện file upload nằm ở:
public/uploads

Cách này phù hợp khi chạy:
- PC của trường
- VPS
- Máy chủ Ubuntu

Nếu triển khai Vercel/serverless:
phải chuyển upload sang Supabase Storage hoặc S3.
Database PostgreSQL không cần đổi API frontend.

BẢO MẬT
-------
- Không đưa .env.local lên GitHub.
- ADMIN_PASSWORD nên đổi khỏi mật khẩu đơn giản trước khi public.
- Nếu secret Supabase từng bị công khai, rotate key.
- Quick Tunnel trycloudflare chỉ để demo/test.

KIỂM TRA KỸ THUẬT
-----------------
Bộ code đã chạy:
npx tsc --noEmit

Kết quả: PASS.
