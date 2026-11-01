# Phase 1: Supabase Storage

This phase does not migrate PostgreSQL, change existing records, remove local files,
create buckets automatically, or deploy. Existing Admin upload forms are unchanged:
all six kinds use authenticated, same-origin POST /api/admin/upload. News uses cover;
wall banners use banner. Album uses gallery without a separate cover.

## Configuration

Set these in the hosting secret manager or a separate production environment, never
in browser code, NEXT_PUBLIC variables, committed secrets, or .env.local:

- STORAGE_DRIVER=supabase (the default under NODE_ENV=production)
- SUPABASE_URL=https://PROJECT.supabase.co
- SUPABASE_SECRET_KEY=server-only privileged key (preferred); SUPABASE_SERVICE_ROLE_KEY is supported as a legacy fallback
- SUPABASE_STORAGE_BUCKET=library-media
- STORAGE_LEGACY_REMOTE=false initially

Development defaults to local. Explicit STORAGE_DRIVER=local also allows a production
build to run against the existing local files for regression or rollback. Invalid or
missing Supabase settings fail uploads with 503; no silent local fallback.

Create a **public-read bucket** for the publicly readable library. Keep anonymous
insert/update/delete denied. The custom admin session is not a Supabase Auth session;
only the server SDK writes using the privileged key. Do not put confidential documents
in this bucket. A private-library permission model is outside this phase.

Configure allowed MIME types: image/jpeg, image/png, image/webp, application/pdf,
audio/mpeg, audio/wav, audio/ogg, audio/mp4, video/mp4, video/webm. Bucket/global maximum
must support 500 MiB if retaining existing video limits. Supabase Free's 50 MB maximum
does not support the application's largest files.

The server validates actual file signatures, kind and size, then assigns a UUID name
and detected extension under kind/YYYY/MM. It streams to Storage with upsert:false.
The original extension must match the detected content (.jpg/.jpeg both accepted).
Nonempty declared MIME must also match, allowing common browser audio aliases and
application/octet-stream. A PDF renamed to .jpg or a mismatched MIME is rejected.
Limits remain cover 10 MiB; gallery/banner 15 MiB; PDF 80 MiB; audio 150 MiB; video 500 MiB.
Multipart parsing still consumes server memory. This phase requires a Node host/proxy
that accepts these request sizes: **it does not solve Vercel's 4.5 MB inbound body
limit**. Direct signed/resumable browser upload is a separate phase, not implemented here.

## URL compatibility and copy procedure

New Supabase uploads return /uploads/supabase/covers/YYYY/MM/UUID.jpg (etc.).
The route returns a nonpermanent 307 to the public Storage URL, preserving GET/HEAD
methods. No service key is involved in reads. PDF.js worker remains local static build
assets under /pdfjs; Storage must allow cross-origin PDF reads and byte-range headers.

Old /uploads/covers/... URLs first serve the local file unchanged, including HEAD,
ETag and byte ranges. If absent AND STORAGE_LEGACY_REMOTE=true, the same object key
is resolved in Storage. The reserved supabase/ namespace is only for new uploads.

1. Back up DB plus public/uploads, including archived records and inactive banners.
2. Set Supabase environment outside .env.local and create the bucket described above.
3. Run `node scripts/copy-uploads-to-supabase.mjs` for a read-only local SHA-256 manifest.
   Save output outside the web root as part of the backup.
4. During an agreed read-only window, run the same command with `--apply` to COPY
   objects. It never updates DB or deletes local/remote files, refuses symlinks and
   overwrites, and verifies downloaded bytes. Existing identical objects are accepted;
   differing objects abort. Keep the original local tree.
5. Verify the manifest, all old/new image URLs, PDF pages, gallery, HEAD and Range
   (206), seek in audio/video, upload each kind and Admin replace/delete on staging.
6. Only then set STORAGE_LEGACY_REMOTE=true where local uploads will not be mounted.
   Keep database URLs untouched. Re-test absent-local legacy reads before release.

For actual HTTP integration tests against the running server, set UPLOAD_TEST_URL
and UPLOAD_TEST_EXPECT_DRIVER=local or supabase, then run
`node scripts/upload-check.mjs`. It uses the existing ignored browser fixture files,
tests eight uploads (including two album images, news cover and wall banner), validates
download hashes, HEAD/Range and negative security cases. It does not create/delete
content records. Uploaded test files are retained; their manifest is in ignored
test-results/upload-TIMESTAMP.json. A cloud PASS requires real server configuration;
the mocked unit tests are not evidence that a real bucket works.

## Replace/delete and rollback

Replacing a file always uploads a fresh UUID object; no object is overwritten. File
references change only when the content mutation succeeds. Removed gallery entries,
replaced covers/media and deleted records retain their files. The successful mutation's
audit details contain retained_media and storage_policy=retain-during-migration.
Shared files, archived content, abandoned form uploads and original local files are
never automatically deleted. This is deliberate retention, not automatic garbage
collection. Audit failures are logged by the existing audit mechanism and are not a
reliable deletion queue. A future explicit cleanup must check references across all
three content tables and backups, then use a retention period before object removal.

Rollback to the previous release/config with the local tree preserved. Once new
Supabase URLs are saved, keep the Supabase reader/config available even if writes
switch back to local; otherwise those new objects become unavailable. Never delete the
bucket or source directory as part of rollback. Back up Storage objects separately
from PostgreSQL: a DB dump contains references, not file bytes.

Official references:
- https://supabase.com/docs/reference/javascript/storage-from-upload
- https://supabase.com/docs/guides/storage/buckets/creating-buckets
- https://supabase.com/docs/guides/storage/uploads/file-limits
- https://vercel.com/docs/errors/function_payload_too_large
