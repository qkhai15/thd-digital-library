const test = require('node:test');
const assert = require('node:assert/strict');
const loader = require('./load-project.cjs');

function route() {
  return loader({'@/lib/upload-storage': {
    storagePublicUrl: key => `https://school.supabase.co/storage/v1/object/public/thd-library/${key}`,
    validStorageKey: key => key.split('/').every(p => /^[a-zA-Z0-9_.-]+$/.test(p) && !['.','..'].includes(p)),
  }})('src/app/uploads/[...path]/route.ts');
}
const context = {params: Promise.resolve({path:['supabase','documents','real.pdf']})};

test('inline PDFs stream Range bytes without whole-file buffering and propagate cancellation', async t => {
  const original = global.fetch; t.after(() => global.fetch = original);
  let cancelled = false; let input; let options;
  const stream = new ReadableStream({start(c) {c.enqueue(new Uint8Array([37,80,68,70]));}, cancel() {cancelled = true;}});
  global.fetch = async (url, init) => {
    input = String(url); options = init;
    const response = new Response(stream,{status:206,headers:{'content-type':'application/pdf','content-range':'bytes 0-3/100','content-length':'4'}});
    response.arrayBuffer = response.blob = async () => {throw new Error('Full buffering forbidden');};
    return response;
  };
  const response = await route().GET(new Request('https://library.example/uploads/supabase/documents/real.pdf?inline=1&url=http://attacker.invalid',{headers:{Range:'bytes=0-3'}}),context);
  assert.equal(response.status,206); assert.equal(response.headers.get('accept-ranges'),'bytes');
  assert.match(response.headers.get('content-disposition'),/^inline;/);
  assert.equal(response.headers.get('content-range'),'bytes 0-3/100');
  assert.equal(input,'https://school.supabase.co/storage/v1/object/public/thd-library/documents/real.pdf');
  assert.equal(options.headers.Range,'bytes=0-3'); assert.equal(options.redirect,'error');
  const reader = response.body.getReader(); assert.deepEqual([...((await reader.read()).value)],[37,80,68,70]);
  await reader.cancel(); assert.equal(cancelled,true);
});

test('inline PDF rejects traversal and multi-range before contacting Storage', async t => {
  const original = global.fetch; t.after(() => global.fetch = original); let calls = 0;
  global.fetch = async () => {calls++; throw new Error('Must not fetch');};
  const api = route();
  assert.equal((await api.GET(new Request('https://library.example/uploads/x?inline=1'),{params:Promise.resolve({path:['supabase','..','secret.pdf']})})).status,404);
  assert.equal((await api.GET(new Request('https://library.example/uploads/x?inline=1',{headers:{Range:'bytes=0-3,8-9'}}),context)).status,416);
  assert.equal(calls,0);
});

test('download retains scoped redirect with attachment query; ordinary media still redirects', async () => {
  const api = route();
  const download = await api.GET(new Request('https://library.example/uploads/x?download=evil%0D%0Aheader'),context);
  const url = new URL(download.headers.get('location'));assert.equal(download.status,307);
  assert.equal(url.searchParams.get('download'),'real.pdf');assert.equal(url.hostname,'school.supabase.co');
  assert.equal((await api.GET(new Request('https://library.example/uploads/x'),context)).status,307);
});

test('inline delivery refuses unexpected content and does not expose upstream error bodies', async t => {
  const original = global.fetch; t.after(() => global.fetch = original); const api = route();
  global.fetch = async () => new Response('<html>bad</html>',{headers:{'content-type':'text/html'}});
  assert.equal((await api.GET(new Request('https://library.example/uploads/x?inline=1'),context)).status,415);
  global.fetch = async () => new Response('private upstream error',{status:404,headers:{'content-length':'22'}});
  const response = await api.GET(new Request('https://library.example/uploads/x?inline=1'),context);
  assert.equal(response.status,404);assert.equal(await response.text(),'');assert.equal(response.headers.get('content-length'),null);
});
