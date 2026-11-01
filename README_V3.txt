THD LIBRARY - V3 (TIẾP TỤC TỪ PROJECT BẠN GỬI)
=================================================

BẢN NÀY KHÔNG TẠO PROJECT MỚI.
Nó được dựng trực tiếp từ file thd-library(1).zip bạn vừa gửi.

MỤC ĐÃ LÀM TIẾP
----------------

1. FIX TÍNH NHẤT QUÁN ADMIN
- Sửa /admin/page.tsx không còn truyền prop thừa initialItems vào AdminClient.
- AdminClient tự tải dữ liệu nội dung + dashboard từ API.
- Tránh xung đột giữa bản backend v1/v2.

2. DASHBOARD ADMIN THẬT
Trang:
/admin

Hiển thị:
- Tổng nội dung
- Số tài liệu đã xuất bản
- Tổng lượt xem
- Yêu cầu mượn đang chờ
- Bình luận đang chờ
- Tin tức đã xuất bản
- Báo tường đang hiển thị

API:
/api/admin/dashboard

3. TIN TỨC ĐÃ CHUYỂN HOÀN TOÀN SANG DATABASE
Trước đây:
- /tin-tuc vẫn dùng src/data/news.ts tĩnh.

Bây giờ:
- /tin-tuc đọc bảng news_posts.
- /tin-tuc/[slug] đọc DB thật.
- Có ảnh đại diện.
- Có tin nổi bật.
- Có draft / published / archived.
- Nội dung nhiều đoạn.

Public API:
GET /api/news
GET /api/news/[slug]

Admin:
GET/POST /api/admin/news
PUT/DELETE /api/admin/news/[id]

Trang quản trị:
http://localhost:3000/admin/news

Admin có thể:
- thêm tin
- sửa tin
- xóa tin
- upload ảnh đại diện
- đặt slug
- draft / published / archived
- đánh dấu nổi bật

Nếu bảng news_posts đang trống, hệ thống tự thêm 3 bài mẫu hiện có trước đây
để trang Tin tức không bị trắng.

4. NHẬT KÝ ADMIN
API mới:
GET /api/admin/audit

Trang:
/admin/operations
=> tab "Nhật ký"

Hiển thị:
- thời gian
- tài khoản
- hành động
- loại đối tượng
- ID
- chi tiết

5. BÁO TƯỜNG
Project bạn gửi thực tế có:
public/bao-tuong/bao-tuong-2.png

Trong code cũ có nơi vẫn gọi:
bao-tuong-2.jpg

V3 đã sửa:
- seed DB dùng .png
- fallback HomeClient dùng .png
- tự migrate bản ghi DB cũ từ .jpg sang .png

6. GIỮ NGUYÊN TOÀN BỘ BACKEND V2
- Admin session lưu DB + cookie HttpOnly
- CRUD nội dung
- Upload PDF / audio / video / image / gallery / banner
- Lượt xem chống refresh spam
- Like theo visitor
- Bình luận + moderation
- Mượn sách + stock tự giảm/tăng
- Báo tường từ DB
- Video
- Album
- Search/filter/pagination
- Audit log
- Health check

CÀI ĐẶT
-------
Khuyến nghị backup project cũ trước.

1. Giải nén bản V3.
2. Copy toàn bộ project vào:
   C:\Projects\thd-library

3. GIỮ LẠI file .env.local hiện tại của bạn.
   Bản ZIP V3 KHÔNG chứa .env.local.

4. Chạy:
   cd C:\Projects\thd-library
   npm install
   Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
   npm run dev -- --hostname 0.0.0.0

5. Test:
   http://localhost:3000/api/health

6. Admin:
   http://localhost:3000/admin

7. Quản lý Tin tức:
   http://localhost:3000/admin/news

8. Vận hành:
   http://localhost:3000/admin/operations

KIỂM TRA CODE
-------------
Đã chạy:
npx tsc --noEmit

Kết quả:
PASS

Lệnh npm run build trong môi trường tạo file không thể hoàn tất vì Next.js cố tải
@next/swc-linux-x64-gnu từ registry.npmjs.org trong khi môi trường này không có Internet.
Đây không phải lỗi TypeScript của project.

BẢO MẬT
-------
- Không commit .env.local.
- Đổi ADMIN_PASSWORD mạnh trước khi public lâu dài.
- Nếu Supabase secret từng bị chia sẻ công khai, rotate key.
- trycloudflare chỉ nên dùng để demo/test.
