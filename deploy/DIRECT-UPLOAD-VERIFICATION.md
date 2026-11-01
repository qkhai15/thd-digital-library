# Signed direct upload verification — 2026-10-13

Historical initial rollout. The current release stays on Free at50MiB and adds
centralized policy/early rejection plus16/32/48MiB verification; see
DIRECT-UPLOAD-FREE-VERIFICATION.md. The earlier upgrade recommendations below are
superseded by the current Free release scope.

Implemented and exercised against the real Supabase project through a local Railway
Docker container. No deployment, DNS change, .env.local edit, old-file deletion or
database reset. Browser automation was unavailable (no browser surfaces), so live
transfer evidence uses the same tus-js-client outside Docker plus HTTP/CORS checks;
frontend behavior is covered by regression tests, not a new visual browser pass.

Evidence: ignored test-results/docker-verification-1791880345603.json.
Image: sha256:2054ea5d6e64b8284d791d547ba873c323148911a87d54c523944229de110bc3.
Docker build, runtime, health, PostgreSQL client TLSv1.3/verify-full, Admin
login/session/logout, 16 legacy URLs and image HTTP/HTML regression checks passed.
The final app filesystem scan checked 28,239 files with no configured secret bytes,
credential contexts, env/private backups or certificates found; scan scope is the
final app filesystem, not a forensic scan of historical layers.

## Transfer results

| Fixture | Route | Result |
|---|---|---|
| JPEG ~96 KiB | Existing multipart | PASS, hash and Range |
| Video ~8 MiB | Signed direct TUS | PASS, hash and Range |
| Video ~32 MiB | Signed direct TUS | PASS, pause/HEAD-offset resume, hash and Range |
| Video ~64 MiB | Metadata signing attempt | BLOCKED, 413 before transfer |
| Video ~128 MiB | Metadata signing attempt | BLOCKED, 413 before transfer |
| PDF ~8 MiB | Signed direct TUS | PASS, hash and Range |
| WAV audio 8 MiB | Signed direct TUS | PASS, hash and Range |

All successful large-file byte requests targeted Supabase's Storage host, not the
application. CORS preflight permits the production origin and TUS/signature headers.
Quarantine objects were inaccessible through the anonymous public object URL. Resume
signing after transfer detected uploaded:true before finalize. Finalization replay
returned the same result. Four completed upload-intent rows held metadata/URLs only;
RLS was enabled and anonymous SELECT denied. Test files/intents/audit records remain.
Nominal MP4/PDF sizes include small format-safe padding headers/comments. These are
transport fixtures, not new demo library content.

## Actual limits

The live bucket configuration accepted exactly 52428800 bytes (50 MiB), and rejected
52428801 bytes and the desired 524288000 bytes with 413. Both public thd-library
and PRIVATE thd-library-quarantine were configured to the accepted 50 MiB cap without
changing existing objects. Signing checks both bucket limits before issuing a token.
64/128 MiB attempts above are not successful uploads and do not claim a tested upper
capacity. The project plan/global setting cannot be raised with the server Storage
key; no Management API credential is configured.

Owner action: increase Supabase Storage Global file size limit to at least 524288000
bytes on a plan that permits it, then run:

```powershell
node scripts/configure-direct-storage.mjs --apply
```

This raises both bucket caps to 500 MiB while preserving public/private modes and
objects. Application PDF/audio ceilings remain 80/150 MiB. Then repeat actual 64/128
MiB direct transfers; do not deploy with an advertised 500 MiB limit unverified.

## Sampled container memory

Container limit: 1 GiB / 1 CPU; sequential transfers; compatibility concurrency=1.
Client buffers and download/hash verification ran OUTSIDE the app container.

| Phase | Peak sampled memory |
|---|---:|
| Warm idle, five samples | 130 MiB |
| Direct video ~8 MiB | 141 MiB |
| Direct video ~32 MiB, including pause/resume | 124 MiB |
| Direct PDF ~8 MiB | 125 MiB |
| Direct audio 8 MiB | 141 MiB |
| Whole sampled run | 141 MiB |

GC/cache timing can make later samples lower than warm idle. These are docker stats
container-total samples, not a constant-memory guarantee under arbitrary web load
or proof of a 500 MiB transfer. The earlier forwarded-video measurement was 257 MiB
at ~32 MiB and 446 MiB for a rejected ~64 MiB request. The new architecture removes
the full large-file request body from the application independently of these sample
differences. Keep 1 GiB as the conservative starting Railway allocation and monitor
real traffic before reducing it.

## Fixes and validation

- Corrected scoped TUS endpoint to /storage/v1/upload/resumable/sign. The ordinary
  JWT route returned 400 AccessDenied / Invalid Compact JWS in the first live test;
  the signed route subsequently passed. Client/server regression tests enforce it.
- Added Admin/session-owned signing, safe UUID paths, type/extension/MIME/size checks,
  private quarantine, quota and bounded metadata/signature validation.
- Added retries, pause/resume and recovery when transfer succeeded but finalize did
  not reach the backend. Finalize is idempotent and checks actual content before copy.
- Capped cloud compatibility multipart at 16 MiB actual bytes, including chunked
  bodies, so large requests cannot take the old bulk-buffer route.
- tsc --noEmit, lint, build and 47 regression tests: PASS.

Migration v2 added storage_upload_intents/indexes/constraints/RLS only. Backup archives
were readable and all 11 existing application-table count/digests matched afterwards:

- deploy/data/backups/direct-upload-supabase-2026-10-13T08-13-47-040Z
- deploy/data/backups/direct-upload-local-2026-10-13T08-14-56-479Z

Archives contain private data and must remain ignored/encrypted/off-site. They are
database backups, not backups of Storage file bytes. Re-running the migration is a
no-op. Rollback uses the previous compatible image with the same DB/Storage; keep
the v2 table/data and version 1 marker. Do not DROP/restore over current live data.

## Remaining release gates

1. Raise the provider global limit, configure both bucket caps, and PASS 64/128 MiB
   actual transfers. There is no service-key workaround and no automatic plan upgrade.
2. Visual browser smoke test for progress/pause/reselect-resume, especially mobile,
   plus real Railway edge/domain HTTPS/cookie tests when deployment is authorized.
3. Set a production Admin credential and fresh stable session cutoff; configure
   monitoring, backups and reviewed quarantine retention. Copies are retained in
   private/public buckets; cleanup must account for re-signed-token grace periods.
4. Review the previously reported dev lint dependency advisories retained in the
   current image. No unrelated dependency force-upgrade was performed.

Changed files for this phase: AdminClient.tsx; admin-upload-client.ts; direct-upload.ts;
admin upload route and new sign/finalize routes; admin-auth.ts; schema.mjs;
start-railway.mjs; package.json/package-lock.json; .env.example; .gitignore;
.dockerignore; configure-direct-storage.mjs; migrate-direct-upload.mjs;
verify-signed-transfer.mjs; docker-verify.mjs; client/security/body/production tests;
this report, DIRECT-UPLOAD-EVALUATION.md, RAILWAY.md and historical report annotation.

Sources: [Supabase TUS](https://supabase.com/docs/guides/storage/uploads/resumable-uploads),
[Storage limits](https://supabase.com/docs/guides/storage/uploads/file-limits),
[signed-route implementation](https://raw.githubusercontent.com/supabase/storage/master/src/http/routes/tus/lifecycle.ts).
