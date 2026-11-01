const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NextRequest, NextResponse } = require('next/server');
const loader = require('./load-project.cjs');

const LIMIT = 1024 * 1024;

function streamedRequest(method, declaredLength) {
  const bytes = Buffer.from(JSON.stringify({ name: 'QA', content: 'x'.repeat(LIMIT) }));
  let offset = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      const chunk = bytes.subarray(offset, offset + 64 * 1024);
      offset += chunk.length;
      if (chunk.length) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() { cancelled = true; },
  });
  const headers = { 'content-type': 'application/json' };
  if (declaredLength !== undefined) headers['content-length'] = String(declaredLength);
  const request = new NextRequest('http://localhost:3000/api/test', { method, headers, body: stream, duplex: 'half' });
  return { request, cancelled: () => cancelled };
}

test('shared JSON parser caps actual bytes, cancels oversized streams, and preserves UTF-8 content', async () => {
  const { jsonBody, JSON_BODY_MAX_BYTES } = loader()('src/lib/backend-utils.ts');
  assert.equal(JSON_BODY_MAX_BYTES, LIMIT);
  for (const declaredLength of [undefined, 1, LIMIT + 1]) {
    const streamed = streamedRequest('POST', declaredLength);
    const response = await jsonBody(streamed.request);
    assert.ok(response instanceof NextResponse);
    assert.equal(response.status, 413);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { message: 'Dữ liệu yêu cầu vượt giới hạn 1 MiB.' });
    assert.equal(streamed.cancelled(), true);
  }
  const legitimate = {
    content: 'Thư viện Trần Hưng Đạo '.repeat(2000),
    description: 'Đ'.repeat(20_000),
    gallery_urls: Array.from({ length: 100 }, (_, index) => `/uploads/gallery/${index}/${'a'.repeat(1970)}.jpg`),
  };
  const encoded = JSON.stringify(legitimate);
  assert.ok(Buffer.byteLength(encoded) < LIMIT);
  assert.deepEqual(await jsonBody(new Request('http://localhost/api/test', { method: 'POST', body: encoded })), legitimate);
  const prefix = '{"content":"';
  const exact = `${prefix}${'x'.repeat(LIMIT - prefix.length - 2)}"}`;
  assert.equal(Buffer.byteLength(exact), LIMIT);
  assert.equal((await jsonBody(new Request('http://localhost/api/test', { method: 'POST', body: exact }))).content.length, LIMIT - prefix.length - 2);
  for (const body of ['{malformed', '[]', 'null', '']) {
    assert.deepEqual(await jsonBody(new Request('http://localhost/api/test', { method: 'POST', body })), {});
  }
});

const routes = [
  ['src/app/api/library/[id]/borrow/route.ts', 'POST'],
  ['src/app/api/library/[id]/comments/route.ts', 'POST'],
  ['src/app/api/admin/documents/route.ts', 'POST'],
  ['src/app/api/admin/documents/[id]/route.ts', 'PUT'],
  ['src/app/api/admin/news/route.ts', 'POST'],
  ['src/app/api/admin/news/[id]/route.ts', 'PUT'],
  ['src/app/api/admin/settings/route.ts', 'PUT'],
  ['src/app/api/admin/comments/[id]/route.ts', 'PATCH'],
  ['src/app/api/admin/borrows/[id]/route.ts', 'PATCH'],
  ['src/app/api/admin/banners/route.ts', 'POST'],
  ['src/app/api/admin/banners/[id]/route.ts', 'PUT'],
];

test('every shared JSON mutation handler returns sanitized 413 without opening a transaction or writing data', async () => {
  const keys = ['APP_ORIGIN', 'PUBLIC_ORIGINS', 'PRODUCTION_REMOTE_ONLY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => { delete process.env[key]; });
  let opened = 0;
  let writes = 0;
  let audits = 0;
  const db = {
    connect: async () => { opened++; throw new Error('Unexpected transaction'); },
    query: async sql => {
      if (!/^\s*SELECT\b/i.test(sql)) { writes++; throw new Error('Unexpected write'); }
      return { rows: [{ id: 1, slug: 'existing', type: 'sach-giay', stock: 1 }], rowCount: 1 };
    },
  };
  const load = loader({
    '@/lib/db': { ensureSchema: async () => {}, db },
    '@/lib/admin-auth': {
      isAdmin: async () => true,
      getAdminSession: async () => ({ username: 'QA' }),
      auditLog: async () => { audits++; },
    },
  });
  try {
    for (const [file, method] of routes) {
      const route = load(file);
      for (const declaredLength of [undefined, 1, LIMIT + 1]) {
        const { request } = streamedRequest(method, declaredLength);
        const response = await route[method](request, { params: Promise.resolve({ id: '1' }) });
        assert.equal(response.status, 413, `${file} content-length=${declaredLength}`);
        assert.equal(response.headers.get('cache-control'), 'no-store', file);
        assert.deepEqual(await response.json(), { message: 'Dữ liệu yêu cầu vượt giới hạn 1 MiB.' }, file);
      }
    }
    assert.equal(opened, 0);
    assert.equal(writes, 0);
    assert.equal(audits, 0);
    const actual = [];
    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(filename);
        else if (filename.endsWith('route.ts') && /await jsonBody\(request\)/.test(fs.readFileSync(filename, 'utf8'))) actual.push(filename.replaceAll('\\', '/'));
      }
    }
    walk('src/app/api');
    assert.deepEqual(actual.sort(), routes.map(([file]) => file).sort(), 'All shared JSON callers must retain overflow coverage.');
  } finally {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});
