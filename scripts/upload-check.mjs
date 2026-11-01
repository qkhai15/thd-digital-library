import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
const origin = new URL(process.env.UPLOAD_TEST_URL || "http://localhost:3100").origin;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const request = (url, options = {}) => fetch(new URL(url, origin), { ...options, signal: AbortSignal.timeout(60000) });
// Actual HTTP upload integration test. No library records or existing files are deleted.
// Newly uploaded files are deliberately retained, with a manifest for later review.
const login = await request("/api/admin/login", { method: "POST", headers: { origin, "content-type": "application/json" },
  body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }) });
assert.equal(login.status, 200, "Admin login");
const cookie = login.headers.getSetCookie().find(value => value.startsWith("thd_admin_session="))?.split(";")[0];
assert.ok(cookie, "HttpOnly admin session cookie");
const results = [];
async function upload(kind, bytes, filename, type, authenticated = true, site = origin) {
  const body = new FormData();
  body.set("kind", kind);
  body.set("file", new File([bytes], filename, { type }));
  return request("/api/admin/upload", { method: "POST", headers: { origin: site, ...(authenticated ? { cookie } : {}) }, body });
}
try {
  const inputs = [
    ["image", "cover", "test-1.jpg", "image/jpeg"],
    ["PDF", "document", "test.pdf", "application/pdf"],
    ["audio", "audio", "test.wav", "audio/wav"],
    ["video", "video", "test.mp4", "video/mp4"],
    ["album-1", "gallery", "test-1.jpg", "image/jpeg"],
    ["album-2", "gallery", "test-2.jpg", "image/jpeg"],
    ["news", "cover", "test-1.jpg", "image/jpeg"],
    ["wall-banner", "banner", "test-1.jpg", "image/jpeg"],
  ];
  for (const [flow, kind, fixture, mime] of inputs) {
    const bytes = await readFile(`tests/browser-fixtures/${fixture}`);
    const response = await upload(kind, bytes, fixture, mime);
    const stored = await response.json();
    assert.equal(response.status, 201, `${flow}: ${stored.message || "upload"}`);
    assert.equal(stored.mime, mime);
    assert.equal(stored.size, bytes.length);
    if (process.env.UPLOAD_TEST_EXPECT_DRIVER) assert.equal(stored.driver, process.env.UPLOAD_TEST_EXPECT_DRIVER);
    for (const secret of [process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean)) assert.ok(!JSON.stringify(stored).includes(secret));
    const download = await request(stored.url);
    assert.equal(download.status, 200, `${flow} download`);
    assert.equal(hash(Buffer.from(await download.arrayBuffer())), hash(bytes), `${flow} bytes`);
    const head = await request(stored.url, { method: "HEAD" });
    assert.equal(head.status, 200, `${flow} HEAD`);
    const range = await request(stored.url, { headers: { range: "bytes=0-15" } });
    assert.equal(range.status, 206, `${flow} Range`);
    assert.equal((await range.arrayBuffer()).byteLength, 16);
    results.push({ flow, ...stored, sha256: hash(bytes), result: "PASS" });
    console.log(`PASS ${flow}: ${stored.driver}, upload/read/hash/HEAD/Range`);
  }
  const pdf = await readFile("tests/browser-fixtures/test.pdf");
  assert.equal((await upload("document", pdf, "file.pdf", "application/pdf", false)).status, 401);
  assert.equal((await upload("document", pdf, "file.pdf", "application/pdf", true, "https://untrusted.example")).status, 403);
  assert.equal((await upload("document", pdf, "file.jpg", "application/pdf")).status, 415);
  assert.equal((await upload("document", pdf, "file.pdf", "image/jpeg")).status, 415);
  assert.equal((await upload("document", Buffer.from("invalid document"), "file.pdf", "application/pdf")).status, 415);
  console.log("PASS unauthorized/cross-origin/signature/extension/MIME rejection");
} finally {
  await mkdir("test-results", { recursive: true });
  await writeFile(`test-results/upload-${Date.now()}.json`, JSON.stringify({ origin, results }, null, 2));
  await request("/api/admin/logout", { method: "POST", headers: { origin, cookie } });
}
