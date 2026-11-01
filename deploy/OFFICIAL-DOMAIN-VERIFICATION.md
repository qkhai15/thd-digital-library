# Official-domain production verification — 2026-10-15

Website: https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn

The existing Railway project/service/environment remain unchanged. Release
`d3b0fe74-fecd-4122-9ee4-eaead2ad5566` is SUCCESS, built with
`deploy/Dockerfile.railway`; image digest
`sha256:46b21e0a974bada1d5bca1715445fe2fe0819b1054f15c23ced8f8adb24d4bcf`.
The only application change from checkpoint `2c240e1` is an accessible home-page
H1 with a dedicated utility class that preserves the existing visible layout.
No authentication, database, Storage, secrets or production environment changes.

## Domain and runtime

- CNAME and ownership TXT resolve through 1.1.1.1 and the system resolver.
- Railway reports ownership verified, DNS PROPAGATED and certificate VALID/COMPLETE.
- A real HTTPS client verified the certificate chain/hostname and TLSv1.3. The
  certificate covers the school hostname and expires 2027-01-13.
- HTTP redirects to HTTPS with 301. `/api/health` returns 200.
- The release logs show actual database client TLSv1.3 authorization and successful
  hosted schema/public-private Storage preflight; `AUTO_MIGRATE=false` remains set.
- Target port is 8080, Singapore, one replica, sleep disabled, 1 GB / 1 vCPU,
  ON_FAILURE with three retries and a 120-second deployment healthcheck.
- Local application/container/proxy ports 3000/3103/3104/3105/3107 were closed while
  these official-domain checks passed. The site requires Railway and Supabase,
  not VS Code, local Docker, a local database, local uploads or a tunnel.

## Functional and browser evidence

Ignored reports contain no production passwords, cookie values or upload signatures:

- `test-results/browser-production-30268fe0-7f1b-4ae9-a8fd-c9fe124ba3e3/report.json`:
  27 actual Chrome desktop/mobile UI flows PASS on the official hostname. Real
  forms cover all six active content types, small cover/PDF/audio/video/gallery/
  news/banner uploads, search, detail/viewers, likes/comments/borrowing,
  moderation, approval/return/restored stock, editing, owned QA archival/deletion
  and logout. Oversized media was rejected early without uploading large files.
- `test-results/production-regression-31a6b78b-2cb2-48fc-9933-0a10c85c5ffa.json`:
  192 HTTP/API/DB checks PASS, including the unchanged count/content fingerprints
  of all pre-existing rows in 13 application tables. This rerun disabled uploads;
  actual small-upload proof is in the preceding official UI/API run.
- The preceding API run completed its functional assertions but failed the strict
  fingerprint gate because a concurrent visitor added one view to existing item 1.
  Its `updated_at` exactly matches the new view row. No content edit was found;
  no counter was reset and no assertion was relaxed. Evidence:
  `test-results/official-concurrent-write-analysis.json` and
  `test-results/production-regression-17da5189-71c0-477c-9e4d-377b863f2bb2.json`.
  A separate early retry encountered a transient HTTP connection failure before
  any mutations; it is retained as a failed report, not counted as PASS.
- After the H1 release, `test-results/browser-smoke-462f4772-9a58-471b-943e-973bb2d8bbcb/report.json`:
  24 real Chrome desktop/mobile navigation, decoded legacy/Storage images,
  actual video frames and responsive checks PASS.
- `test-results/final-browser-auth-f069d503-71f9-4caa-a302-60605eb04c69/report.json`:
  six fresh desktop/mobile auth/SEO checks PASS on the H1 release. Real HTML form
  login POST returns 303 to the official `/admin`; host-only Secure/HttpOnly/Lax
  cookies retain session after reload, and logout removes/invalidate them.
  The API checks separately cover expiry, cutoff, fresh tokens and authorization.
- `test-results/official-domain-edge-independence.json` and
  `test-results/official-domain-seo-tls.json`: official HTTPS/health, semantic H1,
  title/Vietnamese description, canonical/OpenGraph, favicon, linked WebSite/School
  JSON-LD, public indexability and Admin/API exclusions PASS. Sitemap returns 200
  with 19 public URLs using the official hostname. Root URLs with/without the
  final slash normalize to the same canonical URL.

TypeScript, lint, build and all 77 automated regression tests passed after the H1
change. Linux Docker build, deployment startup and official-domain post-release
checks passed; the Dockerfile/runtime configuration were not changed. No large
upload was repeated. Prior actual 16/32/48 MiB direct/resumable proof still applies
to the unchanged upload implementation; the per-file media cap remains 50 MiB.

## Capacity, backup and monitoring

Read-only inventory: 175 public objects (574,646,513 bytes), 19 private objects
(411,042,841 bytes), total 985,689,354 bytes / **940.03 MiB**. No Storage objects
were deleted or plan upgraded. `test-results/production-storage-cleanup-candidates.json`
lists exact paths with QA-report ownership evidence: 98 public objects plus four
private copies, approximately **233.91 MiB** potentially reviewable. This is not
cleanup authorization: check live/archived references and backups before an
explicitly approved deletion. Do not repeat large QA uploads on Free.

Railway measurements over the 15-minute official QA/rollout window: peak **285.61 MB**,
latest **158.13 MB**, peak **0.1026 vCPU**. These are sampled platform measurements,
not a concurrent-user capacity guarantee. Retain 1 GB / 1 vCPU and monitor traffic.

[DATABASE-MIGRATION.md](DATABASE-MIGRATION.md) documents hosted logical backup,
isolated restore, sequences/constraints/RLS verification and separate Storage-byte
recovery. The retained pre-release hosted backup is
`deploy/data/backups/hosted-app-2026-10-14T01-13-46-796Z` (Git ignored).
No restore/reset was performed. Off-site scheduled exports/restore drills and
external alerts require an assigned operator; they have not been automatically
activated. Minimum current visibility is `/api/health`, Railway deployment
healthcheck/logs/metrics and verified DB/Storage startup checks. Deployment
healthchecks are not continuous uptime monitoring. App-only rollback preserves
the same hosted data, stable production SESSION_SECRET and session cutoff.

## Search Console — manual verification required

The website is technically ready for crawl/indexing. No Google property ownership,
sitemap submission or Google indexing has been claimed completed.

An authorized Google account should add/verify the Domain property
`tranhungdaothanhxuan-hanoi.edu.vn`, which includes the library subdomain, using the
exact DNS record generated by Google. Preserve the existing Railway CNAME/TXT.
No Google verification token is invented here. A TXT record must not be placed
alongside the existing CNAME at the same `thuvien` name; the parent Domain property
avoids that collision. Once verified, submit:

https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn/sitemap.xml

The sitemap's HTTP 200 and robots discovery are verified; submission does not
guarantee immediate indexing. See Google's
[property guide](https://support.google.com/webmasters/answer/34592?hl=en) and
[ownership verification guide](https://support.google.com/webmasters/answer/9008080?hl=en).
