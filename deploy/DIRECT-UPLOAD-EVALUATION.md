# Direct resumable uploads: implementation and operations

This guide supersedes the earlier architecture-only review. Signed direct upload is
now implemented for PDF, audio and video. Deployment has not been performed. Actual
container measurements and transfer results belong in
[DIRECT-UPLOAD-VERIFICATION.md](DIRECT-UPLOAD-VERIFICATION.md), rather than being
inferred from the design described here.

## Upload paths

| File | Browser path | Application memory boundary |
| --- | --- | --- |
| Cover, gallery, news image, wall banner | `/api/admin/upload` multipart → Supabase | Entire multipart body limited to 16 MiB when `STORAGE_DRIVER=supabase` |
| PDF/audio/video up to 6 MiB | Same compatibility multipart endpoint | Same 16 MiB request-body limit; file-specific limits and signature checks still apply |
| PDF/audio/video larger than 6 MiB | Backend signs → browser sends TUS directly to private Supabase Storage → backend finalizes | Backend JSON limited to 8 KiB; only a 64-byte signature prefix retained |

The browser uses `tus-js-client`, 6 MiB chunks and the dedicated Supabase Storage
signed resumable endpoint:
`https://<project>.storage.supabase.co/storage/v1/upload/resumable/sign`.
The `/sign` suffix is required for scoped upload tokens; the ordinary
`/storage/v1/upload/resumable` route expects Supabase Auth JWTs and rejects these
tokens. This distinction was confirmed against the actual Storage service.
Large media bytes do not traverse Railway. Signing, object-info
checks and cross-bucket copy requests carry metadata only. Supabase performs the copy
internally; Railway does not download or re-upload the full object. The signature
request uses `Range: bytes=0-63` and cancels the response stream after 64 retained
bytes even if the upstream ignores Range. SDK metadata/copy requests have a 120-second
timeout; the signature request has a 20-second timeout.

Local development retains its existing local multipart compatibility path. Existing
database records, local files and `/uploads/...` URLs are not rewritten or deleted.
Finalized direct uploads return the existing `/uploads/supabase/...` URL format and
are saved into the normal document form; the intent table stores upload metadata,
not file bytes. Supabase Storage remains production persistent storage.

## Authorization and validation

1. `POST /api/admin/upload/sign` requires an active Admin database session and a
   same-origin request. The JSON body contains `kind`, `documentType`, `fileName`,
   `size`, `mime` and an optional `resumeId`. PDF kind `document` accepts
   `sach-dien-tu` or `tai-lieu-khac`; audio requires `sach-noi`; video requires `video`.
2. The server validates the filename, extension, MIME, positive integer size and
   application/bucket limits. It infers MIME from an allowed extension only if the
   browser supplies an empty MIME or `application/octet-stream`. Arbitrary browser
   bucket/path inputs are not used. The server generates UUID source and destination
   names and binds the intent to the current session's token hash.
3. The temporary bucket is **private**, defaults to `thd-library-quarantine`, and
   can be configured with `SUPABASE_UPLOAD_BUCKET`. The public destination remains
   `SUPABASE_STORAGE_BUCKET`, currently `thd-library`. Signing/finalization verify
   both bucket modes. No anon/authenticated write policy is needed for this flow.
4. Only an exact-path signed upload token is returned. It uses `upsert:false` and
   is sent by TUS as `x-signature`; `SUPABASE_SECRET_KEY` remains server-only. The
   browser does not persist the token in storage or log signed request errors.
5. `POST /api/admin/upload/finalize` receives only `{ "id": "..." }`. It rechecks
   Admin ownership and intent expiry, obtains the object's actual size/MIME, and
   validates its signature before copying it to its immutable public destination.
   Mismatched size/MIME/signature rejects the intent and leaves the source private.
   Finalization holds a database row lock and records completion and an audit event
   in one transaction. A completed intent returns its previously stored result.
6. A retry after a successful copy but a lost database commit can accept an existing
   destination only after checking size/MIME and comparing the bounded source and
   destination prefixes. ETag equality is not required: live Supabase multipart and
   server-side copy ETags differ even for identical bytes. ETags are not treated as
   portable whole-object checksums.

The default quotas are four unexpired pending intents per Admin username, 30 new
intents and 3 GiB of declared bytes per rolling 24 hours. Quota checks are serialized
with a PostgreSQL advisory lock. A signed Storage capability does **not** enforce an
intent's declared size/MIME by itself. Bucket limits bound ingress; finalization
checks actual content before publication. An authorized malicious Admin could still
waste private Storage capacity, so retain monitoring and a cleanup process.

## Retry, resume and expiry

The client stores the intent ID, expiry, file fingerprint and TUS resume URL in
sessionStorage, with an in-memory fallback. It fingerprints file metadata and samples
the first/last 64 KiB, never reading the full file into application memory. Selecting
the same file again resumes the same intent if session ownership and metadata match.
Stored resume URLs must remain under the exact Storage endpoint and match the issued
bucket/path/size. Temporary network/server failures retry with increasing delays.
Pausing does not delete the source object.

Storage signed upload tokens last two hours. An intent's original two-hour deadline
does not extend when re-signed. Re-signing can give a token with a later provider
expiry, but finalization still rejects an expired intent. Expired or inaccessible
intents require a new upload; they are not reassigned to a different session.

If TUS finished before a lost response or browser refresh, resume signing detects
the existing private object and returns `uploaded:true`, without issuing another
upload token. The client skips transfer and calls finalize. A completed intent
returns `completed:true`; finalize then returns its existing metadata. These cases
avoid attempting an immutable-path upload again after TUS removed its resume URL.

## Free-plan limits and centralized configuration

| Type | Application maximum | Current effective Storage maximum |
| --- | ---: | ---: |
| PDF | 80 MiB | 50 MiB |
| Audio | 150 MiB | 50 MiB |
| Video | 500 MiB | 50 MiB |

The current release deliberately stays on Supabase Free; no upgrade is required.
All cloud media defaults to 50 MiB through scripts/upload-policy.mjs and the runtime
UPLOAD_MEDIA_MAX_MIB setting. Effective caps are min(type ceiling, configured policy,
private bucket cap, public bucket cap). /api/admin/upload/limits requires Admin and
returns only safe numeric limits/driver/threshold. The browser checks it before file
sampling, signing or byte transfer and displays the current maximum in Admin.

The live project's effective global limit was checked by bucket configuration:
`52428800` bytes was accepted, while `52428801` bytes was rejected with HTTP 413.
Both the public and private buckets are currently configured for exactly
`52428800` bytes. A desired bucket limit of `524288000` bytes (500 MiB) was rejected.
Signing checks the minimum of the private/public bucket limits and the relevant
application rule, rejecting oversized metadata before reserving an intent or
transferring any file bytes.

Keep the global limit and both bucket caps at 50 MiB. Over-limit media is rejected
early with a compression/Storage-plan message. Successful Free validation targets
16/32/48 MiB; 64 MiB and above are intentionally out of scope rather than blockers.
The Storage key cannot change the plan/global limit. Do not make quarantine public.

For a future explicitly approved Pro upgrade, raise the provider global configuration
and set UPLOAD_MEDIA_MAX_MIB to the chosen maximum (up to 500); then run
node scripts/configure-direct-storage.mjs --apply with that process environment.
The CLI defaults to the same 50 MiB policy today; it does not automatically request500.
It preserves objects and bucket modes. No frontend rewrite or DB migration is needed.
Type ceilings remain 80/150/500 MiB; smaller actual bucket caps still win. Do not edit
.env.local to apply this rollout; production configuration belongs in Railway Variables.

## Environment and schema rollout

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | HTTPS project origin; server derives the resumable Storage endpoint |
| `SUPABASE_SECRET_KEY` | Server-only privileged Storage credential; never `NEXT_PUBLIC_*` |
| `SUPABASE_STORAGE_BUCKET` | Existing public destination bucket, `thd-library` |
| `SUPABASE_UPLOAD_BUCKET` | Optional explicit private bucket; defaults to `thd-library-quarantine` |
| `STORAGE_DRIVER=supabase` | Production Storage backend |
| `UPLOAD_MEDIA_MAX_MIB=50` | Shared cloud media maximum on Free; default 50 |
| `DATABASE_URL` | Production Supabase PostgreSQL connection with verified TLS |
| `SUPABASE_DATABASE_URL` | Hosted migration CLI target; not required as a second production connection |
| `LOCAL_DATABASE_URL` | Optional migration CLI local target; otherwise the CLI uses `DATABASE_URL` |
| `DB_SSL_CA_FILE` / `DB_SSL_CA_BASE64` | Verified database CA configuration; follow the Railway runtime certificate guide |
| `AUTO_MIGRATE=false` | Apply the reviewed migration before starting production |

Existing authentication/origin/storage compatibility variables remain required as
documented in [RAILWAY.md](RAILWAY.md). No environment values or secrets should be
committed. This implementation does not edit `.env.local`.

Schema version 2 adds `storage_upload_intents`, its indexes and constraints. Existing
tables/data and the version 1 marker are preserved. The new table enables RLS and
revokes access from PUBLIC and the `anon`/`authenticated` roles when present. The
server database connection remains the authority for intent metadata.

Use the backup-first migration CLI, selecting each database explicitly:

```powershell
# Read-only preflight:
node scripts/migrate-direct-upload.mjs --target=local
node scripts/migrate-direct-upload.mjs --target=supabase

# Back up, verify archive readability, apply additive migration, then verify
# that existing tables' row counts and data fingerprints are unchanged:
node scripts/migrate-direct-upload.mjs --target=local --apply
node scripts/migrate-direct-upload.mjs --target=supabase --apply
```

The CLI does not print connection strings/passwords. Backups and manifests go under
the ignored `deploy/data/backups/direct-upload-<target>-<timestamp>/` directory. The
Supabase target forces TLS `verify-full` with the configured CA. An already applied
version 2 returns without database writes. Do not run a reset or seed operation.

Before release, run TypeScript/lint/build/regression checks, verify public URL Range
responses, and compare container idle/transfer memory using the verification report.
The upload architecture itself is not a RAM measurement.

## Retention and rollback

This phase deliberately does not delete existing files, database records or private
test objects. A completed direct upload retains both the private source and public
copy, so Storage usage can temporarily approach two copies per uploaded file. Review
quarantine capacity/cost and alert on abandoned or rejected uploads.

A future cleanup job must select server-owned intent keys only, distinguish completed
from pending/rejected records, and respect the original expiry **plus at least two
hours of grace** because a resumed signed token may outlive the intent deadline.
Confirm the public copy and database references before removing a completed private
source. Never scan/delete unrelated legacy files or public records. No automated
cleanup is introduced here.

To roll back an application failure, return to the previous reviewed Docker image
and configuration. Keep both schema version markers and the additive version 2 table;
the previous app still recognizes version 1. Do not DROP the table, restore a backup
over a live database, or delete Storage objects. Already finalized URLs remain in the
normal compatible format. Pending direct uploads cannot continue through the old UI,
but their private objects/metadata remain available for diagnosis or a later forward
fix. A full database restore is a separate reviewed operation to a new target, with
the backup validated before switching connections.

## Primary references

- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Storage signed TUS lifecycle](https://github.com/supabase/storage/blob/master/src/http/routes/tus/lifecycle.ts)
- [Signed upload URL API](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)
- [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Railway networking limits](https://docs.railway.com/networking/public-networking/specs-and-limits)

The implementation also follows the installed Storage SDK's exact `info`,
`createSignedUploadUrl`, `createSignedUrl` and cross-bucket `copy` contracts.
