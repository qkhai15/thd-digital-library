const test = require('node:test');
const assert = require('node:assert/strict');
const loader = require('./load-project.cjs');
const { readLimitedFormData, RequestBodyTooLargeError } = loader()('src/lib/request-body.ts');

function multipart(bytes, length) {
  const boundary = 'thd-bounded-upload';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nvideo\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.mp4"\r\nContent-Type: video/mp4\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  let offset = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      if (offset === body.length) return controller.close();
      const next = Math.min(body.length, offset + 32);
      controller.enqueue(body.subarray(offset, next));
      offset = next;
    },
    cancel() { cancelled = true; },
  });
  const headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  if (length !== undefined) headers['content-length'] = String(length);
  return {
    request: new Request('http://localhost/upload', { method: 'POST', body: stream, headers, duplex: 'half' }),
    size: body.length,
    consumed: () => offset,
    cancelled: () => cancelled,
  };
}

test('multipart accepts a body exactly at the cap without Content-Length', async () => {
  const bytes = Buffer.from('0000ftypisom-test-video');
  const source = multipart(bytes);
  assert.equal(source.request.headers.has('content-length'), false);
  const form = await readLimitedFormData(source.request, source.size);
  assert.equal(form.get('kind'), 'video');
  assert.equal(form.get('file').name, 'test.mp4');
  assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()), bytes);
});

test('chunked or understated bodies exceeding the cap cancel before full buffering', async () => {
  for (const declared of [undefined, 1]) {
    const source = multipart(Buffer.alloc(4096), declared);
    await assert.rejects(readLimitedFormData(source.request, 384), RequestBodyTooLargeError);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(source.cancelled(), true);
    assert.ok(source.consumed() < source.size);
  }
});

test('declared oversized requests are rejected before multipart parsing', async () => {
  const source = multipart(Buffer.alloc(4096), 1000);
  await assert.rejects(readLimitedFormData(source.request, 999), RequestBodyTooLargeError);
  assert.equal(source.cancelled(), true);
  assert.ok(source.consumed() < source.size);
});

test('invalid multipart within the cap remains a parser error', async () => {
  const request = new Request('http://localhost/upload', {
    method: 'POST', duplex: 'half', headers: { 'content-type': 'application/octet-stream' },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8)); controller.close(); } }),
  });
  await assert.rejects(readLimitedFormData(request, 1024), error => !(error instanceof RequestBodyTooLargeError));
});

test('upload route maps capped bodies to 413 without bypassing authentication', async () => {
  let authenticated = true;
  let stored = 0;
  const route = loader({
    '@/lib/admin-auth': { isAdmin: async () => authenticated, auditLog: async () => {} },
    '@/lib/backend-utils': { sameOriginAllowed: () => true },
    '@/lib/upload-storage': { storageDriver:()=> 'supabase', UploadValidationError: class extends Error {}, storeUpload: async () => { stored++; } },
  })('src/app/api/admin/upload/route.ts');
  const source = multipart(Buffer.alloc(128), 16 * 1024 * 1024 + 1);
  assert.equal((await route.POST(source.request)).status, 413);
  assert.equal(stored, 0);
  authenticated = false;
  assert.equal((await route.POST(new Request('http://localhost/upload', { method: 'POST' }))).status, 401);
});
