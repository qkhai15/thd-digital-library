# Free-plan signed upload verification — 2026-10-14

Release scope is now Supabase Free, maximum 50 MiB (52428800 bytes), without upgrading
the plan. Global configuration was not raised. Both buckets remain 50 MiB: public
thd-library and PRIVATE thd-library-quarantine. No old files/records were deleted,
.env.local was not edited, and neither Railway nor DNS was deployed/configured.

## Implementation and limits

scripts/upload-policy.mjs is the shared secret-free policy. Runtime
UPLOAD_MEDIA_MAX_MIB defaults to 50; .env.example documents the name/value. Effective
cloud limits are min(policy, type ceiling, private bucket, public bucket). Current
PDF/audio/video caps are 50 MiB; cover 10 MiB, gallery/banner 15 MiB. Local development keeps
its previous provider limits. Production startup rejects invalid configuration and
insufficient bucket capacities.

Authenticated GET /api/admin/upload/limits exposes only safe numeric limits/driver/
threshold. Admin displays these limits and checks size BEFORE file sampling, signed
token requests or byte transfer. Over-limit video prompts compression or a future
Storage-plan upgrade. Server signing independently denies overflow before allocating
an intent or calling the privileged Storage signer. Pending finalize checks limits
again; completed legacy records/URLs remain compatible.

Large allowed PDF/audio/video keeps browser→Admin signing→signed TUS directly to
private Storage→finalize. TUS uses 6 MiB chunks, retries and scoped resume, with the
/storage/v1/upload/resumable/sign endpoint. Only metadata≤ 8 KiB and signature prefixes
retained≤ 64 bytes reach the app; Storage performs the public copy. Cloud multipart is
hard-capped at 16 MiB actual body bytes. Secrets remain server-only.

Future Pro upgrade requires only reviewed provider configuration and the chosen
UPLOAD_MEDIA_MAX_MIB environment value, followed by the existing bucket CLI using
that environment. No frontend/backend rewrite or database migration is needed; type
ceilings remain PDF 80/audio 150/video 500 MiB. No upgrade is required for this release.

## Actual test evidence

Direct-upload and memory evidence: ignored test-results/docker-verification-1791941977578.json.
Image: sha256:5c5920d0c8936e161fe029c70f9e5722c6fba5242068d89b5705f907956f305f.
The earlier run, test-results/docker-verification-1791938760205.json and image
sha256:1702309ab18b286d1070453601661cb75065bbdef9ec1630902b1439bfb0b188,
is retained as historical evidence. Measurements below use the direct-upload image.
The final production-only-dependency image is
sha256:78a552211b3ea602c3c3d424a6b3dfc1a7f2dee55a5ac9090c689a8b03c28afc;
test-results/final-image-verification.json records startup/health/TLS/Storage,
login/session/public/Admin/SEO, actual JSON overflow 413 and static image optimization
PASS. Its final filesystem scan checked 17104 files, found no configured secrets/
private files, and confirmed ESLint/TypeScript are absent while Sharp works.
Large byte transfers were not repeated on this final rebuild to conserve Free quota;
the direct-upload implementation and limits are unchanged.

| Test | Result |
|---|---|
| Video 16 MiB, exactly 16777216 bytes | PASS, direct TUS/hash/Range 206 |
| Video 32 MiB, exactly 33554432 bytes | PASS, pause/HEAD-offset resume/hash/Range 206 |
| Video 48 MiB, exactly 50331648 bytes | PASS, direct TUS/hash/Range 206 |
| PDF/audio~8 MiB | PASS, direct TUS/hash/Range 206 |
| Small JPEG~96 KiB | PASS, existing multipart/hash/Range |
| 50 MiB + 1 byte and 64 MiB metadata | PASS, clear 413 before token/bytes |
| Copy already succeeded, DB completion not recorded | PASS, existing-copy recovery |
| Finalize retry | PASS, idempotent same metadata/URL |
| Private source anonymous access | Denied |
| Admin auth/origin/unsafe filenames | Denied as expected |

Every successful large-file byte request targeted Storage directly. CORS preflight
for the intended production origin passed. Exactly five new QA intents completed;
oversized attempts created no extra intents. Hosted DB checks confirmed metadata/URLs
only, RLS enabled and anonymous SELECT denied. Health, client TLSv1.3/verify-full,
Admin login/session/logout, 16 legacy URLs/images and original media Range regression
also passed. Image scan checked 28265 files without configured secret/private-file hits
(final app filesystem, not historical-layer forensics).

The same tus-js-client ran outside the app container for real transfers. This is live
HTTP/TUS/CORS evidence, not an assertion that desktop/mobile Chrome or the Railway
edge passed. Test objects/intents/audits remain; no demo library documents were seeded.

A final-image real production-container HTTP/API regression passed 223 checks:
test-results/production-regression-7b3c54a1-bb9a-4537-8591-ade36af6f436.json.
It covered HTML/JSON Admin login, signed sessions/expiry/cutoff/logout, authorization
and CSRF, all seven small persistent-upload uses (including multiple gallery images),
file hashes/Range, CRUD/search/moderation/likes/views/borrow-return/stock/audit and
retained files after record replacement/deletion. Counts and SHA-256 fingerprints
prove that every pre-existing row in all 13 application tables stayed unchanged.
DELETE tests were restricted to newly-created manifest-owned UUID fixtures; the
new paper record with borrow history was archived and retained. Large transfers were
not repeated by that harness, using the Docker proof above to conserve Free quota.
No published existing "other documents" detail was available; real login threshold
testing remained opt-in and was not run. Unit tests cover the shared login limiter.

Separate isolated Google Chrome desktop/mobile regression passed 34 recorded steps:
test-results/browser-production-115c827e-cb3e-4240-b319-50a431806197/report.json.
This used a local HTTPS proxy to the preceding application image and real forms,
clicks and file pickers, including every active document type, PDF/audio/video/gallery,
Admin login/logout, small uploads, oversized-video refusal, likes/comments/borrow/
return/stock, moderation, news/wall forms and edit/archive/delete confirmation.
It reported zero uncaught browser errors and verified its own "other documents"
fixture. QA content was archived/hidden or its owned disposable record deleted;
files and borrow history remain. This proves browser behavior on local HTTPS, not
Railway edge or school-domain availability.

## Memory and shutdown

Container 1 GiB / 1 CPU, sequential transfers; client byte buffers/hash downloads were
outside Docker. Sampled docker stats container-total memory:

| Phase | Peak sampled memory |
|---|---:|
| Warm idle, five samples |138 MiB|
| Video 16 MiB |122 MiB|
| Video 32 MiB with resume/copy recovery |123 MiB|
| Video 48 MiB |124 MiB|
| PDF approximately 8 MiB |124 MiB|
| Audio 8 MiB |141 MiB|
| Whole run |141 MiB|

GC/cache timing explains later values below idle. The 32 MiB recovery phase includes
a temporary metadata-only QA Node helper in the container. These are samples, not
capacity guarantees under arbitrary web load. Keep 1 GiB as the conservative starting
Railway allocation and monitor traffic before reducing it. The current run retained
its own QA container for subsequent HTTP/browser checks and does not assert a fresh
shutdown result. The earlier historical run shut down with exit 0 and no OOM.

## Fixes and checks

- Centralized Free 50 MiB policy, safe /limits API, visible Admin cap and early rejection.
- Fixed legitimate copy retry failure: TUS multipart source and server copy ETags
  differ despite identical content. Recovery validates immutable intent ownership,
  actual size/MIME and bounded prefixes instead of assuming portable ETag equality.
- Reject tampered parallel TUS resume records so secondary URLs cannot receive a
  scoped signature. Existing scalar resume URLs remain bound to the Storage endpoint.
- Limit-fetch errors preserve Admin dashboard/list usability and redirect expired
  sessions correctly. Local provider compatibility remains explicit.
- Shared JSON content mutations now cap actual stream bytes at 1 MiB and return a
  safe 413 before writes, including absent/lying Content-Length and chunked bodies.
- Final hardening: tsc --noEmit, lint, build and 75 unit/regression tests PASS;
  final-image HTTP/API and separate real Chrome evidence are recorded above.
- npm audit --omit=dev reported zero production dependency vulnerabilities.

No database schema change was needed for this hardening; the already applied v2
upload-intent migration and backups remain in place. Existing application data/URLs
were retained.

## Before Railway deployment

No large-upload blocker remains within the approved Free≤ 50 MiB scope. Larger files
are deliberately unsupported and clearly rejected; Pro is not a release prerequisite.
Remaining release work: configure sealed production DB/Storage/Admin/CA variables
with UPLOAD_MEDIA_MAX_MIB=50 and a fresh stable session cutoff; finalize backups,
monitoring and quarantine retention; repeat public smoke tests on the real Railway URL.
Deployment is now authorized by the current user request once release gates pass.
Verify actual Railway HTTPS/CSRF/cookies/domain and network behavior before switching
school traffic; this document does not claim Railway or DNS is already configured.
Previously reported dev-tool dependency advisories remain a development maintenance
item; the final runtime image excludes those tools. No unrelated force-upgrade was performed.

Current guide: DIRECT-UPLOAD-EVALUATION.md and RAILWAY.md. The earlier
DIRECT-UPLOAD-VERIFICATION.md is historical and does not define this Free release.
