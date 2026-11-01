# THPT Trần Hưng Đạo - Thanh Xuân: triển khai production

## Storage phase 1

Production hiện mặc định dùng Supabase Storage cho upload mới. Đọc và cấu hình theo
[STORAGE-MIGRATION.md](STORAGE-MIGRATION.md) trước khi triển khai. Hướng dẫn volume
uploads bên dưới áp dụng cho file legacy hoặc khi chọn `STORAGE_DRIVER=local`.
`backup.sh` chỉ sao lưu PostgreSQL trong Compose và upload local; cần sao lưu riêng
object Supabase. Phase này chưa chuyển PostgreSQL hoặc giải quyết upload lớn qua Vercel.

## Dữ liệu và môi trường

Giữ nguyên PostgreSQL đang dùng và `.env.local`. Không chạy `docker compose down -v`.
`npm run db:migrate` chỉ bổ sung schema trên DATABASE_URL đã cấu hình; không tạo database,
không xóa dữ liệu, không seed nội dung. Migration dùng transaction và advisory lock.
Development có thể migrate khi truy cập lần đầu; production đặt AUTO_MIGRATE=false,
chạy migration trước khi đưa bản mới lên phục vụ.

Compose kèm project dùng volume PostgreSQL. Với database hiện có trên máy trường/VPS,
phải cấu hình app kết nối database đó hoặc khôi phục bản sao lưu vào volume trước khi chuyển
traffic. Không khởi tạo một database trống rồi coi đó là dữ liệu hiện tại.

## Triển khai VPS

1. Backup PostgreSQL và toàn bộ `public/uploads` hiện tại.
2. Copy project lên VPS, copy `deploy/.env.production.example` thành `deploy/.env.production`.
   Điền tài khoản thật; không commit file này. APP_ORIGIN phải là domain HTTPS công khai.
3. Trước lần deploy đầu, copy toàn bộ `public/uploads` vào `deploy/data/uploads`.
   Mount upload sẽ che thư mục trong image; bước này giữ các link file cũ hoạt động.
4. Trỏ DNS tới VPS, mở cổng 80/443. Nếu đổi domain, cập nhật APP_ORIGIN và Caddyfile.
5. Chạy `bash deploy/deploy.sh`. Script build app, chờ DB, migrate, khởi động app/Caddy.
6. Kiểm tra `/api/health`, `/admin/login`, đọc PDF, audio/video và upload một file mới.
   Cookie admin production yêu cầu HTTPS. Proxy phải giữ Host và ghi đè các header IP từ client.

Không áp dụng `next export`; website cần Node.js và ổ đĩa upload bền vững.
Giới hạn mỗi file: bìa 10MB, ảnh album/banner 15MB, PDF 80MB, audio 150MB, video 500MB.
Upload xác nhận chữ ký file rồi ghi stream; parser multipart vẫn cần RAM cho request,
nên VPS cần đủ bộ nhớ và không mở nhiều upload video lớn cùng lúc.

## Sao lưu và phục hồi

Chạy `bash deploy/backup.sh` vào thời điểm không có cập nhật nội dung. Sao chép hai file
backup ra ngoài VPS và bảo vệ vì chứa dữ liệu liên hệ người mượn. Script không tự xóa backup.
Thử phục hồi vào một database kiểm thử riêng trước khi dùng bản backup:

```bash
pg_restore --no-owner --no-acl --dbname=DATABASE_KIEM_THU database-TIMESTAMP.dump
```

Giải nén upload vào thư mục kiểm thử tương ứng; đối chiếu link file và số lượng nội dung.
Phục hồi lên production cần dừng thao tác ghi và xác định rõ database đích trước khi thực hiện.

## Kiểm tra trước phát hành

```bash
npm ci
npm test
npx tsc --noEmit
npm run build
```

Kiểm thử với dữ liệu thật: thêm nháp → xuất bản → tìm kiếm → đọc/nghe/xem;
album dùng gallery; video/album không xuất hiện trong Sách mới/Thịnh hành;
like bỏ/nhấn lại và refresh; bình luận chờ duyệt; mượn → duyệt → trả;
tồn kho giảm/tăng đúng một lần; sửa/xóa nội dung không mất lịch sử mượn;
ẩn toàn bộ báo tường không hiện fallback; kiểm tra desktop và mobile.

Các kiểm thử tự động dùng database giả lập trong bộ nhớ, không thao tác dữ liệu PostgreSQL thật.

`npm run test:postgres` kiểm thử SQL bằng bảng tạm `pg_temp` trên một kết nối riêng;
không ghi hoặc xóa dữ liệu trong schema `public`. `npm run smoke` kiểm tra server local
(mặc định cổng 3100), đăng nhập admin để đọc API và kiểm tra file mới với HTTP Range.
Smoke test chỉ tạo rồi dọn một file kiểm thử riêng trong uploads; không sửa nội dung thư viện.
Cookie đăng nhập kiểm thử không được in ra và session tự hết hạn theo cấu hình admin.
