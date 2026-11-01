import assert from "node:assert/strict";
import dotenv from "dotenv";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";

// Read-only content checks. Admin sign-in only creates its normal temporary session.
dotenv.config({path:".env.local",quiet:true});
const origin = process.env.SMOKE_URL || "http://localhost:3100";
if (!["localhost","127.0.0.1","[::1]"].includes(new URL(origin).hostname)) throw new Error("Smoke test chỉ gửi thông tin đăng nhập tới server local.");
async function get(url,cookie) {
  const response = await fetch(new URL(url,origin),{headers:cookie?{cookie}:{},redirect:"manual"});
  return response;
}
const health = await get("/api/health");
assert.equal(health.status,200,"Database health");
assert.equal((await health.json()).ok,true);
for (const route of ["/","/tai-lieu/moi-nhat","/tai-lieu/sach-giay","/tai-lieu/sach-dien-tu","/tai-lieu/sach-noi","/tai-lieu/video","/tai-lieu/album","/tai-lieu/tai-lieu-khac","/tin-tuc","/tim-kiem?q=sach","/admin/login"]) {
  assert.equal((await get(route)).status,200,route);
}
for (const query of ["type=moi-nhat","sort=popular"]) {
  const result=await (await get(`/api/library?${query}`)).json();
  assert.ok(result.items.every(item=>!["video","album","ky-nang-song","bai-giang-dien-tu"].includes(item.type)),query);
}
assert.equal((await get("/api/admin/documents")).status,401);
const disabled = await get("/tai-lieu/ky-nang-song");
assert.match(await disabled.text(),/Không tìm thấy nội dung/);
assert.equal((await get("/api/library?page=Infinity&limit=1.5")).status,200);
// Create one disposable fixture AFTER server startup, then remove only that fixture.
const fixtureDir = await mkdtemp(path.join(process.cwd(),"public","uploads",".smoke-"));
const fixture = path.join(fixtureDir,"range.pdf");
try {
  const bytes = Buffer.from("%PDF-1.7\nSMOKE-FILE-1234567890");
  await writeFile(fixture,bytes,{flag:"wx"});
  const url = new URL(`/uploads/${path.basename(fixtureDir)}/range.pdf`,origin);
  const response = await fetch(url,{headers:{range:"bytes=0-7"}});
  assert.equal(response.status,206,"File mới phục vụ ngay sau startup");
  assert.equal(response.headers.get("content-range"),`bytes 0-7/${bytes.length}`);
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(),bytes.subarray(0,8).toString());
  assert.equal((await fetch(url,{method:"HEAD"})).status,200);
} finally { await unlink(fixture).catch(()=>{}); await rmdir(fixtureDir); }
if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  const response=await fetch(new URL("/api/admin/login",origin),{
    method:"POST",headers:{"Content-Type":"application/json",origin},
    body:JSON.stringify({username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD}),redirect:"manual",
  });
  assert.equal(response.status,200,"Admin login");
  const cookie=response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie,"Admin cookie");
  for (const route of ["/admin","/admin/news","/admin/operations","/api/admin/documents","/api/admin/dashboard","/api/admin/news","/api/admin/banners","/api/admin/borrows?limit=25&page=1","/api/admin/comments?limit=25&page=1","/api/admin/audit?limit=25&page=1","/api/admin/settings"]) {
    assert.equal((await get(route,cookie)).status,200,route);
  }
  console.log("PASS: trang công khai, PostgreSQL, cookie admin, API quản trị. Không thay đổi nội dung.");
} else console.log("PASS: trang công khai/PostgreSQL. Bỏ qua đăng nhập vì thiếu tài khoản trong môi trường local.");
