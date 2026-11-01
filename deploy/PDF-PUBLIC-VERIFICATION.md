# PDF mobile/public fix — 2026-10-15

## Reproduced cause

The previous reader already used PDF.js 6.4.299 canvas rendering, not iframe,
object or embed. It imported the modern, unpolyfilled bundle. Removing
`Map.prototype.getOrInsertComputed` in an isolated browser reproduced the exact
production error on **Ngữ văn 12 - Chuyên đề ôn tập**, item 1, a 20-page real PDF
of 13,923,131 bytes:

`TypeError: ...getOrInsertComputed is not a function` inside PDF.js
`getOptionalContentConfig` / `render`. The component caught that error and replaced
the reader with the reported fallback. Evidence is in ignored
`test-results/pdf-compat-reproduce.json`. A current desktop/mobile Chrome probe
rendered this same file, which explains why Chromium-only sample-file tests missed
the browser API compatibility problem.

Mozilla documents the modern build for current browsers and the translated/
polyfilled legacy build for Safari/older browsers:
https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#which-browsersenvironments-are-supported

The real document also exposed a React hydration error: comment dates used the
server/browser default time zones. The client now uses the school time zone
`Asia/Ho_Chi_Minh` consistently. The resulting browser checks have zero hydration
errors; no suppressHydrationWarning workaround was added.

## Implementation

- `PdfViewer.tsx` dynamically imports the legacy PDF.js bundle only on the client.
  Its matching versioned legacy worker is copied locally by the existing PDF asset
  preparation script; no CDN worker or UA sniffing.
- One page at a time, previous/next, page count, zoom 50–300%, fit width, loading
  progress, explicit error/retry, separate open/download links and mobile scroll.
- Each render owns a separate canvas. Cancellation cannot share an in-use canvas.
  Backing-store memory is bounded to approximately six million pixels, DPR capped
  at two, and page resources are cleaned after rendering. Text extraction failure
  does not discard an already painted canvas.
- Same-origin `/uploads/...pdf?inline=1` streams the configured project's public
  Storage object. It sets application/pdf, inline disposition, Accept-Ranges and
  preserves Content-Length/Content-Range/206. PDF.js uses 256 KiB ranges, with full
  auto-fetch/streaming disabled so first-page reading need not download the whole
  document on a mobile connection.
- Source URLs come only from the existing validated Storage-key abstraction, not
  arbitrary query URLs. No privileged key is forwarded, no redirects followed,
  compressed transfer disabled for byte-range consistency, and cancellation passes
  through the stream. No arrayBuffer/blob whole-file buffering in Railway.
- Ordinary legacy/media redirects remain unchanged. `?download=1` redirects to
  Supabase's attachment download using a safe path-derived filename. Local-provider
  inline/download handling remains supported. No database URLs/files were replaced.

## Verification and release state

TypeScript, lint, build and **81 automated tests PASS**, including four delivery
tests for streaming/cancellation, Range, traversal/arbitrary target refusal,
safe download redirect, unexpected MIME and sanitized upstream errors.

Real-file production-build browser verification PASS:
`test-results/pdf-public-7c831bc8-1d91-4f4b-9b72-634a3a9e2834/report.json`.
Chrome desktop, Android-size 412×915, WebKit iPhone-size 390×844, and a browser
without Map/WeakMap getOrInsertComputed all painted nonblank page 1 and a different
page 2, zoomed, fit width, rotated and reloaded successfully. Actual partial Range
reads were observed. Real download and new-tab opening passed. An intentional 503
showed the explicit fallback and retry subsequently rendered the real file.
These are browser-engine/viewport tests, not physical iPhone/Android/4G claims.

**Official public PDF verification PASS, 2026-10-15.** The operator corrected
Railway ADMIN_PASSWORD; production policy passed without weakening validation or
printing credentials. Redeployment `a5415c34-efb1-493f-ab41-890eff9a22a1` succeeded
on the existing service `02f7616f-5a1f-4522-b85b-e577d46424b6`, using the PDF
runtime committed in `5d6fb99`. The earlier failed deployment
`932bf5a4-bd56-4d97-ae7d-77387afed475` is superseded.

On `https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn`, all four real-file cases
passed: Chrome desktop, Android Chrome 412x915 with network/CPU throttling,
WebKit 390x844, and a browser without the new Map/WeakMap API. Evidence:
`test-results/pdf-public-1a91f3e3-752b-4416-8e3a-69577cc69841/report.json`.
Page 1/2 pixel checks, zoom, fit width, rotation, reload, actual PDF download,
new-tab opening and recovery after an intercepted first-read HTTP 503 passed.
No hydration or uncaught browser errors were recorded. Screenshots were inspected.
All four cases, including previous-page and zoom-out checks, also passed on
`https://thd-library-production.up.railway.app`:
`test-results/pdf-public-698a4b75-60ef-4209-87a7-787cd841ef30/report.json`.
This confirms the viewer/worker and legacy resolver are host-agnostic.

Additional previous-page and zoom-out checks passed in Chrome desktop/mobile and
in a separate WebKit run:
`test-results/pdf-public-efb852fb-2564-46db-b509-536520c33963/report.json`.
A preceding supplemental WebKit run timed out; the isolated rerun passed. An
earlier test also raced a canvas replacement during resize; the test now waits
for a nonzero canvas under the exact ready-page selector. These were not silently
discarded as successful runs. Physical phones/in-app browsers were not available.

The public same-origin PDF response was HTTP 206, application/pdf, inline
Content-Disposition and Accept-Ranges: bytes, with valid Content-Range. Actual
viewer reads used partial ranges. The worker is local and no CDN is required.
Same-origin PDF reads need no cross-origin credentials or CORS exception.

Post-release official-domain evidence (ignored artifacts):

- `browser-smoke-65dd3699-4d1f-405c-a895-c9e6bd3ee4f5/report.json`: 24 public
  desktop/mobile navigation, search, images, lists, news and wall-lightbox flows.
- `browser-production-657b4c91-c3da-42b0-bcae-89c8453093d8/report.json`: 27 real UI
  flows including Admin login/reload/logout, new QA document create/edit/archive,
  small uploads, PDF/audio/video/gallery, likes, comments/moderation, borrow/
  approval/return with restored stock, news and banners. No pre-existing content
  or Storage artifacts were deleted. The expected missing-contact borrow
  validation returned 400; the subsequent valid borrow completed.
- `pdf-release-auth-health.json`: health/hosted DB connected; Secure, HttpOnly,
  SameSite=Lax, Path=/ and future expiry; reload authenticated; logout invalidated
  the session even when its previous cookie was replayed. Cookie values omitted.
- `official-domain-seo-tls.json`: verified TLSv1.3, official canonical/OpenGraph,
  robots/sitemap, favicon, public indexing permission and Admin/API exclusions.
- `railway-storage-final-capacity.json`: 968.33 MiB across public/private buckets,
  both with a 50 MiB object limit. No cleanup performed. Review capacity before
  adding substantial content; cleanup requires explicit approval.
- `final-source-secrets-scan.json`: 215 source files, zero configured-secret hits,
  `.env.local` unchanged. No credentials, backups or browser artifacts committed.

Search Console Domain verification, sitemap submission and homepage indexing
request are operator-confirmed. Actual Google indexing is not claimed. The older
SEO probe's `searchConsoleVerified:false` only means that probe does not access
the operator's Google account.

Re-run the targeted public regression with WebKit installed in an ignored directory:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Projects/thd-library/test-results/playwright-browsers'
$env:TEST_BASE_URL='https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn'
$env:TEST_PDF_THROTTLE='true'
node scripts/verify-public-pdf.mjs
```

The Android case then includes CPU/network throttling. Use TEST_PDF_CASE for an
isolated engine and TEST_PDF_DOWNLOAD=false to avoid repeating a full download.
No large test uploads, Storage cleanup, DB reset/seed or `.env.local` modification
is needed. Subsequent changes here concern test synchronization/documentation;
the already verified production viewer did not require another runtime change.
Final TypeScript, lint, production build and all 81 automated tests passed again
after the test-script updates. No Docker/runtime source changed after the verified
Railway image, so no duplicate deployment or image rebuild was needed.
