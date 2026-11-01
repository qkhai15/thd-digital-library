# Feature upgrade — hợp đồng và trạng thái release

Trạng thái cập nhật 2026-10-26: **implementation đã được tích hợp; chưa release
feature lên production**. Checkpoint production trước nâng cấp là `5a34bf2`.
Giữ nguyên web service, domain, PostgreSQL, Storage và các URL tài liệu hiện có.
Không coi production cũ PASS là bằng chứng các feature mới đã PASS trên public.
R2/cron/monitor ngoài vẫn là công việc external configuration riêng trong
[OPERATIONS.md](OPERATIONS.md), không phải lỗi feature.

## Metadata, taxonomy và collections

- Migration v3 thêm `library_subjects`, `library_collections`,
  `library_collection_items` và metadata nullable cho `library_items`:
  `publisher`, `publication_year`, `isbn` (cũng có thể là identifier), `language`,
  `page_count`, `subject_id`, `source`, `rights`; `topics`/`tags` mặc định mảng rỗng.
- Khối lớp dùng tiếp `class_level`: `10`, `11`, `12`, `Khác`; không tạo field khối
  trùng lặp. Topics/tags là `text[]`, tối đa 30 mục × 100 ký tự, bỏ mục trống/trùng.
  Metadata không có dữ liệu được bỏ khỏi phần hiển thị public.
- Admin tài liệu tạo/sửa metadata. PUT ghép với bản ghi hiện có nên client cũ
  không gửi metadata vẫn giữ giá trị; gửi `null`/rỗng rõ ràng có thể xóa field tùy
  chọn. Môn mới chọn phải active; giữ môn cũ đã ẩn khi sửa field khác được phép.
- `/admin/catalog` quản lý môn/collections. Slug đã lưu bất biến. DELETE API môn
  thực hiện ẩn, DELETE collection thực hiện archive; không xóa bản ghi/Storage.
  Một collection chứa tối đa 500 tài liệu, có thứ tự, một tài liệu có thể thuộc
  nhiều collections. Việc thay membership chỉ thay bảng nối trong transaction.
- Public: `/bo-suu-tap`, `/bo-suu-tap/[slug]`, `/mon-hoc/[slug]`,
  `/khoi-lop/[grade]`, `/kham-pha`. Collections và membership public chỉ trả tài
  liệu published thuộc loại đang sử dụng; môn browse chỉ hiện môn active.
- API: `/api/subjects`, `/api/collections`, `/api/collections/[slug]`; mutation
  qua `/api/admin/subjects[/id]`, `/api/admin/collections[/id]` yêu cầu Admin và
  same-origin. Không thêm menu loại cứng Kỹ năng sống/Bài giảng điện tử.

## Discovery và search

- `/admin/discovery` quản lý các nhóm homepage qua site settings: collections,
  khối, môn, gợi ý; tối đa 6 collection IDs được chọn. Public chỉ hiển thị nhóm
  được bật và nội dung published. Không gọi Storage listing trên homepage.
- `/tim-kiem` và `/api/library` dùng URL shareable: `q`, `type`, `grade`, `subject`
  (slug), `topic`, `tag`, `sort`, `page`. `class_level` cũ vẫn được đọc làm alias
  cho grade. Filter/sort có trong URL để Back/Forward và reload giữ trạng thái.
- Sort: `relevance`, `newest`, `views`, `likes`, `az`; `popular` cũ tiếp tục dùng.
  Phân trang tối đa 100 items/request. Sách mới/thịnh hành vẫn loại video/album;
  global search giữ các loại media hợp lệ.
- Migration v4 thêm normalized Vietnamese `search_text`, trigger cập nhật,
  GIN `pg_trgm` index và `library_search_daily`. Không dùng dịch vụ search trả phí.
  Chuỗi tìm kiếm được normalize dấu/đ, escape wildcard SQL và dùng bind parameters.
- Autocomplete `/api/search/suggestions?q=...`: tối thiểu 2 ký tự, tối đa 120;
  published-only, debounce ở client, rate budget/cache có giới hạn ở server.
  Endpoint có thể trả 429/503 rõ ràng thay vì tạo workload DB không giới hạn.

## Search analytics và Admin insights

- `/api/search/analytics` chỉ nhận JSON same-origin ≤2 KiB. Backend tự tính
  result count; caller không tự khai zero results. Client/search lỗi analytics
  không làm mất chức năng tìm kiếm.
- Counter aggregate theo ngày/normalized query trong `library_search_daily`;
  không ghi IP, cookie, fingerprint hay từng sự kiện. Bỏ chuỗi trông giống email/
  số điện thoại; đây là lọc tối thiểu, không phải cam kết nhận diện mọi PII.
- Tối đa 1.000 query keys/ngày bằng transaction/advisory lock; counter bị chặn
  tăng vô hạn ở một tỷ/key/ngày. Prune các ngày ngoài cửa sổ 90 ngày tối đa mỗi
  giờ khi có search, từng batch 5.000 rows; không xóa dữ liệu tài liệu.
- `/api/admin/search-analytics` và `/admin/insights` là Admin-only: top queries,
  zero-result queries, xu hướng ngày; dashboard hỗ trợ khoảng 7/30/90 ngày.
  Dashboard giữ contract cũ và thêm `insights`: số lượng theo loại, tổng/recent
  views, top/new items, pending/approved/ready/borrowed/overdue/returned,
  pending comments, Storage usage và trạng thái kết nối DB.
- Dashboard cache 30 giây; Storage SQL aggregate cache 5 phút, không HTTP listing.
  Đo dung lượng lỗi hiển thị unavailable, không giả thành 0%. Không có bộ đếm
  người online giả hoặc tracking session học sinh.

## Related, QR, share và dữ liệu trên thiết bị

- Related dùng subject/grade/topic/tag/type deterministic, bỏ self, chỉ published,
  tối đa 6; không gọi AI API. Thumbnail tiếp tục theo đúng loại media.
- QR đã cài `qrcode`. `/api/library/[id]/qr` sinh SVG; `?format=png` trả PNG.
  Backend đọc published item rồi encode canonical URL qua helper hiện có, không
  chấp nhận URL tùy ý, không redirect ngoài và không ghi QR vào Storage.
- Detail có modal QR native dialog, tải PNG, copy URL và Web Share API nếu có;
  fallback copy/select URL vẫn dùng được. QR/title/link dùng cùng canonical URL.
- `/da-luu` dùng localStorage: saved tối đa 100 IDs, recent tối đa 20 IDs;
  không thêm account hoặc lịch sử đọc phía server. Có xóa recent/remove saved;
  storage bị chặn/hỏng được xử lý an toàn.
- `/api/library/selection?ids=...` chỉ trả published active-type records, tối đa
  100 IDs và giữ thứ tự. Tài liệu bị ẩn/xóa không lộ qua danh sách đã lưu; UI cho
  phép bỏ ID không còn truy cập được. Không lưu tên, SĐT hoặc email trong shelf.

## Mượn / trả và publication

```text
pending → approved → ready_for_pickup → borrowed → returned
pending → rejected / cancelled
approved / ready_for_pickup → cancelled
```

- Migration v5 thêm `request_code`, các timestamps liên quan và `borrow_events`.
  Mã `BR-` + 18 hex ngẫu nhiên không chứa ID tuần tự/PII. Existing code/requested_at
  được backfill; event migration chỉ ghi snapshot trạng thái hiện tại, không bịa
  lịch sử. Không tự chuyển approved cũ thành đã giao sách hoặc sửa stock cũ.
- Các thao tác khóa item rồi request trong transaction. Duyệt reserve một cuốn;
  ready/borrowed không trừ lần nữa; trả hoặc hủy reservation hoàn đúng một cuốn.
  Lặp cùng transition không đổi stock/ghi trùng audit. Transition sai trả 409.
- Khi giao sách, hạn trả mặc định 14 ngày; Admin có thể chọn ngày tương lai trong
  vòng một năm. Date-only nghĩa cuối ngày học theo giờ Việt Nam. Overdue chỉ là
  derived state khi status borrowed và due_at đã qua, không sửa lịch sử status.
- Admin tìm theo request code, xem timeline/actor và thao tác từng bước; không
  đưa thông tin người mượn vào QR. Borrow QR được defer vì chưa cần cho luồng hiện tại.
- Publication: `draft / review / published / archived`, single-admin; review là
  lựa chọn quy trình, không bắt buộc thêm tài khoản người duyệt. Admin có thể save
  draft, submit review, publish, archive và republish. Default create published
  được giữ để tương thích client cũ; public endpoints luôn chỉ đọc published.
- Publish ebook/audio/video cần file, album cần gallery; album không có cover
  riêng. Audit giữ actor/time/fromStatus/action; optimistic status guard trả 409
  khi status thay đổi giữa đọc và ghi. Republish giữ published_at đầu tiên.

## Migration, backup và rollback

1. Lấy fresh encrypted backup production và verify/restore drill theo Operations
   trước khi migrate. Không đổi `.env.local`, không bật `AUTO_MIGRATE` production.
2. V3 catalog → v4 search → v5 borrow chạy additive/idempotent trong transaction
   với advisory lock. Release runner dùng `beforeMigration(client)` để lock
   baseline tables và chụp digest chỉ các cột cũ; `afterMigration(client)` so
   counts/digests trên cùng transaction **trước COMMIT**. Invariant lỗi phải
   rollback cả schema/version writes; replay version mới nhất không gọi hooks.
   V3 không rewrite published records. V5 đã có default mã ngẫu nhiên cho legacy
   borrow INSERT không gửi request_code; old approved/stock vẫn được giữ nguyên.
3. V4 cần `pg_trgm`, có thể nằm trong schema `extensions` của Supabase. Backup
   public schema vẫn chứa các function `thd_search_normalize(text)` và
   `thd_library_search_update()`, trigger/indexes; không dump đè managed schemas.
4. Manifest DB v1 thêm optional `extensions` allowlist pg_trgm + schema thực tế.
   Legacy manifest không có field vẫn đọc được. Isolated Docker restore provision
   đúng schema/extension trước pg_restore, rồi verify. Tên extension/schema lạ
   hoặc input SQL không an toàn bị từ chối. Archive feature-era còn kiểm hai
   function public có trong TOC. Không coi archive readable là restore PASS.
5. Rollback giữ toàn bộ bảng/cột/data mới, không DROP/reset. Chọn image tương thích
   v5 và variables/cutoff hiện hành. Binary cũ không hiểu ready/borrowed; nếu buộc
   dùng lại thì tạm ngừng circulation writes và chuẩn bị roll-forward tương thích,
   không đổi status/stock để che lỗi. DB recovery là quy trình riêng trên target mới.

## Verification và release còn lại

Schema 2→3→4→5 và replay đã PASS trên **DB local mới cô lập**, gồm old-item/borrow
fields, indexes/RLS và Vietnamese normalization. Một DB cô lập mới khác còn chạy
thật checkpoint v2 → cố tình fail after-hook → chứng minh rollback về v2 → chạy
lại lên v5 → replay → old-writer INSERT default PASS. Dữ liệu fixture có đủ các
baseline tables, kể cả approved borrow/stock 0, session/comment/like/view; DB được
giữ lại, không drop. Evidence ignored: `test-results/feature-local-db.json`,
`test-results/feature-migration-v5.json`, `test-results/feature-upgrade-from-v2.json`.
Runner reproducible: `tests/feature-upgrade-from-v2.mjs`, bắt buộc env local cô lập
và checkpoint schema v2 riêng. Không lấy các kết quả này làm bằng chứng production.

Catalog UI checkpoint đã click Admin metadata/subjects/collections/reorder,
public metadata/draft visibility, desktop/mobile/tablet và WebKit collection PASS
(`test-results/feature-catalog-browser-5b39ac21.json`). Các checkpoints unit trước
có 142/143 tests PASS; PostgreSQL integration là suite riêng, không cộng vào số
unit một cách tùy ý. Đây chưa phải quality gates của release cuối.

UI reader mới nhất đã PASS: saved/recent/QR/share/discovery/metadata, local render
các production assets PDF/audio/video/album; WebKit 390 PDF/QR/shelf PASS, không
uncaught errors (`test-results/feature-reader-browser.json`). Borrow UI cũng PASS
Chrome desktop/412 và WebKit 390: request/code/approve/ready/borrow/due/return,
timeline 5 events, stock 2→1→1→1→2, không overflow
(`test-results/feature-borrow-browser.json`). Đây là engine/viewport tests trên DB
cô lập, không phải điện thoại vật lý hay official-domain feature acceptance.

Pre-release backup checkpoint đã PASS encrypted checksum/decrypt/real isolated
restore 13 baseline tables, recovery key được lưu riêng trong ignored private
location (`test-results/feature-release-backup.json`). Đây là recoverable local
checkpoint, **không phải R2/off-site backup**. Release runner chỉ chấp nhận proof
trong 24 giờ và có recovery key; nếu hết hạn phải lấy/verify snapshot mới trước
migration. Không commit proof, credentials, recovery key hoặc artifacts.

Fresh checkpoint 2026-10-26 đã được restore vào **một Docker PostgreSQL mới cô lập**,
đối chiếu đủ manifest 13 bảng/counts/digests/indexes/constraints/nullability/sequences,
rồi chạy chính migration v2→v5 trên dữ liệu vừa restore. After-hook cố tình fail
chứng minh rollback về v2 cùng dữ liệu cũ; lần chạy tiếp lên v5 và replay đều PASS,
các cột cũ/counts/digests được bảo toàn. Evidence ignored:
`test-results/feature-restored-upgrade.json`; runner tracked
`tests/feature-upgrade-restored.mjs`. Đây khác với fixture tự tạo: dùng bản backup
production thật đã mã hóa, nhưng không kết nối/ghi production. Container riêng và
temporary plaintext đã được dọn; backup mã hóa/key gốc được giữ.

Final combined tsc/lint/build/full tests và Docker evidence sau thay đổi cuối
vẫn phải chốt. Production migration invariants, deploy đúng service, official
catalog/publishing/dashboard/browser regression và sitemap acceptance **đang chờ**.
Không thực thi script official acceptance trước khi release owner báo DEPLOY_READY.
Chưa có feature release/deploy hoặc official-domain feature acceptance mới.
Railway CLI cần đăng nhập lại trước thao tác release; checkpoint backup mới dùng
private runtime snapshot đã lưu, không giả nhận là vừa fetch variables authenticated.

## Vận hành, bảo mật và phần defer

- Storage baseline: 211 objects / khoảng 968.33 MiB; gần quota. Không upload QA
  lớn, không xóa 93 candidates khi chưa có approval riêng. QR/shelves không tạo
  Storage objects. Capacity safeguards/direct upload/legacy URLs được giữ nguyên.
- `/admin` và `/api` không index; sitemap thêm published collection/active subject/
  grade/discovery URLs. Canonical dùng official-origin helper hiện có; không đổi
  URL tài liệu cũ hoặc resubmit Search Console liên tục. Không claim Google index.
- New Admin mutations giữ authentication, same-origin, validation và audit. Không
  thêm secret ra browser. Public PDF.js/audio/video/gallery và Range phải rerun
  trong regression cuối; chưa claim lại PASS chỉ từ code review.
- Fresh dependency review 2026-10-26 phát hiện advisories mới của Next 16.3.8;
  root đang nâng Next và matching eslint-config-next lên 16.4.3. Post-upgrade
  audit/gates còn chờ, không dùng báo cáo production 0 findings cũ làm PASS hiện
  tại. Dev braces advisory cũ cũng cần đối chiếu lại chain/count sau nâng cấp.
  Không downgrade framework hoặc dùng audit-fix-force; xem
  [DEPENDENCY-SECURITY.md](DEPENDENCY-SECURITY.md).
- Deferred optional: PWA, theme/dark mode, trang QR print riêng và borrow QR.
  QR PNG download đã có; các mục defer không cản core acceptance.
