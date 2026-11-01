# Thư viện điện tử THPT Trần Hưng Đạo - Thanh Xuân

Project hiện tại dùng Next.js App Router, React và PostgreSQL qua `pg`. Tiếp tục trên
mã nguồn/database đã có; `.env.local` được giữ riêng và không đưa lên Git.

## Chạy local

```powershell
npm ci
npm run db:migrate
npm run dev
```

DATABASE_URL trong môi trường hiện tại xác định database được dùng. Migration chỉ bổ sung
schema cần thiết và lưu phiên bản, không xóa nội dung hoặc seed demo. CLI và website dùng
cùng `scripts/schema.mjs`. Production chạy migration trước khi start và đặt AUTO_MIGRATE=false.

## Quản trị

- `/admin`: tài liệu, upload, trạng thái Nháp/Xuất bản/Lưu trữ, ưu tiên thịnh hành và tồn kho.
- `/admin/news`: tin tức, ảnh, slug, nội dung nhiều đoạn và trạng thái xuất bản.
- `/admin/operations`: yêu cầu mượn, duyệt/trả/hủy, bình luận, báo tường, nhật ký và cài đặt duyệt bình luận.

Nội dung mới được thêm trực tiếp trong admin. Tài khoản lấy từ ADMIN_USERNAME/ADMIN_PASSWORD.
Production dùng SESSION_SECRET riêng để ký cookie session; cookie HttpOnly, Secure trên HTTPS,
SameSite=Lax, token được tạo mới khi đăng nhập và hết hạn sau tám giờ. Session vẫn lưu hash trong
PostgreSQL; logout chỉ thu hồi session hiện tại. ADMIN_SESSION_NOT_BEFORE chặn session phát triển
cũ mà không xóa lịch sử. Login có giới hạn body và khóa tạm sau 10 lần sai trong 15 phút.
Sách giấy, sách điện tử, sách nói, video, album và tài liệu khác đang sử dụng.
Bài giảng điện tử/Kỹ năng sống tạm ngừng trên website; dữ liệu cũ được giữ nguyên.
Album dùng gallery. Video ưu tiên khung hình từ file. Video/album không vào Sách mới/Thịnh hành.
PDF đọc trực tiếp bằng PDF.js. Worker/font được chuẩn bị tự động trước `dev`/`build`
trong `public/pdfjs` và phục vụ từ chính website; không cần CDN hay plugin PDF của browser.
Tài liệu có lịch sử mượn cần chuyển sang Lưu trữ, không xóa mất lịch sử.

Các README_BACKEND/README_V3/README_CAI_DAT là tài liệu của các gói cũ; khi khác với README
này, dùng hướng dẫn hiện tại và mã nguồn làm chuẩn. `src/data` là dữ liệu tĩnh cũ, không tham gia
luồng công khai đang đọc PostgreSQL.

## Kiểm tra

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run test:postgres
```

Regression test chạy trong bộ nhớ. Test PostgreSQL chỉ ghi bảng tạm pg_temp trên một kết nối
riêng, không ghi/xóa schema public. Để kiểm tra HTTP với DB hiện có:

```powershell
npm run start -- --port 3100
# Terminal khác:
npm run smoke
```

Smoke test đọc các trang/API, kiểm tra đăng nhập admin và Range cho file mới; không sửa nội dung.

## Production

Chuẩn bị file bàn giao biến môi trường production riêng bằng:

```powershell
node scripts/prepare-railway-env.mjs
```

Script đọc cấu hình hiện có nhưng không sửa `.env.local`; ghi
`deploy/data/railway-production.env` trong thư mục đã được Git/Docker bỏ qua. File này
chứa secret: chỉ cấp quyền đọc cho người vận hành, nhập vào Railway Variables qua
kênh bảo mật, không commit, không chia sẻ và không in nội dung ra log. Script chỉ in
tên biến/trạng thái. Lần đầu tạo password Admin và `SESSION_SECRET` ngẫu nhiên riêng;
chạy lại giữ nguyên các credential, `PUBLIC_ORIGINS` và session cutoff đã tạo để không
vô tình đổi mật khẩu hoặc vô hiệu hóa session. Kiểm tra cutoff tại thời điểm go-live;
không tự xoay credential trong mỗi lần build/deploy. CA được cung cấp qua biến runtime
`DB_SSL_CA_BASE64`, không đưa certificate/private file vào image.

Đích production hiện tại là Railway + Supabase; domain chính thức:
`https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn`. Xem [Railway](deploy/RAILWAY.md)
và `deploy/railway-service.json` / `scripts/configure-railway-service.mjs`.
`railway.toml` chỉ giữ làm tài liệu cấu hình cũ; service mới dùng API cấu hình hiện hành.
Railway production đã deploy và kiểm thử HTTPS thực tế tại
`https://thd-library-production.up.railway.app`: 236 kiểm tra HTTP/API, 29 luồng Chrome
desktop/mobile và 24 kiểm tra ảnh/video/layout PASS. Release cuối đã PASS TLSv1.3 trên
socket thật, health/Storage và 223 kiểm tra HTTP/API sau khi dừng toàn bộ app server
local; dữ liệu cũ cả 13 bảng giữ nguyên. Ngày 15/10/2026, Railway xác minh DNS ownership
và certificate hợp lệ cho domain trường; HTTP chuyển HTTPS 301 và health PASS trên
domain chính thức. Xem bằng chứng triển khai trong [Railway](deploy/RAILWAY.md).
Chrome trên release cuối cũng PASS 24 kiểm tra visual và 6 kiểm tra login/session/
logout/SEO thực tế. [Kiểm thử domain chính thức](deploy/OFFICIAL-DOMAIN-VERIFICATION.md)
ghi kết quả mới nhất và sửa H1 trang chủ. Search Console cần xác minh thủ công;
không khẳng định Google đã index.

Production dùng DATABASE_URL hosted Supabase, AUTO_MIGRATE=false, Storage Supabase và CA runtime
giữ TLS verify-full. Schema hiện tại version 2 có 13 bảng ứng dụng, gồm storage_upload_intents.
Không cần PostgreSQL local, Railway volume hoặc public/uploads để lưu dữ liệu production.
Migrations bổ sung được chạy có backup trước; startup chỉ kiểm tra schema, không restore/seed.

APP_ORIGIN xác định origin HTTPS public. PUBLIC_ORIGINS tùy chọn thêm các origin HTTPS chính xác
cho hostname Railway hoặc proxy/tunnel; không dùng wildcard hoặc hardcode hostname tunnel.
Origin/Host/forwarded headers chỉ được tin khi khớp cấu hình; development vẫn dùng localhost/LAN.
Canonical/metadata/sitemap luôn dùng domain trường, không dùng hostname preview/tunnel.

[Hướng dẫn VPS cũ](deploy/PRODUCTION.md) và docker-compose/Caddy/backup ổ đĩa local được giữ làm
tài liệu lịch sử; không dùng luồng đó cho Railway hiện tại. `/uploads/...` cũ được resolve sang
Supabase, giữ URL và file local cũ. Range PDF/audio/video được Storage trả 206 sau redirect.

## Supabase Storage và upload

Xem [migration upload](deploy/STORAGE-MIGRATION.md) và [Free-plan verification](deploy/DIRECT-UPLOAD-FREE-VERIFICATION.md).
Storage local/Supabase cùng tồn tại trong development/migration; production chỉ dùng Supabase.
Link cũ và file local được giữ nguyên; thay/xóa nội dung không tự xóa object được dùng chung.

Free plan hiện giới hạn PDF/audio/video 50 MiB/file (52428800 bytes), cover 10 MiB,
gallery/banner 15 MiB. UPLOAD_MEDIA_MAX_MIB là cấu hình tập trung; limit thực tế lấy mức thấp
nhất giữa policy và hai bucket. Admin kiểm tra kích thước trước khi xin token/truyền file.
Video vượt limit được hướng dẫn nén hoặc nâng Storage plan; không nâng plan cho release này.

Ảnh/file nhỏ giữ multipart tương thích. PDF/audio/video trên 6 MiB dùng Admin-authenticated
signing → browser signed TUS trực tiếp vào bucket PRIVATE quarantine → backend finalize.
Backend kiểm tra MIME/extension/size/path/signature và quyền sở hữu intent trước khi Storage
copy sang bucket public; chỉ metadata/URL được lưu vào PostgreSQL. Railway không buffer toàn
bộ file lớn; Supabase secret không xuống browser. TUS dùng chunk 6 MiB, retry/resume.
Multipart Supabase có cap thực tế 16 MiB để giữ đường tương thích an toàn.

Ngày 15/10/2026, tổng object public + private khoảng **940 MiB**, gần quota Storage Free 1 GB;
nguồn private và bản public đều được giữ và cùng tính dung lượng. Đây là quota tổng,
khác limit 50 MiB/file; Supabase tính usage trung bình theo GB-hours. Chưa xóa file
hoặc nâng plan. Trước khi thêm nhiều media lớn, người vận hành cần kiểm tra dashboard,
backup và duyệt retention; xem [số đo/giới hạn vận hành](deploy/RAILWAY.md).

## Vận hành và rollback

Xem [database migration/backup/restore](deploy/DATABASE-MIGRATION.md) và [Railway operations](deploy/RAILWAY.md).
Backup PostgreSQL không chứa bytes của Storage: cần backup riêng object public/quarantine và
manifest path/hash, giữ bản mã hóa ngoài máy/repo, kiểm thử restore vào database/bucket tách biệt.
Health `/api/health` kiểm tra DB/schema; Storage được kiểm tra lúc startup. Cần uptime/error/RAM
alerts ngoài Railway healthcheck. Rollback ứng dụng giữ hosted DB/Storage, SESSION_SECRET và
cutoff hiện tại; không restore đè dữ liệu mới hoặc quay lại persistent upload local.
