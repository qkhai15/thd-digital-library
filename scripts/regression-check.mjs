import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

// Read-only verification of records created through the browser in this QA run.
dotenv.config({ path: ".env.local", quiet: true });
const origin = "http://localhost:3000";
const prefix = "REGRESSION 1210 R3";
const archived = process.argv.includes("--archived");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const get = url => fetch(new URL(url, origin), { signal: AbortSignal.timeout(20000) });
try {
  const { rows: items } = await pool.query("SELECT id,title,type,status,stock,likes,views,file_url,cover_url,gallery_urls,description FROM library_items WHERE title LIKE $1 ORDER BY id", [`${prefix}%`]);
  assert.equal(items.length, 5);
  for (const item of items) {
    assert.equal(item.status, archived ? "archived" : "published");
    if (item.type === "sach-giay") {
      assert.equal(item.stock, 2);
      assert.match(item.description, /Đã sửa bằng browser/);
    }
    if (item.type === "album") {
      assert.equal(item.cover_url, null);
      assert.equal(item.gallery_urls.length, 2);
    }
    const files = item.type === "album" ? item.gallery_urls.map((url, i) => [url, `test-${i + 1}.jpg`])
      : item.type === "sach-giay" ? [[item.cover_url, "test-1.jpg"]]
      : [[item.file_url, {"sach-dien-tu":"test.pdf","sach-noi":"test.wav",video:"test.mp4"}[item.type]]];
    for (const [url, fixture] of files) {
      const response = await get(url);
      assert.equal(response.status, 200, url);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(await readFile(path.join("tests/browser-fixtures", fixture))));
      const head = await fetch(new URL(url, origin), {method:"HEAD",signal:AbortSignal.timeout(20000)});
      assert.equal(head.status, 200);
      if (item.file_url) {
        const range = await fetch(new URL(url, origin), {headers:{range:"bytes=0-15"},signal:AbortSignal.timeout(20000)});
        assert.equal(range.status,206);
        assert.equal((await range.arrayBuffer()).byteLength,16);
      }
    }
  }
  const borrow = await pool.query("SELECT status FROM borrow_requests WHERE borrower_name=$1", [prefix]);
  assert.ok(borrow.rowCount > 0 && borrow.rows.every(row => row.status === "returned"));
  const comments = await pool.query("SELECT status FROM library_comments WHERE name=$1", [prefix]);
  assert.ok(comments.rowCount > 0 && comments.rows.every(row => row.status === "hidden"));
  const news = await pool.query("SELECT status,excerpt FROM news_posts WHERE title LIKE $1", [`${prefix}%`]);
  assert.equal(news.rowCount,1);
  assert.equal(news.rows[0].status, archived ? "archived" : "published");
  assert.match(news.rows[0].excerpt,/Đã sửa tin tức/);
  const banners = await pool.query("SELECT is_active,title FROM wall_banners WHERE title LIKE $1", [`${prefix}%`]);
  assert.equal(banners.rowCount,1);
  assert.equal(banners.rows[0].is_active,false);
  assert.match(banners.rows[0].title,/đã sửa/);
  const setting = await pool.query("SELECT value FROM site_settings WHERE key='comments_require_approval'");
  assert.equal(setting.rows[0].value,false);
  const visible = await (await get(`/api/library?q=${encodeURIComponent(prefix)}`)).json();
  assert.equal(visible.items.length, archived ? 0 : 5);
  for (const query of ["type=moi-nhat", "sort=popular"]) {
    const result = await (await get(`/api/library?${query}`)).json();
    assert.ok(result.items.every(item => !["video", "album"].includes(item.type)));
  }
  const { version } = JSON.parse(await readFile("node_modules/pdfjs-dist/package.json", "utf8"));
  const worker = await get(`/pdfjs/${version}/pdf.worker.min.mjs`);
  assert.equal(worker.status,200);
  assert.match(await worker.text(),/WorkerMessageHandler/);
  console.log(JSON.stringify({stage:archived?"archived":"published",items:items.map(({id,type,status,stock,views,likes})=>({id,type,status,stock,views,likes})),borrowCount:borrow.rowCount,commentCount:comments.rowCount}));
  console.log("PASS: browser-created records persisted, media hashes/HEAD/ranges, news/banner changes, returned stock, hidden comments, restored settings, PDF worker and public list rules. No database mutation by this script.");
} finally { await pool.end(); }
