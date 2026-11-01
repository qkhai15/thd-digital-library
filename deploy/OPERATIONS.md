# Vận hành thư viện số THPT Trần Hưng Đạo – Thanh Xuân

Cập nhật: 2026-10-26. Đây là runbook vận hành hệ thống production hiện có,
không phải hướng dẫn tạo lại project. Không ghi mật khẩu, connection string,
token, cookie hoặc nội dung chứng chỉ riêng vào tài liệu/log/Git.

## Hệ thống và người phụ trách

| Thành phần | Giá trị / trách nhiệm |
|---|---|
| Website chính thức | https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn |
| Railway project | `9aac172f-fc85-4cf1-a72c-7b9e91051382` |
| Railway web service | `02f7616f-5a1f-4522-b85b-e577d46424b6`, environment `production` |
| Runtime | Next.js trong Docker, Singapore, một replica, 1 GB RAM / 1 vCPU |
| Database | Supabase PostgreSQL hosted, Session Pooler, TLS `verify-full`; `AUTO_MIGRATE=false` |
| Storage | Supabase: public `thd-library`, private `thd-library-quarantine` |
| DNS | ZoneDNS / Nhân Hòa; giữ nguyên CNAME/TXT Railway đã hoạt động |
| Chủ website / nội dung | `[Tên, email nội bộ, điện thoại]` |
| Người vận hành Railway/Supabase/backup | `[Tên, email nội bộ, điện thoại]` |
| Người quản trị DNS / Google | `[Tên, email nội bộ, điện thoại]` |
| Người thay thế khi có sự cố | `[Tên, cách liên hệ]` |

Production không phụ thuộc máy cá nhân, VS Code, Docker Desktop, local PostgreSQL,
tunnel hoặc `public/uploads`. Railway không có volume dữ liệu persistent. Đường
dẫn `/uploads/...` cũ tiếp tục resolve tới Supabase; không đổi URL DB khi dọn dữ liệu.

## Kiểm tra thường xuyên và cảnh báo bên ngoài

Mỗi ngày xem email cảnh báo, kết quả backup gần nhất và `/api/health`. Mỗi tuần
xem Railway memory/restarts, dung lượng DB/Storage, lỗi upload và backup Storage.
Mỗi tháng kiểm tra một bản backup tải từ kho ngoài và diễn tập restore cô lập.

`GET /api/health` chạy kiểm tra DB/schema, trả 200 với `ok:true` khi hoạt động,
500 với thông báo chung khi DB lỗi; không ghi dữ liệu, không trả connection string.
Startup còn kiểm tra TLS thực tế và bucket public/private. Health không xác nhận
toàn bộ object Storage: khi cần, mở một ảnh/PDF có sẵn và kiểm tra Range 206.
Probe production trong lượt này: HTTP 200, khoảng 304 ms, `Cache-Control: no-store`;
đây là một mẫu đo, không phải cam kết latency.

Tạo **hai HTTP(S) monitors** trong tài khoản UptimeRobot hoặc dịch vụ tương đương:

| Tên | URL | Cấu hình |
|---|---|---|
| THD website | https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn/ | GET, mỗi 5 phút, mong đợi HTTP 200 |
| THD app + DB | https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn/api/health | GET, mỗi 5 phút, mong đợi HTTP 200 |

Chọn email operator và bật cả DOWN lẫn RECOVERED; xác minh email và gửi thử thông
báo bằng tính năng của nhà cung cấp, không cố tình tắt production. Không cung cấp
Admin credentials cho monitor. Chưa có tài khoản monitor kết nối để cấu hình trong
lượt này; operator cần thực hiện bước tạo monitor.
[UptimeRobot hỗ trợ HTTP monitors](https://help.uptimerobot.com/en/articles/11358441-understanding-uptimerobot-monitor-types-a-guide-to-essential-services)
và [Free có khoảng kiểm tra 5 phút](https://help.uptimerobot.com/en/articles/11360876-what-is-a-monitoring-interval-in-uptimerobot).

Railway chỉ dùng `/api/health` để quyết định chuyển traffic khi deploy; không probe
liên tục sau deploy. Vì vậy monitor ngoài là cần thiết.
[Railway healthchecks](https://docs.railway.com/deployments/healthchecks).

## Railway logs, restart và rollback

Mở đúng project → web service → Deployments → deployment đang active → Logs.
Xem Metrics cho RAM/CPU/restarts. Đối chiếu thời điểm UTC, deployment ID và mã lỗi;
không copy Variables hoặc cookie vào ticket. Cấu hình đã dùng: healthcheck 120 giây,
`ON_FAILURE` tối đa ba lần, sleep tắt, port do Railway cấp (hiện 8080). Giữ 1 GB:
measurement production trước đây khoảng 236–286 MB peak, chưa có evidence cần tăng.
Số đo này không phải cam kết tải đồng thời.

Nếu tiến trình bị kẹt nhưng cấu hình đúng, chọn Restart deployment hiện tại; xác
nhận health và đăng nhập lại. Wrapper chuyển SIGTERM/SIGINT tới Next.js và phân
biệt shutdown chủ động với crash; không kill/restart liên tục để che lỗi dependency.
Sau ba crash liên tiếp, điều tra logs và cấu hình. [Restart policy](https://docs.railway.com/deployments/restart-policy).

**Rollback có thể khôi phục cả variables cũ**, không chỉ image. Trước khi chọn
Deployments → bản tốt → Rollback, xác nhận snapshot không đưa lại password/key đã
revoke, `SESSION_SECRET` cũ, cutoff thấp hơn, DB local hoặc Storage local. Nếu
variables cũ không còn an toàn, deploy source/image tương thích đã kiểm chứng với
**variables production hiện hành** thay vì blind rollback. Không hạ
`ADMIN_SESSION_NOT_BEFORE`. Khả năng Rollback phụ thuộc thời hạn giữ image của plan;
Redeploy bản cũ cũng có thể dùng cấu hình cũ. Xem [Railway rollback](https://docs.railway.com/guides/roll-back-bad-deploy).

Không restore DB để rollback một lỗi giao diện. Sau rollback/redeploy kiểm tra
homepage, health, login/session/logout, tìm kiếm, một PDF/ảnh và một thao tác Admin
được phép. Giữ hosted DB/Storage và dữ liệu mới. Schema/data recovery là thao tác
riêng, phải backup trước và diễn tập trên target mới.

### Nâng schema feature v3 / v4 / v5

Feature upgrade hiện còn chờ release; xem trạng thái và contracts ở
[FEATURES.md](FEATURES.md). Không suy ra production đã dùng schema mới từ việc
DB cô lập PASS. Giữ `AUTO_MIGRATE=false` và TLS `verify-full`.

Trước rollout: fresh DB backup → verify/isolated restore → ghi counts/IDs/stock/
old fields → chạy migration additive v3 catalog, v4 search, v5 circulation →
đối chiếu invariants/replay → deploy đúng web service → smoke official domain.
Release runner kiểm backup proof trong 24 giờ, checksum/decrypt/isolated restore
PASS và recovery key còn đọc được; checkpoint cũ hết hạn phải lấy lại. Private
proof/key/dump ở ignored location không được commit hoặc thay kho backup ngoài.

Migration hooks chụp baseline columns/counts/digests sau khi lock các application
tables; after-hook so sánh trong **cùng transaction trước COMMIT**. Lỗi invariant
rollback schema/version writes. Existing-row data không bị sửa để làm check PASS.
Replay schema hiện tại không chạy hooks; release preflight vẫn phải kiểm riêng.
Không seed nội dung demo hoặc đổi status public cũ. Legacy borrow writer không
gửi request_code được hỗ trợ bằng database default BR-random; đã test trên fresh
DB cô lập v2→v5, cả rollback khi invariant fail và replay. Schema mới phải sẵn
sàng trước khi image mới kiểm health/version 5. Production chưa được migrate chỉ
vì rehearsal PASS; xem kết quả release thực tế riêng.

Diễn tập release 2026-10-26 đã dùng fresh encrypted production backup restore vào
Docker PostgreSQL mới, verify đủ 13 baseline tables rồi chạy v2→v5 trên chính bản
restore, bao gồm after-hook fail/rollback về v2 và rerun/replay v5. Counts/digests
các cột cũ, indexes/constraints/sequences PASS; không kết nối hoặc ghi production.
Private evidence: `test-results/feature-restored-upgrade.json`; script
`tests/feature-upgrade-restored.mjs`. Chỉ container riêng/temp plaintext được dọn.
Checkpoint này không thay R2/off-site backup hoặc official-domain acceptance.
Railway login và cấu hình đang active phải được xác nhận lại trước release thật;
không suy ra từ saved private runtime snapshot của lần backup.

V4 cần extension `pg_trgm` đúng schema thực tế (Supabase thường là `extensions`).
`pg_dump --schema=public` giữ application functions/triggers/indexes; không chứa
toàn bộ managed extension schema. Manifest DB v1 có optional `extensions` chỉ
allowlist pg_trgm/schema an toàn. Restore Docker mới cô lập tự provision extension
trước pg_restore rồi đối chiếu schema; old manifest không có field vẫn đọc được.
Feature-era archive validation kiểm các function public của search có trong TOC.
Khi restore thủ công lên **target recovery mới**, provision pg_trgm trong đúng
schema ghi ở manifest trước khi restore public dump; không ghi đè managed schemas.

Rollback giữ dữ liệu/bảng/cột mới; ưu tiên image tương thích v5. Binary cũ không
hiểu `ready_for_pickup`/`borrowed`, nên không dùng nó để xử lý circulation mới;
tạm ngừng writer nếu cần và roll forward bản tương thích. Không đổi status/stock,
DROP cột/bảng hoặc restore DB cũ chỉ để rollback UI.

## Checklist xử lý sự cố

| Sự cố | Làm theo thứ tự |
|---|---|
| Website DOWN | Kiểm tra cả hai monitor và HTTPS từ mạng khác; xem Railway active deployment/logs/metrics; xem Supabase status/project có paused không; xác định deploy/variables vừa đổi; restart một lần nếu runtime kẹt hoặc rollback an toàn; xác minh RECOVERED. |
| DB connection lỗi | Xem mã lỗi an toàn trong logs; Supabase project đang active; Session Pooler host/port/user đúng; secret Railway còn hiệu lực; CA còn hạn và TLS `verify-full`; kiểm tra connection budget với `DB_POOL_MAX=5`; không tắt SSL, không reset DB. |
| Storage đầy / upload lỗi | Dừng nhập media lớn; xem Usage của organization và báo cáo inventory; kiểm tra cả public/quarantine, pending intents, per-file cap; không tự xóa; backup trước, xin duyệt đúng bucket/path rồi mới cleanup; giữ file cũ khi replace lỗi. |
| SSL/domain lỗi | So sánh DNS ZoneDNS/Nhân Hòa với custom-domain records trên đúng Railway service; kiểm tra ownership/TLS status, CNAME và TXT, target port; không sửa MX/DNS trường khác; không bỏ qua certificate verification. |
| Backup thất bại | Xem mã lỗi ngắn; kiểm tra R2/S3 quyền, quota và keyvault; kiểm tra TLS/pg_dump version; chạy lại thủ công; báo operator nếu quá 24 giờ không có DB backup verified; không xóa bản tốt cũ để lấy chỗ. |

Ghi incident: thời điểm, triệu chứng, deployment, thay đổi gần nhất, biện pháp và
kết quả. Không ghi secret. Nếu chưa giải quyết được, chuyển người thay thế và
provider support kèm logs đã lọc.

## Storage capacity và cleanup

Inventory đầy đủ và từng candidate ở [STORAGE-CLEANUP-REPORT.md](STORAGE-CLEANUP-REPORT.md).
Mọi report là **dry-run**, không phải quyền xóa. Phải kiểm tra cả bản ghi archived,
news, banner, gallery, legacy URL và upload intents. Orphan hoặc trùng size không
chứng minh file vô dụng/trùng bytes; unknown luôn giữ. Không xóa test artifacts
nếu chưa có approval rõ bucket/path.

- Warning từ 70% budget; critical từ 85%. Inventory 2026-10-15: **210 objects,
  1,015,368,229 bytes / 968.33 MiB**, 94.56% budget 1 GiB, vùng critical. Có 93 QA
  candidates không còn current-content reference, khoảng 233.15 MiB để operator
  xem xét; chưa được xóa. Nếu sau này duyệt và dọn toàn bộ 93 candidates, ước tính
  còn khoảng **735.18 MiB**, không phải dung lượng đã reclaim. Không upload QA lớn.
  Post-release smoke chỉ thêm một PNG 136 bytes được giữ lại: hiện **211 objects**,
  dung lượng vẫn làm tròn **968.33 MiB**. Snapshot 210 objects trong report được giữ.
- `STORAGE_CAPACITY_LIMIT_BYTES`: budget vận hành tập trung (mặc định 1 GiB).
  `STORAGE_CAPACITY_HEADROOM_BYTES`: khoảng dự phòng (mặc định 1 MiB). Đây là budget
  application, không thay quota hay số Usage do Supabase tính cho organization.
- Upload Admin kiểm tra budget/pending reservation; không scan Storage trên mọi
  public request. Thiếu chỗ phải báo lỗi rõ ràng, giữ dữ liệu/file cũ. Direct upload
  cần chỗ cho cả private source và public copy; kiểm tra không phải phép khóa quota
  tuyệt đối nếu ngoài ứng dụng vẫn có writer khác, multipart chạy song song hoặc
  signed upload vẫn còn hiệu lực sau khi reservation hết hạn. Provider vẫn là
  nơi enforce quota cuối cùng.
- Media cap hiện hành 50 MiB qua `UPLOAD_MEDIA_MAX_MIB=50`, bucket thực tế
  52,428,800 bytes; images có cap nhỏ hơn theo upload policy. Không tăng chỉ vì
  signed/resumable hỗ trợ file lớn. Provider gọi giới hạn Free là 50 MB; lấy số byte
  thực tế nhỏ nhất của global/bucket/app làm hiệu lực.

[Supabase Storage quota](https://supabase.com/docs/guides/storage/pricing)
và [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits).

## Backup độc lập và cách chạy

Kho backup phải là **private R2/S3-compatible bucket riêng**, ngoài Supabase và
không public domain. Cấp S3 API token phạm vi bucket, không cấp quyền quản trị
account; tránh lifecycle/autodelete trước khi retention được duyệt. Với R2, region
là `auto`; endpoint lấy từ account thực tế, không đoán.
[R2 S3 setup](https://developers.cloudflare.com/r2/get-started/s3/).

Chuẩn bị sáu biến tại **Railway Project Settings → Shared Variables → Environment
`production`**. Chưa share/map vào web service; sau khi tạo đúng một backup cron,
chỉ reference vào backup service bằng `${{ shared.TEN_BIEN }}`. Không gửi values
qua chat. [Railway shared variables](https://docs.railway.com/variables#shared-variables).

| Variable | Mục đích |
|---|---|
| `BACKUP_S3_ENDPOINT` | HTTPS endpoint thật của R2/S3 |
| `BACKUP_S3_REGION` | Region; R2 dùng `auto` |
| `BACKUP_S3_BUCKET` | Bucket backup private |
| `BACKUP_S3_ACCESS_KEY_ID` | Credential giới hạn bucket |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Secret tương ứng |
| `BACKUP_ENCRYPTION_KEY` | 32 random bytes dạng base64 chuẩn hoặc 64 ký tự hex; giữ thêm bản trong vault độc lập |

Kiểm tra Railway authenticated trong lượt này: cả sáu biến backup bên trên chưa
được cấu hình. Chưa tạo cron service khi còn thiếu credentials; không nhân bản web
service. Đây là bước operator còn phải làm, không phải lỗi website.

Nguồn: `DATABASE_URL` production, `DB_SSL_CA_BASE64` hoặc `DB_SSL_CA_FILE`,
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET`. Không cần
`ADMIN_PASSWORD`/`SESSION_SECRET` trong backup worker. `PG_BIN` tùy chọn khi cần
chọn client PostgreSQL phù hợp server; `BACKUP_ENV_FILE` chỉ định file operator
riêng khi chạy thủ công, không tự sửa `.env.local`. Receipt/keyvault không phải
đường dẫn dữ liệu website. Không chạy command dump với password trong arguments.

```text
npm run ops:backup:db
npm run ops:backup:storage
npm run ops:backup:all
npm run ops:backup:verify
npm run ops:restore:dry-run
```

Scripts dùng `pg_dump` custom compressed cho application schema/data, TLS
`verify-full`, UTC timestamp/unique run key, SHA-256 và manifest. Dumps, manifests
và asset bytes được mã hóa AES-256-GCM **trước** khi gửi sang S3; receipt chỉ chứa
metadata ciphertext/checksum/backup keys. Không dump các schema Supabase quản lý
để restore đè nền tảng. Backup Storage lấy manifest tất cả objects, giữ production
references/unknown; chỉ bỏ known test khi có evidence chắc chắn, không dựa tên.
Các content hashes cho phép copy incremental, không xóa bản backup khi source mất.
Manifest mã hóa giữ mapping bucket/path gốc tới encrypted object key xác định theo
content hash; restore giữ nguyên path/URL cũ. Download nguồn dùng authenticated
Storage endpoint, không phụ thuộc public bucket URL. Unknown/orphan vẫn được backup.

Giữ `BACKUP_ENCRYPTION_KEY` trong password manager/vault có người thay thế truy cập.
Mất khóa sẽ không decrypt được; không chỉ giữ cùng account với bucket. Backup
có dữ liệu học sinh và session hashes: hạn chế người đọc, không public/download
đến web root. Artifact/receipts local ở thư mục ignored không thay kho ngoài.
Nếu cần đổi encryption key, giữ các phiên bản cũ trong vault theo `keyId` của
receipt đến khi mọi backup dùng khóa đó hết retention; không ghi đè khóa rồi bỏ
khóa cũ. Restore phải dùng đúng phiên bản và verify trước khi cutover.

## Lịch, retention và kiểm chứng restore

Chuẩn bị **một dedicated backup cron service** trong project hiện có, không nhân
bản web service. Lịch đề xuất `15 19 * * *` UTC = **02:15 giờ Việt Nam ngày kế
tiếp**. Job daily backup DB; lượt Chủ nhật theo giờ Việt Nam đồng thời chạy Storage
incremental (đêm thứ Bảy UTC). Job đóng DB/HTTP connections và exit sau khi xong,
không mở Next.js, không chạy web healthcheck. Nếu lượt trước chưa kết thúc Railway
có thể bỏ qua lượt sau. Chưa coi lịch active khi chưa thấy run thành công.
[Railway cron UTC/exit requirements](https://docs.railway.com/cron-jobs).
Image/config đã chuẩn bị: `deploy/Dockerfile.backup` và
`deploy/railway-backup-service.json`; command `node scripts/ops-backup.mjs scheduled`,
restart `NEVER`, không HTTP server. Map sáu biến backup qua `${{ shared.NAME }}`;
reference `DATABASE_URL`, CA, `SUPABASE_URL`, server-only Storage key và bucket từ
web service hiện có. Không copy ADMIN_PASSWORD/SESSION_SECRET sang worker. Chưa
tạo/kích hoạt cron khi credentials thiếu; backup Docker image build/preflight PASS.

Retention **đề xuất**, chưa xóa tự động: 7 DB daily gần nhất, 4 weekly, 3 monthly;
một snapshot có thể thuộc nhiều nhóm. Giữ manifests/assets cần bởi mọi snapshot
còn lưu. Chỉ bật pruning sau khi đã kiểm thử không xóa bản được tham chiếu, có
inventory dry-run và approval riêng. Không cấu hình lifecycle xóa tùy ý trong R2.

`ops:backup:verify` tải bản mã từ kho ngoài, decrypt/authenticate và kiểm SHA-256,
manifest/expected tables. `ops:restore:dry-run` mặc định kiểm tra cấu trúc/readability,
không ghi production. **Archive readable không chứng minh restore thành công.**
Đặt `BACKUP_RESTORE_DOCKER=true` trong môi trường operator có Docker để dry-run
restore vào container mới cô lập, so row counts/digests/indexes/constraints; tuyệt
đối không cung cấp production target cho diễn tập. `BACKUP_RECEIPT_KEY` chọn receipt
trên S3 hoặc `BACKUP_RECEIPT_FILE` chọn receipt local. Không ghi nhận restore DONE
cho đến khi có kết quả diễn tập thật; R2 credentials/scheduler chưa được xác nhận
thì trạng thái external backup là **PREPARED / MANUAL ACTION REQUIRED**.

Diễn tập thật ngày 2026-10-16 đã PASS với `ops:backup:rehearse`: fresh hosted DB
snapshot read-only/TLS verify-full → compressed dump → AES-GCM → đọc lại/checksum/
decrypt → restore vào PostgreSQL Docker mới cô lập. Đối chiếu đủ 13 bảng theo row
count/SHA-256 với collation C, indexes, constraints, sequences và NOT NULL. Không
ghi production. Khóa diễn tập chỉ nằm trong RAM rồi bị bỏ; encrypted fixtures
ignored không phải backup lâu dài có thể khôi phục. R2 upload/verify vẫn PENDING.
Storage verify được test với encrypted local-target fixtures, gồm tamper/unknown/
exclusion/dedup; chưa claim đã copy production assets ra kho ngoài.

Operator chọn receipt DB/Storage riêng bằng `BACKUP_RECEIPT_KEY` hoặc
`BACKUP_RECEIPT_FILE`, chạy `ops:backup:verify` cho từng receipt. Để diễn tập restore
DB thực, đặt `BACKUP_RESTORE_DOCKER=true` rồi chạy `ops:restore:dry-run` trên máy
có Docker; không đưa Docker socket hoặc production restore target vào Railway cron.

## Disaster recovery

Mục tiêu nội bộ: DB **RPO ≤24 giờ khi daily backup đã chạy và verified**;
**RTO 2–4 giờ** cho quy mô hiện tại nếu operator, credentials và target sẵn sàng.
Storage weekly có RPO tối đa 7 ngày; chạy `ops:backup:storage` sau đợt nhập tài liệu
quan trọng để giảm khoảng mất file. Đây là mục tiêu, không phải SLA provider.

1. Khoanh vùng lỗi và tạm ngừng writer nếu cần cutover; giữ DB/Storage hiện tại,
   lấy backup mới nếu nguồn còn đọc được. Chọn DB và Storage snapshots cùng giai
   đoạn; không rollback mù dữ liệu mượn/trả mới.
2. Dùng vault lấy encryption key; tải receipt/ciphertext từ kho ngoài; verify,
   decrypt và restore vào PostgreSQL **mới cô lập**, đúng major/client phù hợp.
3. Kiểm đầy đủ application tables theo manifest (baseline cũ có 13 bảng; feature
   upgrade thêm catalog/search/borrow tables), schema version, IDs, row counts/digests,
   sequences/indexes/constraints và RLS/grants. Không restore đè auth/storage
   managed schemas. Chi tiết [DATABASE-MIGRATION.md](DATABASE-MIGRATION.md).
4. Tạo bucket public/private đúng mode/cap trên recovery target; decrypt assets,
   upload original UUID paths với no-overwrite; đối chiếu size/hash/manifest;
   đối chiếu legacy paths và upload intents. DB dump không chứa bytes Storage.
5. Test app với recovery target: health/TLS, login, search, ảnh/PDF Range,
   comments, borrow/stock. Sau phê duyệt cutover mới cập nhật Railway variables
   nguồn target; giữ canonical/DNS nếu không đổi Railway. Vô hiệu session phục
   hồi bằng cutoff mới và giữ secret production an toàn; không khôi phục cookie cũ.
6. Smoke official HTTPS, bật lại writer, theo dõi alert và lấy backup baseline
   mới. Giữ nguồn cũ và incident log đến khi đối soát xong; không tự xóa.

## Security và Google

Làm theo [SECRET-ROTATION-CHECKLIST.md](SECRET-ROTATION-CHECKLIST.md); chỉ ghi
trạng thái/UTC/owner, không values. Không rotate provider credentials đồng loạt
hay rotate DB khi chưa có maintenance plan. Không commit production env/dumps/
private cert; không dùng `NEXT_PUBLIC_` cho secrets.

Fresh feature dependency review 2026-10-26 phát hiện advisories mới của Next 16.3.8;
Next/matching lint config đang được nâng lên 16.4.3, phải audit và chạy lại quality
gates sau nâng cấp trước release. Không coi production audit 0 findings trước đó
là kết quả hiện tại. Dev-only braces chain cũ cũng phải đối chiếu lại; xem
[DEPENDENCY-SECURITY.md](DEPENDENCY-SECURITY.md). Không downgrade framework, dùng
audit-fix-force hoặc claim audit sạch khi chưa có kết quả mới.

Domain property Search Console, sitemap và yêu cầu lập chỉ mục homepage đã được
operator xác nhận. Không khẳng định Google đã index. Giữ sitemap/robots HTTP 200,
canonical official domain; `/admin` và `/api` không index. Dùng tài khoản Google
được trường cấp để theo dõi Pages/Sitemaps, không cần submit lại mỗi lượt vận hành.

## Rủi ro Free plan

Supabase Free hiện có **1 GB Storage**, **500 MB database** và giới hạn upload
**50 MB/file** theo tài liệu; dung lượng cả public/private và các project trong
organization cần xem Usage. Không suy ra quota còn lại chỉ từ cap một file.
[Supabase billing limits](https://supabase.com/docs/guides/platform/billing-on-supabase).

Free có thể bị pause khi ít hoạt động trong 7 ngày; theo dõi email owner và Resume
trong Dashboard khi cần. Không tạo artificial traffic để né pause. Paid plan là
tùy chọn vận hành nếu cần tránh pause, không tự nâng cấp.
[Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

Không dựa vào downloadable automatic backups trên Free. Supabase khuyến nghị
Free tự export/off-site; automatic daily backups được mô tả cho paid plans.
DB backup không chứa Storage object bytes. Kho backup ngoài và diễn tập restore
là bắt buộc cho mục tiêu RPO/RTO ở trên.
[Supabase backups](https://supabase.com/docs/guides/platform/backups).

## Việc cần operator hoàn tất

Implementation verification 2026-10-16: tsc/lint/build và 106 automated tests PASS;
backup image build/preflight PASS; real isolated DB restore PASS. Web release
`5944c52f-9bba-49b3-8697-bf13ba3a1ef3` SUCCESS trên đúng service. Official-domain
Chrome smoke PASS: homepage/health, login/reload, Secure/HttpOnly cookie, tiny
upload 201/decode, real PDF canvas/Range 206, direct-upload auth/CSRF, capacity
507 trước token/file bytes, logout invalidates replayed cookie. `/api/health`
đo ngoài khoảng 276 ms; restart/region/RAM giữ nguyên. Một lượt test ảnh trước đó
đọc naturalWidth quá sớm; lượt tiếp theo chờ decode và dùng lại đúng object đã
upload, không upload thêm. Không đổi `.env.local` hoặc rotate provider secrets.
External provider check cả web và production Shared Variables: **MISSING_CONFIG**
cho sáu BACKUP variables; chưa tạo cron hoặc bật monitor ngoài.

1. Tạo bucket R2/S3 private, token bucket-scoped và cấu hình sáu Variables backup
   bên trên tại Project Settings → Shared Variables → `production`; chưa share
   vào web. Sau khi operator xác nhận đã sẵn sàng mới tạo/map một backup cron.
   Không gửi credentials vào chat.
2. Chạy backup ngoài + verify + isolated restore drill thành công, rồi kích hoạt
   lịch daily/weekly và kiểm tra lần chạy đầu. Giao rõ người nhận cảnh báo backup.
3. Tạo hai HTTP monitors 5 phút, email DOWN/RECOVERED; xác minh nhận thông báo.
4. Ghi owner/ngày rotate cho secrets còn UNKNOWN theo checklist; cleanup Storage
   chỉ sau khi có backup verified và approval bucket/path cụ thể.
