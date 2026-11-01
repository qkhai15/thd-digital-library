# Regression thực tế R3 — 12/10/2026

Browser tích hợp, desktop 1366 × 900 và mobile 390 × 844; production build local cổng 3000. Public flows chạy cả localhost và IP LAN hiện tại 192.168.0.104. Thao tác bằng click/form/file chooser, không dùng script để tạo nội dung.

## PASS bằng browser và đối chiếu terminal

| Luồng | Bằng chứng |
| --- | --- |
| Trang chủ/Search | Click tìm Toán desktop và REGRESSION 1210 R3 mobile; kết quả đúng, mở chi tiết; sau lưu trữ không còn nội dung thử ở trang chủ |
| Thịnh hành/Sách mới | Mở từ trang chủ/menu ở cả hai viewport; API kiểm tra không chứa Video/Album |
| Sách giấy/điện tử/nói, Video, Album, Tin tức | Click từng link desktop/mobile, chờ heading đúng; không tràn ngang |
| Chi tiết/lượt xem/yêu thích | Click thích/bỏ thích, reload; localhost giữ trạng thái. LAN trước sửa bị mất trạng thái; sau sửa giữ thích và lượt xem ổn định qua reload |
| PDF | Trước sửa iframe đen. Sau sửa PDF.js hiển thị tài liệu 3 trang, click Trang tiếp/Trang trước; desktop/mobile đều render được, canvas mobile 321px trong viewport 390px |
| Audio/Video player | Click Play thật ở desktop/mobile; paused=false, audio dài 7.53s và video 8s, không có media error |
| Gallery | Hai ảnh; click ảnh tiếp, mở phóng to, đóng, thumbnail 2 được chọn; không dùng ảnh bìa riêng |
| Bình luận | Tạm bật yêu cầu duyệt; gửi bình luận pending, Admin chuyển approved, công khai thấy nội dung; ẩn lại và khôi phục cài đặt ban đầu. Kiểm tra Hiện/Ẩn trên mobile |
| Mượn/trả | Gửi hai yêu cầu riêng bằng desktop/mobile; Admin duyệt/trả trên hai viewport, xác nhận stock 2 → 1 → 2. Sách gốc hết tồn bị chặn đăng ký |
| Login/Logout | Đăng nhập thật desktop/mobile/LAN; sai mật khẩu trả trang lỗi; logout rồi mở `/admin` bị chuyển `/admin/login`. HTTP script xác minh HTML/JSON, cookie HttpOnly/session DB và CSRF |
| Admin thêm/sửa tài liệu | Tạo 5 tài liệu qua form; sửa mô tả desktop/mobile và trạng thái. PostgreSQL xác nhận dữ liệu đúng |
| Upload | Chọn file thật: JPEG, PDF, WAV, MP4, gallery 2 JPEG. Tải qua HTTP và hash khớp từng fixture; HEAD=200, range media/PDF=206 |
| Tin tức | Tạo, sửa excerpt, mở chi tiết desktop/mobile, xác nhận nội dung; chuyển lưu trữ |
| Báo tường | Click slider/phóng to; Admin tạo, sửa tiêu đề, Hiện/Ẩn trên desktop/mobile; công khai xuất hiện đúng rồi ẩn lại |
| Xóa | Mở hộp thoại Xóa và Hủy trên tài liệu/tin/báo tường, bản ghi giữ nguyên. Không xác nhận xóa thật trong lần này |

`scripts/regression-check.mjs` chỉ SELECT PostgreSQL và GET/HEAD HTTP. Chạy trước và sau lưu trữ: pass dữ liệu, stock, bình luận, tin/báo tường, hash/range, PDF worker và bộ lọc. SQL regression chạy trên pg_temp, không xóa/ghi nội dung trường trong schema public.

## Lỗi đã sửa

1. PDF phụ thuộc viewer native của browser, khung hiển thị đen: thay iframe bằng canvas PDF.js, có tải/chuyển trang/thông báo lỗi. Worker/font/CMap/WASM/ICC được copy từ dependency chính thức trước dev/build và phục vụ cùng origin, không dùng CDN. Tham khảo [PDF.js examples](https://mozilla.github.io/pdf.js/examples/).
2. Cookie visitor Secure theo NODE_ENV làm HTTP LAN không giữ visitor, mất trạng thái thích và đếm view lại: Secure theo public request protocol, giống cookie admin. Sau sửa đã kiểm tra reload trên LAN và thêm regression test.
3. ESLint chạy vào worker/WASM JavaScript sinh từ dependency: loại riêng `public/pdfjs/**` khỏi lint; source ứng dụng vẫn được lint.

## Giới hạn/FAIL còn lại

- Không chạy xác nhận hard-delete vì yêu cầu không xóa dữ liệu PostgreSQL; chỉ kiểm tra dialog/Hủy. Không ghi nhận hard-delete là PASS.
- Mobile là viewport emulation, chưa thử iPhone/Android thật hoặc nhiều browser. PDF fixture 3 trang đã đọc thực tế; chưa kiểm tra toàn bộ biến thể PDF có password/form/annotation và file rất lớn.
- `npm audit` còn 5 cảnh báo high ở chuỗi dev lint (`braces` → micromatch → fast-glob → eslint-config-next). Audit gợi ý hạ eslint-config-next xuống Next 14; không tự hạ Next 16. `npm audit --omit=dev`: 0 vulnerabilities. Đây là hạng mục dependency còn mở.

## Giữ dữ liệu

Tài liệu thử ID 19–23 và tin slug `regression-1210-r3` được lưu trữ; bình luận và báo tường thử được ẩn, hai yêu cầu mượn đã trả. Các file upload thử giữ lại cho bản ghi lưu trữ. Không sửa `.env.local`, không seed demo, không xóa nội dung PostgreSQL, không deploy.

## File thay đổi

- `src/components/PdfViewer.tsx`, `src/components/DetailClient.tsx`, `src/app/production-ui.css`
- `src/lib/backend-utils.ts`, `tests/login.test.cjs`
- `scripts/prepare-pdf-assets.mjs`, `scripts/regression-check.mjs`
- `package.json`, `package-lock.json`, `.gitignore`, `eslint.config.mjs`, `README.md`
- Báo cáo này và tham chiếu cập nhật trong `BROWSER-TEST.md`

Ảnh: `test-results/regression-pdf-desktop.png`, `regression-pdf-mobile.png`, `regression-borrow-mobile.png`, `regression-home-desktop.png` (gitignored).
