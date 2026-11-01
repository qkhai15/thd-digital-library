# Kiểm thử riêng đăng nhập — 12/10/2026

## Nguyên nhân gốc

Tìm chính xác `Yêu cầu không hợp lệ.` trong repository xác định nhánh gây lỗi login là `POST` trong `src/app/api/admin/login/route.ts`: gọi `sameOriginAllowed` và trả JSON 403 trước khi đọc credentials/tạo session. Chuỗi cũng được dùng trong các API mutation khác; không có nhánh nào chứng minh form đang gửi GET.

`sameOriginAllowed` trước sửa so sánh Origin với `APP_ORIGIN || request.url`. Next.js có thể tạo URL nội bộ theo hostname của server (`localhost`) thay vì Host LAN mà browser đang truy cập. Đã xác nhận cơ chế này trong `node_modules/next/dist/server/next-server.js` (`initUrl` sử dụng `fetchHostname`). Bởi vậy POST từ IP LAN bị coi là khác origin. Nếu cấu hình APP_ORIGIN trỏ tới domain/cổng khác, lỗi tương tự có thể xảy ra khi test local.

Hai lỗi tiếp theo được sửa cùng luồng: redirect dùng URL nội bộ/canonical có thể chuyển sang hostname khác và làm mất cookie; cookie Secure theo NODE_ENV=production bị browser từ chối trên HTTP LAN.

## Trace

1. Header `LibraryShell.tsx`: Link `/admin/login`, không trỏ API; nhãn Đăng nhập tồn tại cả mobile.
2. `/admin/login`: HTML form `action=/api/admin/login`, `method=post`. Không có client fetch hay server action trong form này.
3. Browser form dùng `application/x-www-form-urlencoded`, trường `username`/`password`; API đọc formData và đồng thời hỗ trợ JSON. Không có lỗi HTML/JSON không tương thích.
4. `/api/admin/login`: kiểm tra origin → giới hạn lần đăng nhập sai → so sánh credentials môi trường → ghi login attempt → tạo session → cookie → 303 `/admin` (HTML), hoặc 200 `{ok:true}` (JSON).
5. `admin-auth.ts`: token ngẫu nhiên; SHA-256 token lưu trong `admin_sessions`, hết hạn sau 8 giờ. Cookie host-only, HttpOnly, SameSite=Lax; Secure khi public origin là HTTPS.
6. `/api/admin/session`: đọc cookie, hash và truy vấn session còn hạn; trả `authenticated:true` cùng metadata phiên. Không thay schema/database.
7. `/admin`: server kiểm tra session; browser đã hiển thị dashboard và giữ phiên sau reload trên cả localhost/LAN.

## Thay đổi

- `src/lib/backend-utils.ts`: thêm `requestOrigin` dùng Host thực tế. APP_ORIGIN chỉ xác định origin của host public phù hợp; forwarded host/protocol chỉ được dùng khi khớp cấu hình public rõ ràng. So sánh đầy đủ origin (scheme, host, port), tiếp tục chặn cross-site và origin lạ.
- `src/lib/admin-auth.ts`: cookie session theo protocol của public origin thay vì NODE_ENV.
- `src/app/api/admin/login/route.ts`: redirect và cookie dùng cùng request origin.
- `src/app/api/admin/logout/route.ts`: đồng bộ redirect và thuộc tính cookie khi thoát phiên.
- `tests/login.test.cjs`: hồi quy localhost/LAN, cấu hình proxy HTTPS, origin lạ/sai cổng/sai protocol, HTML/JSON và cookie production.
- `scripts/login-check.mjs`: request HTTP thật, kiểm tra cookie/session/redirect/database; chỉ gửi credentials tới loopback hoặc IP đang thuộc máy hiện tại. Không in credentials/token, không xóa dữ liệu.

## Request thực tế trước/sau

Máy hiện tại có IP `192.168.0.104`; `.106` trong yêu cầu là ví dụ và không được gán cho máy này. Test browser thực tế dùng `.104`; regression có case `.106`.

| Request | Trước | Sau |
| --- | --- | --- |
| POST `http://192.168.0.104:3000/api/admin/login`, Origin cùng IP/cổng, Content-Type `application/x-www-form-urlencoded`, username/password có mặt | 403 `{"message":"Yêu cầu không hợp lệ."}`, không Location, không cookie | 303 Location `http://192.168.0.104:3000/admin`, cookie HttpOnly/SameSite=Lax, không Secure vì HTTP |
| POST form localhost:3000 | Không dùng kết quả cổng 3100 để kết luận cổng 3000 | 303 đúng localhost:3000/admin, cookie đúng protocol |
| POST JSON trên localhost/LAN | Không dùng làm thay thế kiểm thử form | 200, cookie HttpOnly, session hợp lệ |
| GET session với cookie vừa nhận, cả hai host | — | 200, `authenticated:true`; token hash có bản ghi còn hạn trong PostgreSQL |
| GET `/admin` với cookie, cả hai host | — | 200 |
| Cross-site POST | — | 403, không tạo session |
| GET `/api/admin/login` | — | 405 |

Browser thực tế: click Header → form → nhập credentials → click Đăng nhập → thấy dashboard `/admin`, sau đó reload vẫn vào Admin, cả localhost và LAN. Form DOM xác nhận method/action/enctype và tên trường, không xuất giá trị credentials. Bản cũ submit LAN không hoàn tất quan sát được trong browser vì tab JSON/điều hướng bị tool chặn/time out; response lỗi trước sửa được tái hiện bằng request HTTP thật. Browser tích hợp không cung cấp Network pane và chặn mở trực tiếp `/api/admin/session`; header/status/body session được kiểm tra bằng script HTTP, không tuyên bố đã quan sát Network pane.

## Xác nhận cuối

- `npx tsc --noEmit`: pass.
- `npm run lint`: pass.
- `npm run build`: pass.
- `npm test`: 12 tests pass, gồm 3 tests login mới.
- `node scripts/login-check.mjs http://localhost:3000 http://192.168.0.104:3000`: pass cả HTML/JSON, session database và CSRF.
- Không sửa `.env.local`, không seed demo, không xóa PostgreSQL, không deploy và không thêm feature khác.

Bằng chứng browser: `test-results/login-localhost-after.png`, `test-results/login-lan-after.png` (gitignored). Server local bản production đang chạy cổng 3000.
