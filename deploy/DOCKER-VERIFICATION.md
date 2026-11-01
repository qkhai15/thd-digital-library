# Railway Docker verification — 2026-10-14

## Current production evidence

Local Docker build/runtime and actual Railway public HTTPS HTTP/API plus real Chrome
desktop/mobile regression: **PASS**. Production uses hosted Supabase PostgreSQL with
verified TLS, public Storage plus private upload quarantine, `AUTO_MIGRATE=false`
and Free-plan media limits. The final rebuilt image's Railway deployment
`181babed-82c5-4ac2-8164-3f641b4bf9ff` succeeded, remote digest
`sha256:d422b6bbf95a500b574f55c1b0e08bb6c8e841d6cd883b9fda859e8ef862640b`.
Final read-only Chrome/auth confirmation also passed. School-domain DNS/certificate
were verified on 2026-10-15; Search Console remains a manual verification step. Current public service:
https://thd-library-production.up.railway.app.

- Final image evidence: `test-results/final-image-verification.json`.
- Latest verified local image: `sha256:abc181d2f3dd51e16ce0ec792d508932c47c0ad9ffd0976261a6046f85383577`.
- Actual Railway public HTTP/API evidence: `test-results/production-regression-12edf2c4-a76b-4b4c-88c6-44b58a6826f9.json`.
- Final-release HTTP/API evidence with local application servers stopped: `test-results/production-regression-fc85b53f-2556-4bb2-9da0-000210d7b3ed.json`.
- Public Chrome desktop/mobile evidence: `test-results/browser-production-7420df26-3083-4441-8f77-3c5ed349acf1/report.json`.
- Final public Chrome decode/layout evidence: `test-results/browser-smoke-5fa128ef-9561-49c3-b9f6-ae5d57e14e95/report.json`.
- Final public Chrome desktop/mobile auth/SEO evidence: `test-results/final-browser-auth-13c9c3c1-8edd-4b77-b052-d40992c5d79b/report.json`.
- Final edge/local-server independence evidence: `test-results/railway-final-edge-independence.json` (HTTP-to-HTTPS 301, health 200, robots/sitemap/Admin noindex; required school CNAME/TXT still ENOTFOUND).
- Earlier local HTTP/API evidence: `test-results/production-regression-7b3c54a1-bb9a-4537-8591-ade36af6f436.json`.
- Earlier local Chrome evidence: `test-results/browser-production-115c827e-cb3e-4240-b319-50a431806197/report.json`.
- Earlier direct-upload/memory evidence: `test-results/docker-verification-1791941977578.json`,
  image `sha256:5c5920d0c8936e161fe029c70f9e5722c6fba5242068d89b5705f907956f305f`.
- Container allocation: 1 GiB RAM / 1 CPU; uploads run sequentially.

Startup, `/api/health`, Supabase client TLSv1.3/`verify-full`, Admin login/session/logout,
Secure/HttpOnly cookies, 16 legacy upload URLs/images and PDF/audio/video Range requests
passed. The final image uses a separate production-only dependency stage; its app
filesystem scan checked **17,104 files** with no configured secret/private-file hits,
ESLint or TypeScript. `public/uploads` is absent. Sharp and a real static Next Image
optimizer request passed. Startup, actual shared JSON overflow `413`, hosted DB/Storage
preflight, public/Admin/SEO and login/session checks passed on this final image.
This is a final-filesystem scan,
not historical-layer forensic analysis. Secrets are supplied only at runtime.
The latest local image also passed graceful shutdown with exit code 0 and no OOM;
its disposable test container was stopped and removed. The startup wrapper now
requires an encrypted, certificate-authorized PostgreSQL client socket and logs a
safe TLS protocol PASS line. The final actual Railway startup at 2026-10-14 07:47:07
UTC logged `Production database TLS PASS: TLSv1.3`, passed both Storage bucket
preflights and started Next.js on port 8080. This is runtime socket evidence, not
just a verification connection or pooler backend statistic.

Signed direct TUS passed with video 16/32/48 MiB, PDF approximately 8 MiB and audio
8 MiB. File bytes went directly from the external test client to Storage; the app
handled signing/finalization metadata. Pause/HEAD-offset resume, recovery after a
successful Storage copy without a completed DB commit, hash checks, Range 206,
private-source protection, CORS, idempotency and upload-intent RLS passed. Metadata
for 50 MiB + 1 byte and 64 MiB was rejected before token creation or byte transfer.
Small JPEG multipart compatibility also passed. Both buckets remain capped at
52,428,800 bytes; no plan upgrade was made.
After the public HTTP/Chrome runs, a read-only inventory measured 125 public objects
(569,217,062 bytes) and 19 private objects (411,042,841 bytes), totaling **980,259,903
bytes / 934.85 MiB**. This is an operational capacity risk near the Free plan's
included 1 GB quota, not a failed per-file-size test or proof of a hard live-size
cutoff. Private/public retained copies both count toward size. Provider quota uses
billing-period GB-hours and grace policy, as explained in
[Supabase's Storage-size guide](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size).
The actual public tests had no quota errors. No files were deleted or plan upgraded;
do not repeat large QA transfers, and review usage/backups/authorized retention
before further large ingestion. The 50 MiB per-file policy remains unchanged.

The following local direct-upload and RAM measurements belong to the earlier image
above; large transfers were not repeated on the latest local rebuild to conserve
Free Storage quota. The real Railway HTTP regression separately repeated 32/48 MiB
TUS with resume, and Chrome repeated 16 MiB. Upload implementation/policy are unchanged.

| Phase | Peak sampled container memory |
|---|---:|
| Warm idle, five samples | 138 MiB |
| Small JPEG | 119 MiB |
| Video 16 MiB | 122 MiB |
| Video 32 MiB with resume/copy recovery | 123 MiB |
| Video 48 MiB | 124 MiB |
| PDF approximately 8 MiB | 124 MiB |
| Audio 8 MiB | 141 MiB |
| Whole Docker verification | 141 MiB |

Values are sampled container-total `docker stats`, not heap-only measurements or
capacity guarantees. Client byte buffers and hash downloads ran outside Docker.
GC/cache timing can put later samples below idle. Keep **1 GiB as the conservative
starting Railway allocation**, then monitor real traffic. Actual Railway metrics
over 30 minutes including HTTP/Chrome testing measured **235.58 MB peak / 234.28 MB
latest memory** and **0.0563 vCPU peak**. Those platform measurements are distinct
from the local container samples above and do not guarantee production capacity.
The actual service is capped at 1,000,000,000 bytes / 1 vCPU, one Singapore replica,
sleep disabled, restart ON_FAILURE with three retries and a 120-second healthcheck.

The actual Railway public HTTP/API regression passed **236 checks**: HTML/JSON login,
fresh signed sessions, expiry/cutoff/logout, Admin authorization/CSRF, all small
persistent-upload uses, document/news/wall CRUD, search, comment moderation,
likes/views, borrow/return, stock idempotency and audit history. All pre-existing
rows in **13 application tables** retained identical counts and SHA-256 content
fingerprints. Only manifest-owned newly-created UUID fixtures were DELETE-tested;
the new paper record with borrow history was archived, and uploaded objects were
retained. Existing application records and local files were not deleted.

The HTTP harness explicitly does not establish browser rendering/click results.
It skipped an existing published "other documents" detail because that category had no
published record. It did not run the opt-in real login-lockout threshold test in the
public run; a separate earlier actual lockout test and unit regressions cover the
shared limiter. Separate Google Chrome desktop/mobile testing passed **29 recorded
flows on the actual public Railway HTTPS service**:
real header/search/category/detail clicks, PDF/audio/video/gallery, Admin form
login/logout, all six active document types and file-picker uploads, early oversized
video refusal, likes/comments/borrow approval/return/stock, moderation, news/wall
forms, edit/archive and confirmation-based deletion of an owned disposable record.
It recorded no uncaught browser errors or failed network requests. It also created and verified its own
"other documents" fixture. Temporary QA documents/news were archived, the QA banner
hidden, and files/history retained. A separate public Chrome visual pass verified
24 decoded-image, video-frame and desktop/mobile layout checks. Historical local
HTTPS/simulated-header results remain useful local evidence but are not public-edge
proof; the public report paths above establish the current Railway evidence.

TypeScript, lint, build and **77 unit/regression tests** passed after the public
JSON-LD/startup socket-verification changes. The generated Railway domain initially
targeted 3000 and returned 502; targeting the actual PORT **8080** corrected it. The
custom school domain is registered on the same service and DNS/certificate activation
passed on 2026-10-15; Search Console is not yet verified. Off-site backup scheduling and external alerts
remain operator setup responsibilities, not already activated services. The post-QA cutoff was
refreshed without deleting sessions or changing stable production credentials. The
final public HTTP/API rerun passed **223 checks** with all pre-existing table counts/
hashes unchanged, after local Next.js/QA containers and application listener ports
3000/3103/3104/3105/3107 were stopped. No local app server or tunnel is required for
the real Railway service. Large uploads were not repeated in that final run to
conserve capacity; the same upload code already passed real public 16/32/48 MiB.
The final read-only Chrome visual rerun passed 24 checks. Fresh desktop/mobile Admin
auth/SEO passed 6 checks: real header/form POST login 303, authenticated session after
reload, Secure/HttpOnly/Lax cookie, logout with cookie removal/session false, and live
canonical/linked WebSite-School JSON-LD/logo. Zero browser errors were recorded.
Final source secret scan covered 211 files with zero configured-secret hits and
verified `.env.local` unchanged. Current upload details are in
[DIRECT-UPLOAD-FREE-VERIFICATION.md](DIRECT-UPLOAD-FREE-VERIFICATION.md).

## Historical server-forwarded run — 2026-10-13

Historical server-forwarded upload measurement. Signed direct upload has since been
implemented; see DIRECT-UPLOAD-VERIFICATION.md and DIRECT-UPLOAD-EVALUATION.md for the
current flow. The numbers and pending-work statements below describe that earlier run.

Local Linux Docker build and runtime passed. No Railway deployment or DNS change.
Image was built with deploy/Dockerfile.railway, Node 24, and runs as user node.
The measured container had 1 GiB RAM / 1 CPU and UPLOAD_MAX_CONCURRENT=1.
Evidence: test-results/docker-verification-1791877987362.json (ignored, contains no
credentials). Test Storage objects were retained; imported records were not deleted.
The image was then rebuilt after the final entrypoint shutdown fix. Focused evidence:
test-results/docker-shutdown-1791878469724.json. That final image also passes startup,
health, authorized TLSv1.3, Admin login/session/logout and requested shutdown with
ExitCode=0 and no OOM. Its final app filesystem was also rescanned: 28,015 files PASS.
The upload measurements below are from the preceding full run;
the only subsequent runtime change was the entrypoint shutdown exit-code mapping.

## Results

- Build, schema readiness and /api/health: PASS.
- Supabase PostgreSQL: client socket encrypted and authorized, TLSv1.3, verify-full
  with runtime CA. pg_stat_ssl through the Session Pooler describes the internal DB
  hop and is not the client certificate-verification measurement.
- Supabase Storage, login/session/logout, Secure/HttpOnly cookies: PASS.
- 16 legacy upload URLs, image HTTP/HTML checks, PDF/audio/video Range: PASS.
- No public/uploads directory in runtime image.
- Final app filesystem scan: 28,015 files; no env/private backup/certificate files,
  privileged keys or full connection credential contexts found. Short generic local
  password strings were checked in credential context to avoid package-name matches.
  Image Config.Env contains no application secrets. Docker build receives no secrets;
  build-context exclusions protect intermediate stages. This is a final-filesystem
  scan, not a forensic scan of all historical layers.
- tsc, lint, build and 28 unit/regression tests: PASS.

## Sampled container memory and upload result

| Phase | Peak memory | Result |
|---|---:|---|
| Warm idle | 117 MiB | PASS |
| Small image (~96 KiB) | 99 MiB | Upload/hash/Range PASS |
| Video ~8 MiB | 133 MiB | Upload/hash/Range PASS |
| Video ~32 MiB | 257 MiB | Upload/hash/Range PASS |
| Video ~64 MiB | 446 MiB | Supabase size-limit rejection, 413 |

Container did not OOM. Runtime was stopped and removed after testing; hosted files
were retained. Memory is sampled docker stats (container total, not heap-only).
Upload phases include request processing/forwarding and the client's download/hash
verification period. Idle was sampled five times after warm-up. Nominal video fixtures
include an extra eight-byte MP4 free-box header. Peaks can vary with GC/cache/concurrency;
these are observed values for this dataset, not 500 MiB capacity estimates.

Recommend **1 GiB minimum starting allocation for the tested configuration**, one
upload at a time and the verified <=32 MiB path, then monitor under real user load.
Do not extrapolate this to the advertised 500 MiB maximum. Next.js currently buffers
multipart before forwarding. Direct signed resumable upload is recommended for large
media, as described in DIRECT-UPLOAD-EVALUATION.md, and is not implemented yet.

## Fixes made during verification

- Incoming multipart now counts actual bytes before parser consumption, including
  chunked or misleading Content-Length; over 501 MiB returns 413.
- Storage's upstream size rejection now returns a safe actionable 413 instead of 503.
- Unexpected Next child signal termination exits nonzero so Railway ON_FAILURE works;
  requested graceful shutdown still exits normally.
- Corrected the scanner's common-token false positive and verified TLS on the actual
  client socket rather than the pooler backend statistic.

## Historical release gates at that checkpoint

These were the unresolved gates on 2026-10-13, not the current release checklist.
Signed direct upload, explicit Free caps, production-only dependencies and actual
Railway/public browser verification have since passed as documented above. School
DNS/certificate later passed on 2026-10-15; Search Console verification, off-site backups and
alerts still need an assigned operator and actual scheduled setup.

1. Align Supabase project/global limits with application PDF/audio/video limits or
   lower the promised application limits. Bucket limit is null, but 64 MiB is rejected
   by the Storage service. Exact global setting/plan must be checked in Supabase; a
   signed direct upload does not bypass that storage size limit.
2. Choose/implement signed direct TUS upload with private quarantine, Admin-authenticated
   signing and server-side finalization/actual-size/signature verification before
   promising reliable large uploads on slow networks.
3. This run used simulated HTTPS proxy headers on local Docker, not the Railway edge.
   Real domain HTTPS/CSRF/cookies, network timeout and load verification follow only
   after an explicitly authorized release. Browser automation was unavailable in this
   session, so current image evidence is HTTP/HTML/bytes, not a new visual browser pass.
4. Configure sealed Railway variables, production admin credential/session cutoff,
   backup/restore schedule, alerts, resource budget and DNS access. Do not deploy yet.
5. Runtime currently includes dev tooling with the previously noted lint dependency
   advisories; they are not used by the app, but keep dependency review on the checklist.
