# Kiểm thử thực tế — 12/10/2026

Kết quả mới nhất sau sửa PDF và cookie visitor LAN: xem `REGRESSION-R3.md`. Các hạn chế PDF bên dưới mô tả các vòng trước, đã được xử lý trong R3.

Chạy local tại `http://localhost:3100`, dùng PostgreSQL hiện tại. Kiểm thử bằng click, nhập form và chọn file trong browser tích hợp ở desktop và viewport mobile 390 × 844. Không deploy, không sửa `.env.local`.

## Kết quả

| Nhóm | Đã kiểm tra thực tế |
| --- | --- |
| Điều hướng | Trang chủ, menu mobile, tìm kiếm và mở kết quả; sách giấy, điện tử, nói, Video, Album, tài liệu khác, tin tức |
| Danh sách | Tài liệu thịnh hành và sách mới không chứa Video/Album; trạng thái trống của tài liệu khác |
| Chi tiết | Lượt xem không tăng lại khi refresh cùng phiên; yêu thích bật/tắt và giữ trạng thái sau refresh; gửi bình luận |
| Media | Upload PDF/WAV/MP4 và hai ảnh gallery qua file chooser; audio/video thực sự phát; gallery chuyển ảnh, phóng to và đóng trên desktop/mobile |
| PDF | Tải file thành công; SHA-256 khớp file upload. Viewer PDF trong iframe của browser tích hợp chỉ hiển thị vùng đen: chưa xác nhận đọc trực tiếp bằng Chrome/Safari |
| Mượn sách | Sách hết tồn kho chặn đăng ký; gửi yêu cầu, Admin duyệt làm tồn kho 2 → 1, trả làm tồn kho 1 → 2 |
| Admin | Đăng nhập đúng/sai, đăng xuất; thêm/sửa/xóa tài liệu thử; thêm/sửa tin tức; thêm/sửa/ẩn báo tường; ẩn/hiện/xóa bình luận thử |
| Xóa và bảo vệ dữ liệu | Hộp thoại mới: Hủy giữ bản ghi, Xác nhận xóa loại bỏ báo tường/bình luận thử; chặn xóa sách có lịch sử mượn và cho phép lưu trữ |
| Responsive | Click public flows trên desktop/mobile; đăng nhập, thêm/sửa tài liệu, sửa tin và quản lý bình luận/báo tường trên mobile. Duyệt/trả mượn đã kiểm tra trên desktop |

## Lỗi được sửa trong đợt kiểm thử

- PostgreSQL báo `42P08` khi tạo tài liệu/sửa tin vì suy luận parameter không nhất quán giữa `text` và `varchar`: thêm cast rõ ràng vào các biểu thức CASE liên quan, bổ sung kiểm thử với cột VARCHAR thực tế.
- Bố cục ảnh bìa tự sinh ở trang chi tiết bị dính chữ: sửa bố cục và xác nhận trên mobile.
- Nút gallery thiếu tên truy cập: thêm nhãn cho chuyển ảnh, thumbnail và đóng phóng to.
- Native confirm/alert làm thao tác browser bị kẹt: thay bằng hộp thoại React và thông báo trong trang; kiểm thử Hủy/Xác nhận xóa sau khi gỡ chặn.
- Khai báo smooth scroll cho Next.js để hết cảnh báo liên quan.

## Kiểm tra tự động

`npx tsc --noEmit`, `npm run lint`, `npm run build`, 9 regression tests, kiểm thử PostgreSQL và smoke test: đều pass sau sửa code. PostgreSQL regression dùng bảng tạm, không xóa dữ liệu gốc.

## Dữ liệu kiểm thử và giới hạn

- Tài liệu thử ID 13–17 đã chuyển sang `archived`, không còn trên website công khai. Hai yêu cầu mượn thử đều đã trả, giữ lịch sử. Tin thử, báo tường thử và bình luận thử đã được dọn; tài liệu xóa thử ID 18 đã xóa qua Admin. File upload thử vẫn giữ để không làm hỏng các bản ghi lưu trữ.
- Trang chủ mobile sau dọn: không có nội dung thử, không có ảnh lỗi, chiều rộng nội dung 375px trong viewport 390px.
- Chưa xác nhận viewer PDF trên browser có hỗ trợ PDF, thiết bị iOS/Android thật, nhiều browser, tải đồng thời hoặc môi trường production. Không xem các mục này là đã pass.

Bằng chứng mobile: `test-results/home-mobile.png` (thư mục được gitignore).

## Kiểm thử lại theo yêu cầu tiếp theo

- Chạy lại website production local và click các danh mục trên desktop/mobile, tìm kiếm Toán, đọc chi tiết tin tức, đăng nhập Admin bằng tài khoản hiện tại.
- Dùng lại tài liệu thử ID 13–17; thực sự phát video và audio, chuyển/phóng to/đóng gallery trên mobile. Yêu thích PDF giữ trạng thái sau reload và đã tắt lại. Lượt xem vẫn giữ 1 qua reload cùng visitor.
- Gửi yêu cầu `KIỂM THỬ MOBILE LẦN 2`; click Duyệt và Đã trả trên Admin mobile, xác nhận công khai tồn kho 2 → 1 → 2. Yêu cầu được giữ ở trạng thái `returned`.
- Gửi bình luận `KIỂM THỬ LẦN 2`, ẩn qua Admin; mở hộp thoại xóa rồi Hủy, bản ghi còn nguyên ở trạng thái `hidden`. Không xóa dữ liệu PostgreSQL trong lần kiểm thử lại này.
- Upload PDF mới qua bộ chọn file của browser, lưu thành công vào tài liệu thử. Tất cả ID 13–17 đã trở lại `archived`.
- Phát hiện nhãn đăng nhập biến mất khỏi accessibility tree trên mobile khi ẩn chữ; bổ sung `aria-label="Đăng nhập"`. Loại runtime uploads mới khỏi Git bằng `.gitignore`, giữ nguyên file trên đĩa và các asset đã tracked.
- Các thao tác tạo/xóa tài liệu, tạo/sửa/xóa tin, tạo/sửa/xóa báo tường và upload nhiều loại đã chạy thực tế ở đợt trước; lần này không lặp lại xóa do yêu cầu giữ dữ liệu PostgreSQL.
- TypeScript, lint, 9 regression tests và build được chạy lại sau sửa nhãn. Kiểm thử đọc PDF trực tiếp vẫn chưa được xác nhận; không đánh dấu pass.

Bằng chứng duyệt/trả trên mobile: `test-results/borrow-mobile.png`.
