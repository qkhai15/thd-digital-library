# 📚 Thư viện số Trường THPT Trần Hưng Đạo – Thanh Xuân

Hệ thống thư viện số được xây dựng nhằm hỗ trợ công tác quản lý, khai thác và chia sẻ tài nguyên học tập của Trường THPT Trần Hưng Đạo – Thanh Xuân, Hà Nội.

Website cung cấp môi trường tra cứu, đọc tài liệu và tiếp cận học liệu trực tuyến dành cho giáo viên, học sinh, đồng thời hỗ trợ cán bộ thư viện quản lý tài liệu và hoạt động mượn – trả sách.

**🌐 Website chính thức:** https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn

## 1. Giới thiệu

Dự án hướng đến việc hiện đại hóa hoạt động thư viện trong nhà trường thông qua nền tảng trực tuyến, giúp người dùng tiếp cận tài nguyên học tập thuận tiện trên máy tính, điện thoại và các thiết bị có trình duyệt web.

Hệ thống được phát triển bằng Next.js, React, TypeScript và PostgreSQL, triển khai trên Railway và sử dụng dịch vụ Supabase cho cơ sở dữ liệu, lưu trữ tài liệu.

## 2. Các chức năng chính

### Dành cho người đọc

- Tra cứu và tìm kiếm tài liệu theo từ khóa.
- Xem danh mục sách giấy, sách điện tử, sách nói, video, album ảnh và các học liệu khác.
- Đọc tài liệu PDF trực tuyến.
- Nghe nội dung âm thanh, xem video và album ảnh.
- Xem thông tin chi tiết, lượt xem và lượt yêu thích của tài liệu.
- Gửi yêu cầu mượn sách giấy.
- Theo dõi tin tức và hoạt động thư viện.

### Các chức năng thuộc bản nâng cấp

Những chức năng dưới đây đã được phát triển trong nhánh `feature-upgrade` và cần hoàn tất quy trình phát hành trước khi coi là chính thức hoạt động trên production:

- Tìm kiếm nâng cao và bộ lọc tài liệu.
- Phân loại theo môn học, khối lớp, chủ đề và từ khóa.
- Bộ sưu tập học liệu.
- Gợi ý tài liệu liên quan.
- Mã QR và chia sẻ liên kết tài liệu.
- Lưu tài liệu để đọc sau.
- Lịch sử tài liệu đã xem.
- Quy trình quản lý mượn – trả và kiểm soát tồn kho.
- Bảng thống kê, phân tích hoạt động thư viện.
- Quy trình quản lý trạng thái xuất bản tài liệu.

## 3. Chức năng quản trị

Hệ thống cung cấp khu vực quản trị phục vụ cán bộ thư viện:

- Thêm, chỉnh sửa, cập nhật tài liệu.
- Quản lý hình ảnh, tệp PDF, âm thanh và video.
- Quản lý sách giấy và số lượng tồn kho.
- Tiếp nhận, duyệt và xử lý yêu cầu mượn – trả.
- Quản lý tin tức, bình luận và nội dung giới thiệu.
- Theo dõi nhật ký hoạt động.
- Cấu hình thông tin và nội dung hiển thị trên website.

Một số chức năng quản trị nâng cao chỉ có trong nhánh đang phát triển và chưa được xác nhận đã triển khai trên website chính thức.

## 4. Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| Giao diện | Next.js, React, TypeScript |
| Backend | Next.js App Router, API Routes |
| Cơ sở dữ liệu | PostgreSQL |
| Truy cập cơ sở dữ liệu | `pg` |
| Dịch vụ cơ sở dữ liệu | Supabase |
| Lưu trữ tài liệu | Supabase Storage |
| Triển khai website | Railway |
| Trình đọc PDF | PDF.js |
| Đóng gói ứng dụng | Docker |

## 5. Cài đặt và chạy trên máy cá nhân

### Yêu cầu

- Node.js và npm tương thích với phiên bản của dự án.
- PostgreSQL hoặc một cơ sở dữ liệu phát triển được cấp riêng.
- Các biến môi trường cần thiết.

### Cài đặt

Tải mã nguồn:

```bash
git clone https://github.com/qkhai15/thd-digital-library.git
cd thd-digital-library
```

Nếu sử dụng nhánh nâng cấp:

```bash
git switch feature-upgrade
```

Cài đặt các thư viện:

```bash
npm ci
```

Tạo file `.env.local` từ `.env.example` và cấu hình cho môi trường phát triển.

**Lưu ý:** Không sử dụng thông tin kết nối cơ sở dữ liệu production để thử migration hoặc chạy các bài kiểm thử có thể thay đổi dữ liệu.

Sau khi chuẩn bị cơ sở dữ liệu phát triển, chạy migration theo hướng dẫn của dự án:

```bash
npm run db:migrate
```

Khởi động ứng dụng:

```bash
npm run dev
```

Mở trình duyệt tại:

http://localhost:3000

## 6. Kiểm thử

Dự án có các bài kiểm thử phục vụ việc xác minh chức năng, bảo mật và tính ổn định của hệ thống.

```bash
npm test
```

Kiểm tra TypeScript:

```bash
npx tsc --noEmit
```

Kiểm tra quy tắc mã nguồn:

```bash
npm run lint
```

Build ứng dụng:

```bash
npm run build
```

Kiểm thử PostgreSQL sử dụng cơ sở dữ liệu kiểm thử được cấu hình riêng:

```bash
npm run test:postgres
```

Kết quả kiểm thử cần được xác minh lại trên mã nguồn hiện tại trước khi phát hành.

## 7. Trạng thái triển khai

**Website chính thức:** Đã được triển khai trên tên miền của nhà trường.

**Nhánh `feature-upgrade`:** Chứa các chức năng mở rộng đang trong quá trình hoàn thiện và phát hành.

Việc cập nhật mã nguồn lên GitHub không đồng nghĩa các thay đổi đã được triển khai lên website chính thức.

Trước khi phát hành phiên bản mới, cần thực hiện đầy đủ:

- Kiểm thử mã nguồn và các chức năng.
- Sao lưu và xác minh khả năng phục hồi cơ sở dữ liệu.
- Kiểm tra migration và bảo toàn dữ liệu hiện có.
- Kiểm thử Docker và môi trường triển khai.
- Triển khai phiên bản mới.
- Kiểm tra lại website trên tên miền chính thức.

## 8. Bảo mật và dữ liệu

Dự án sử dụng biến môi trường để quản lý thông tin cấu hình nhạy cảm.

Không đưa lên repository:

- Mật khẩu và khóa truy cập dịch vụ.
- Connection string chứa thông tin xác thực.
- File `.env.local` hoặc cấu hình production thực tế.
- Bản sao lưu cơ sở dữ liệu và tệp lưu trữ.
- Khóa mã hóa và thông tin phục hồi.
- Dữ liệu riêng tư của người dùng.

Việc quản lý dữ liệu và triển khai production phải tuân thủ các quy trình sao lưu, kiểm thử và phân quyền phù hợp.

## 9. Tài liệu kỹ thuật

- [Chức năng và trạng thái phát triển](deploy/FEATURES.md)
- [Hướng dẫn vận hành](deploy/OPERATIONS.md)
- [Database và Migration](deploy/DATABASE-MIGRATION.md)
- [Supabase Storage](deploy/STORAGE-MIGRATION.md)

## 10. Định hướng phát triển

Dự án tiếp tục hướng đến việc nâng cao trải nghiệm tra cứu học liệu, cải thiện khả năng quản lý thư viện, tăng cường tính ổn định và hỗ trợ quá trình chuyển đổi số trong nhà trường.

---

**Dự án Thư viện số – Trường THPT Trần Hưng Đạo – Thanh Xuân, Hà Nội.**

Website: https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn
