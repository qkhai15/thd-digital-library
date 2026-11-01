import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local", quiet: true });
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", ...Object.values(networkInterfaces()).flat().filter(Boolean).map(entry => entry.address)]);
const origins = process.argv.slice(2);
if (!origins.length) origins.push("http://localhost:3000");
for (const value of origins) {
  const url = new URL(value);
  assert.ok(localHosts.has(url.hostname) && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password, "Chỉ gửi credentials tới địa chỉ local của máy hiện tại.");
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const value of origins) {
    const origin = new URL(value).origin;
    const endpoint = `${origin}/api/admin/login`;
    for (const json of [false, true]) {
      const contentType = json ? "application/json" : "application/x-www-form-urlencoded";
      const fields = { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD };
      assert.ok(fields.username && fields.password, "Thiếu tài khoản cấu hình.");
      const response = await fetch(endpoint, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(20000),
        headers: { origin, "sec-fetch-site": "same-origin", "Content-Type": contentType },
        body: json ? JSON.stringify(fields) : new URLSearchParams(fields).toString(),
      });
      const setCookie = response.headers.get("set-cookie") || "";
      const cookie = setCookie.split(";")[0];
      const location = response.headers.get("location");
      console.log(JSON.stringify({ origin, method: "POST", url: endpoint, contentType, bodyFields: Object.keys(fields), status: response.status, location, httpOnly: /httponly/i.test(setCookie), secure: /;\s*secure(?:;|$)/i.test(setCookie) }));
      assert.equal(response.status, json ? 200 : 303, await response.clone().text());
      if (!json) assert.equal(location, `${origin}/admin`);
      assert.match(setCookie, /httponly/i);
      assert.match(setCookie, /samesite=lax/i);
      assert.equal(/;\s*secure(?:;|$)/i.test(setCookie), new URL(origin).protocol === "https:");
      const session = await fetch(`${origin}/api/admin/session`, { headers: { cookie }, signal: AbortSignal.timeout(20000) });
      assert.equal(session.status, 200);
      assert.equal((await session.json()).authenticated, true);
      const admin = await fetch(`${origin}/admin`, { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(20000) });
      assert.equal(admin.status, 200);
      const token = cookie.slice(cookie.indexOf("=") + 1);
      const result = await pool.query("SELECT 1 FROM admin_sessions WHERE token_hash=$1 AND expires_at > NOW()", [createHash("sha256").update(token).digest("hex")]);
      assert.equal(result.rowCount, 1);
      console.log("PASS: session database, GET session authenticated=true, GET admin=200; token/credentials được giữ kín.");
    }
    const blocked = await fetch(endpoint, { method: "POST", headers: { origin: "https://untrusted.example", "sec-fetch-site": "cross-site", "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(20000) });
    assert.equal(blocked.status, 403);
    assert.equal((await fetch(endpoint, { signal: AbortSignal.timeout(20000) })).status, 405);
    console.log("PASS: cross-site POST=403; GET login API=405.");
  }
} finally { await pool.end(); }
