import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { signedTransfer } from './verify-signed-transfer.mjs';

// Explicit runtime env only: this harness never reads or edits .env.local.
// HTTP/API evidence is separate from a real visual/browser regression.
const env = { ...(process.env.TEST_ENV_FILE ? dotenv.parse(await readFile(process.env.TEST_ENV_FILE)) : {}), ...process.env };
const base = new URL(env.TEST_BASE_URL || 'http://127.0.0.1:3107');
if (base.username || base.password || !['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid TEST_BASE_URL.');
const origin = new URL(env.TEST_ORIGIN || base.origin).origin;
const proxyHeaders = origin === base.origin ? {} : { 'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': new URL(origin).protocol.slice(0, -1) };
const runId = randomUUID();
const prefix = `QA PRODUCTION ${runId}`;
const started = new Date().toISOString();
const reportPath = path.join('test-results', `production-regression-${runId}.json`);
const evidence = [];
const owned = { documents: [], comments: [], borrows: [], news: [], banners: [], uploads: [] };
const allowDelete = env.TEST_DELETE_OWN_QA === 'true';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cookieJar = new Map([['thd_visitor_id', randomUUID()]]);
const ua = `thd-production-regression/${runId}`;
let pool;
let preservation;
let result = 'FAIL';
let safeFailure = null;

function note(name, details = {}) { evidence.push({ name, result: 'PASS', ...details }); }
function skip(name, reason) { evidence.push({ name, result: 'SKIP', reason }); }
async function persist() {
  await mkdir('test-results', { recursive: true });
  await writeFile(reportPath, JSON.stringify({ runId, started, finished: new Date().toISOString(), baseHost: base.host, origin, result, failure: safeFailure, evidence, owned, preservation, scope: 'Real HTTP/API and database checks; no browser rendering assertion. Only manifest-owned newly-created QA records may be modified/deleted; uploaded files are retained.' }, null, 2));
}
async function call(route, { method = 'GET', body, form, expected = 200, admin = true, headers = {}, raw = false } = {}) {
  const target = new URL(route, base);
  const response = await fetch(target, {
    method, redirect: 'manual', signal: AbortSignal.timeout(120000),
    headers: { ...proxyHeaders, origin, 'user-agent': ua, ...(admin ? { cookie: [...cookieJar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : form ? { body: form } : {}),
  });
  if (admin) for (const value of response.headers.getSetCookie()) {
    const pair = value.split(';')[0]; const index = pair.indexOf('=');
    cookieJar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  const statuses = Array.isArray(expected) ? expected : [expected];
  assert.ok(statuses.includes(response.status), `${method} ${target.pathname}: expected ${statuses.join('/')}, got ${response.status}`);
  evidence.push({ name: `${method} ${target.pathname}`, result: 'PASS', status: response.status });
  if (raw) return response;
  return response.headers.get('content-type')?.includes('application/json') ? response.json() : response.text();
}
async function login(form = false) {
  assert.ok(env.ADMIN_USERNAME && env.ADMIN_PASSWORD, 'ADMIN_USERNAME and ADMIN_PASSWORD are required.');
  const response = form
    ? await call('/api/admin/login', { method: 'POST', form: new URLSearchParams({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }), headers: { 'content-type': 'application/x-www-form-urlencoded' }, expected: 303, raw: true })
    : await call('/api/admin/login', { method: 'POST', body: { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }, raw: true });
  const sessionCookie = response.headers.getSetCookie().find(value => value.startsWith('thd_admin_session='));
  assert.ok(sessionCookie && /HttpOnly/i.test(sessionCookie) && /SameSite=Lax/i.test(sessionCookie), 'Admin cookie flags');
  if (origin.startsWith('https:')) assert.match(sessionCookie, /Secure/i, 'HTTPS admin cookie requires Secure.');
  if (form) assert.equal(new URL(response.headers.get('location')).pathname, '/admin');
  assert.equal((await call('/api/admin/session')).authenticated, true);
  const refresh = await call('/api/admin/session', { raw: true });
  assert.match(refresh.headers.get('cache-control') || '', /no-store/);
  assert.equal((await refresh.json()).authenticated, true);
  note(form ? 'HTML form login/cookie/redirect/refresh' : 'JSON login/cookie/session/refresh');
}
async function initDatabase() {
  const raw = env.TEST_DATABASE_URL || env.DATABASE_URL;
  if (!raw) { skip('database preservation/TLS/session expiry', 'TEST_DATABASE_URL or DATABASE_URL not supplied.'); return; }
  const url = new URL(raw);
  assert.ok(!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Regression database must be hosted.');
  const caFile = env.TEST_DB_SSL_CA_FILE || env.DB_SSL_CA_FILE;
  let ssl;
  if (env.DB_SSL_CA_BASE64 && !caFile) {
    ssl = { ca: Buffer.from(env.DB_SSL_CA_BASE64, 'base64').toString('utf8'), rejectUnauthorized: true };
    // pg URI ssl query overrides ssl options; supply explicit CA config instead.
    for (const name of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(name);
  } else {
    assert.ok(caFile, 'DB CA certificate required for hosted verification.');
    url.searchParams.set('sslmode', 'verify-full'); url.searchParams.set('sslrootcert', path.resolve(caFile));
  }
  pool = new pg.Pool({ connectionString: url.toString(), ...(ssl ? { ssl } : {}), max: 2, connectionTimeoutMillis: 15000 });
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    const socket = client.connection.stream;
    assert.equal(socket.encrypted, true); assert.equal(socket.authorized, true);
    note('hosted PostgreSQL verified TLS', { encrypted: true, authorized: true, protocol: socket.getProtocol() });
  } finally { client.release(); }
  const tables = await pool.query(`SELECT c.relname AS name, array_agg(a.attname::text ORDER BY u.ord) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_constraint p ON p.conrelid=c.oid AND p.contype='p'
    CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY AS u(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=u.attnum
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) GROUP BY c.relname`, [['thd_schema_migrations', 'library_items', 'library_comments', 'library_likes', 'library_views', 'borrow_requests', 'news_posts', 'wall_banners', 'site_settings', 'admin_sessions', 'admin_login_attempts', 'audit_logs', 'storage_upload_intents']]);
  preservation = [];
  for (const table of tables.rows) {
    assert.match(table.name, /^[a-z_]+$/);
    const rows = (await pool.query(`SELECT to_jsonb(t) AS record FROM public.${table.name} t`)).rows.map(row => row.record);
    const records = new Map(rows.map(row => [JSON.stringify(table.columns.map(col => row[col])), JSON.stringify(row)]));
    preservation.push({ table: table.name, columns: table.columns, oldCount: rows.length, beforeHash: hash([...records.values()].sort().join('\n')), records });
  }
  note('pre-test existing data fingerprints captured', { tables: preservation.length });
}
async function verifyPreservation() {
  if (!pool || !preservation) return;
  for (const table of preservation) {
    const rows = (await pool.query(`SELECT to_jsonb(t) AS record FROM public.${table.table} t`)).rows.map(row => row.record);
    const retained = rows.filter(row => table.records.has(JSON.stringify(table.columns.map(col => row[col]))));
    table.afterOldCount = retained.length; table.afterHash = hash(retained.map(row => JSON.stringify(row)).sort().join('\n'));
    assert.equal(table.afterOldCount, table.oldCount, `Old rows retained: ${table.table}`);
    assert.equal(table.afterHash, table.beforeHash, `Old row contents unchanged: ${table.table}`);
  }
  preservation = preservation.map(table => { const safe = { ...table }; delete safe.records; return safe; });
  note('all pre-existing rows unchanged');
}
async function readMedia(url, { bytes, range = false, label = 'media' } = {}) {
  const resolved = new URL(url, base);
  const response = await fetch(resolved, { headers: range ? { range: 'bytes=0-15' } : {}, signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, range ? 206 : 200, label);
  if (range) {
    assert.match(response.headers.get('content-range') || '', /^bytes 0-15\//);
    assert.equal((await response.arrayBuffer()).byteLength, 16);
  } else if (bytes) assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(bytes));
  else await response.body?.cancel();
  note(label, { status: response.status, host: resolved.host });
}
async function uploadSmall(kind, fixture, mime) {
  const bytes = await readFile(path.join(env.TEST_FIXTURE_DIR || 'tests/browser-fixtures', fixture));
  const form = new FormData(); form.set('kind', kind); form.set('file', new File([bytes], `qa-${runId}-${fixture}`, { type: mime }));
  const record = await call('/api/admin/upload', { method: 'POST', form, expected: 201 });
  assert.equal(record.driver, 'supabase'); assert.equal(record.size, bytes.length);
  owned.uploads.push({ kind, url: record.url, size: record.size, retained: true }); await persist();
  await readMedia(record.url, { bytes, label: `${kind} small upload bytes` });
  if (['document', 'audio', 'video'].includes(kind)) await readMedia(record.url, { range: true, label: `${kind} small upload Range` });
  return record.url;
}
async function runSmallUploads() {
  if (env.TEST_UPLOADS === 'false') { skip('small upload kinds', 'TEST_UPLOADS=false'); return {}; }
  const media = {};
  media.cover = await uploadSmall('cover', 'test-1.jpg', 'image/jpeg');
  media.news = await uploadSmall('cover', 'test-2.jpg', 'image/jpeg');
  media.banner = await uploadSmall('banner', 'test-1.jpg', 'image/jpeg');
  media.gallery = [await uploadSmall('gallery', 'test-1.jpg', 'image/jpeg'), await uploadSmall('gallery', 'test-2.jpg', 'image/jpeg')];
  media.pdf = await uploadSmall('document', 'test.pdf', 'application/pdf');
  media.audio = await uploadSmall('audio', 'test.wav', 'audio/wav');
  media.video = await uploadSmall('video', 'test.mp4', 'video/mp4');
  note('all seven persistent upload uses (gallery multiple)', { uses: ['cover', 'PDF', 'audio', 'video', 'album gallery', 'news image', 'wall banner'] });
  const missing = new FormData(); missing.set('kind', 'cover');
  await call('/api/admin/upload', { method: 'POST', form: missing, expected: 400 });
  const invalid = new FormData(); invalid.set('kind', 'cover'); invalid.set('file', new File([Buffer.from('invalid file content')], 'wrong.jpg', { type: 'image/jpeg' }));
  await call('/api/admin/upload', { method: 'POST', form: invalid, expected: 415 });
  const mismatch = new FormData(); mismatch.set('kind', 'document'); mismatch.set('file', new File([await readFile(path.join(env.TEST_FIXTURE_DIR || 'tests/browser-fixtures', 'test.pdf'))], 'wrong.mp4', { type: 'video/mp4' }));
  await call('/api/admin/upload', { method: 'POST', form: mismatch, expected: 415 });
  return media;
}
async function runDirectUploads() {
  const limits = await call('/api/admin/upload/limits');
  assert.equal(limits.driver, 'supabase');
  const maximum = limits.maxBytes.video;
  await call('/api/admin/upload/sign', { method: 'POST', body: { kind: 'video', documentType: 'video', fileName: 'oversized.mp4', mime: 'video/mp4', size: maximum + 1 }, expected: 413 });
  await call('/api/admin/upload/sign', { method: 'POST', body: { kind: 'video', documentType: 'sach-giay', fileName: 'wrong.mp4', mime: 'video/mp4', size: 1024 }, expected: 400 });
  await call('/api/admin/upload/sign', { method: 'POST', body: { kind: 'video', documentType: 'video', fileName: '../wrong.mp4', mime: 'video/mp4', size: 1024 }, expected: 400 });
  await call('/api/admin/upload/sign', { method: 'POST', body: { kind: 'video', documentType: 'video', fileName: 'wrong.pdf', mime: 'video/mp4', size: 1024 }, expected: 415 });
  note('effective Storage file limit/early rejection', { maximumBytes: maximum });
  if (env.SUPABASE_URL) {
    const storageUrl = new URL(env.SUPABASE_URL);
    const endpointOrigin = /^[-a-z0-9]+\.supabase\.co$/.test(storageUrl.hostname) ? `https://${storageUrl.hostname.replace('.supabase.co', '.storage.supabase.co')}` : storageUrl.origin;
    const preflight = await fetch(`${endpointOrigin}/storage/v1/upload/resumable/sign`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,tus-resumable,upload-length,upload-metadata,x-signature,x-upsert' }, signal: AbortSignal.timeout(30000) });
    assert.ok(preflight.ok, 'Supabase signed TUS CORS preflight status.');
    assert.ok(['*', origin].includes(preflight.headers.get('access-control-allow-origin')), 'Supabase signed TUS CORS origin.');
    const allowed = (preflight.headers.get('access-control-allow-headers') || '').toLowerCase();
    for (const header of ['x-signature', 'x-upsert', 'tus-resumable', 'upload-length', 'upload-metadata']) assert.ok(allowed === '*' || allowed.includes(header), `Signed TUS CORS allows ${header}.`);
    note('Supabase signed direct CORS preflight (no token/object allocated)');
  } else skip('signed direct CORS preflight', 'SUPABASE_URL not supplied to HTTP harness.');
  if (env.TEST_DIRECT_UPLOADS === 'false') { skip('repeat large direct/resumable upload', 'TEST_DIRECT_UPLOADS=false; reuse production Docker 16/32/48 MiB proof to conserve Free Storage capacity. Metadata-only guards still ran.'); return; }
  const source = await readFile(path.join(env.TEST_FIXTURE_DIR || 'tests/browser-fixtures', 'test.mp4'));
  const sizes = (env.TEST_DIRECT_SIZES_MIB || '16,32,48').split(',').map(Number);
  for (const mib of sizes) {
    assert.ok(Number.isSafeInteger(mib) && mib > 0 && mib * 1024 ** 2 <= maximum, 'TEST_DIRECT_SIZES_MIB must respect effective limit.');
    // Preserve the playable MP4 and append a valid ISO BMFF free box.
    const bytes = Buffer.alloc(mib * 1024 ** 2); source.copy(bytes);
    assert.ok(bytes.length > source.length + 8, 'Video fixture must fit direct-upload target.');
    bytes.writeUInt32BE(bytes.length - source.length, source.length); bytes.write('free', source.length + 4);
    const metadata = { kind: 'video', documentType: 'video', fileName: `qa-${runId}-${mib}.mp4`, mime: 'video/mp4', size: bytes.length };
    const intent = await call('/api/admin/upload/sign', { method: 'POST', body: metadata, expected: 201 });
    assert.ok(intent.token && intent.endpoint && intent.path); assert.ok(!intent.path.includes('..'));
    const hosts = new Set(); const onRequest = info => { assert.notEqual(info.host, base.host, 'File bytes must bypass application server.'); hosts.add(info.host); };
    const transfer = await signedTransfer(bytes, intent, { pauseAfterChunk: mib === sizes[0], onRequest });
    if (transfer.paused) {
      const resumed = await call('/api/admin/upload/sign', { method: 'POST', body: { ...metadata, resumeId: intent.id }, expected: 201 });
      assert.equal(resumed.id, intent.id);
      await signedTransfer(bytes, resumed, { resumeUrl: transfer.url, onRequest });
      note('direct pause/resume', { mib, offset: transfer.offset });
    }
    const done = await call('/api/admin/upload/finalize', { method: 'POST', body: { id: intent.id } });
    const retry = await call('/api/admin/upload/finalize', { method: 'POST', body: { id: intent.id } });
    assert.equal(done.url, retry.url); assert.equal(done.size, bytes.length);
    owned.uploads.push({ kind: 'video-direct', url: done.url, size: done.size, intentId: intent.id, retained: true }); await persist();
    await readMedia(done.url, { range: true, label: `direct ${mib} MiB Range` });
    note('direct upload finalized idempotently', { mib, uploadHosts: [...hosts], applicationReceivesMetadataOnly: true });
  }
  note('effective Storage file limit/early rejection', { maximumBytes: maximum });
}
async function deleteOwned(collection, id, route, verifyRecord) {
  assert.ok(owned[collection].some(record => record.id === id), 'Delete requires this run manifest ownership.');
  assert.ok(verifyRecord.title?.startsWith(prefix) || verifyRecord.name === prefix, 'Delete requires freshly verified QA ownership.');
  if (!allowDelete) { skip(`${collection} delete`, 'TEST_DELETE_OWN_QA not true; fixture retained.'); return; }
  await persist();
  await call(route, { method: 'DELETE' });
  owned[collection].find(record => record.id === id).deleted = true;
  await persist();
}
async function runFlows(media) {
  const paper = { title: `${prefix} paper`, author: 'Temporary production QA', type: 'sach-giay', category: 'QA', class_level: 'Khác', format: 'Sách giấy', status: 'published', stock: 2, description: 'Temporary QA; archive after borrow verification.', gallery_urls: [], cover_url: media.cover || null };
  const record = await call('/api/admin/documents', { method: 'POST', body: paper, expected: 201 });
  owned.documents.push({ id: record.id, title: record.title, hasBorrowHistory: true, retained: true }); await persist();
  const edited = { ...paper, title: `${prefix} paper edited`, description: 'QA edited', expected_stock: 2 };
  assert.equal((await call(`/api/admin/documents/${record.id}`, { method: 'PUT', body: edited })).description, 'QA edited');
  assert.ok((await call(`/api/library?q=${encodeURIComponent(prefix)}`)).items.some(item => item.id === record.id));
  await call(`/tai-lieu/sach-giay/qa-${record.id}`);
  await call('/api/admin/documents', { method: 'POST', body: { ...paper, title: '' }, expected: 400 });
  await call(`/api/admin/documents/${record.id}`, { method: 'PUT', body: { ...edited, stock: -1 }, expected: 400 });
  await call(`/api/admin/documents/${record.id}`, { method: 'PUT', body: edited, headers: { origin: 'https://attacker.invalid' }, expected: 403 });
  assert.equal((await call(`/api/library/${record.id}/like`)).liked, false);
  assert.equal((await call(`/api/library/${record.id}/like`, { method: 'POST', body: {} })).liked, true);
  assert.equal((await call(`/api/library/${record.id}/like`, { method: 'POST', body: {} })).liked, false);
  assert.equal((await call(`/api/library/${record.id}`)).likes, 0);
  assert.equal((await call(`/api/library/${record.id}/view`, { method: 'POST', body: {} })).counted, true);
  assert.equal((await call(`/api/library/${record.id}/view`, { method: 'POST', body: {} })).counted, false);
  assert.equal((await call(`/api/library/${record.id}`)).views, 1);
  const comment = await call(`/api/library/${record.id}/comments`, { method: 'POST', body: { name: prefix, content: 'Temporary QA comment' }, expected: 201 });
  owned.comments.push({ id: comment.id, itemId: record.id }); await persist();
  await call(`/api/admin/comments/${comment.id}`, { method: 'PATCH', body: { status: 'approved' } });
  assert.ok((await call(`/api/library/${record.id}/comments`)).some(item => item.id === comment.id));
  await call(`/api/admin/comments/${comment.id}`, { method: 'PATCH', body: { status: 'hidden' } });
  assert.ok(!(await call(`/api/library/${record.id}/comments`)).some(item => item.id === comment.id));
  await call(`/api/library/${record.id}/comments`, { method: 'POST', body: { name: '', content: '' }, expected: 400 });
  const borrowBody = { borrower_name: prefix, class_name: 'QA', email: 'qa@example.invalid', note: 'Temporary QA stock verification' };
  const borrow = await call(`/api/library/${record.id}/borrow`, { method: 'POST', body: borrowBody, expected: 201 });
  owned.borrows.push({ id: borrow.id, itemId: record.id, retained: true }); await persist();
  await call(`/api/library/${record.id}/borrow`, { method: 'POST', body: borrowBody, expected: 409 });
  await call(`/api/admin/borrows/${borrow.id}`, { method: 'PATCH', body: { status: 'approved' } });
  await call(`/api/admin/borrows/${borrow.id}`, { method: 'PATCH', body: { status: 'approved' } });
  assert.equal((await call(`/api/library/${record.id}`)).stock, 1);
  await call(`/api/admin/documents/${record.id}`, { method: 'PUT', body: { ...edited, stock: 4, expected_stock: 2 }, expected: 409 });
  await call(`/api/admin/borrows/${borrow.id}`, { method: 'PATCH', body: { status: 'returned' } });
  await call(`/api/admin/borrows/${borrow.id}`, { method: 'PATCH', body: { status: 'returned' } });
  assert.equal((await call(`/api/library/${record.id}`)).stock, 2);
  await call(`/api/admin/borrows/${borrow.id}`, { method: 'PATCH', body: { status: 'approved' }, expected: 409 });
  await call(`/api/admin/documents/${record.id}`, { method: 'DELETE', expected: 409 });
  await call(`/api/admin/documents/${record.id}`, { method: 'PUT', body: { ...edited, status: 'archived', expected_stock: 2 } });
  await call(`/api/library/${record.id}`, { expected: 404 });
  const adminComments = await call('/api/admin/comments?limit=300');
  const ownedComment = adminComments.find(row => row.id === comment.id); assert.ok(ownedComment);
  await deleteOwned('comments', comment.id, `/api/admin/comments/${comment.id}`, ownedComment);
  note('likes/views/comments/borrow-return/stock correctness/idempotency');
  for (const [type, urls] of [['sach-giay', {}], ['sach-dien-tu', { file_url: media.pdf }], ['sach-noi', { file_url: media.audio }], ['video', { file_url: media.video }], ['album', { gallery_urls: media.gallery }], ['tai-lieu-khac', { file_url: media.pdf }]]) {
    const body = { ...paper, title: `${prefix} ${type} disposable`, type, ...urls, status: 'draft', stock: type === 'sach-giay' ? 2 : null };
    const created = await call('/api/admin/documents', { method: 'POST', body, expected: 201 });
    owned.documents.push({ id: created.id, title: created.title }); await persist();
    const changed = await call(`/api/admin/documents/${created.id}`, { method: 'PUT', body: { ...body, description: 'Updated draft QA', expected_stock: created.stock } });
    assert.equal(changed.description, 'Updated draft QA');
    if (type === 'album') { assert.equal(changed.cover_url, null); if (media.gallery) assert.deepEqual(changed.gallery_urls, media.gallery); }
    const verified = await call(`/api/admin/documents/${created.id}`);
    await deleteOwned('documents', created.id, `/api/admin/documents/${created.id}`, verified);
    if (allowDelete) await call(`/api/admin/documents/${created.id}`, { expected: 404 });
  }
  const newsBody = { title: `${prefix} news`, content: 'Temporary production QA news', excerpt: 'Temporary QA', status: 'published', cover_url: media.news || null };
  const news = await call('/api/admin/news', { method: 'POST', body: newsBody, expected: 201 });
  owned.news.push({ id: news.id, title: news.title, slug: news.slug }); await persist();
  await call(`/api/news/${news.slug}`); await call(`/tin-tuc/${news.slug}`);
  await call(`/api/admin/news/${news.id}`, { method: 'PUT', body: { ...newsBody, slug: news.slug, excerpt: 'Updated QA', status: 'archived' } });
  await call(`/api/news/${news.slug}`, { expected: 404 });
  const verifiedNews = (await call('/api/admin/news')).find(row => row.id === news.id); assert.ok(verifiedNews);
  await deleteOwned('news', news.id, `/api/admin/news/${news.id}`, verifiedNews);
  const bannerBody = { title: `${prefix} wall`, image_url: media.banner || '/logo-thd.png', is_active: true, sort_order: 9999 };
  const banner = await call('/api/admin/banners', { method: 'POST', body: bannerBody, expected: 201 });
  owned.banners.push({ id: banner.id, title: banner.title }); await persist();
  assert.ok((await call('/api/banners')).some(row => row.id === banner.id));
  await call(`/api/admin/banners/${banner.id}`, { method: 'PUT', body: { ...bannerBody, is_active: false } });
  assert.ok(!(await call('/api/banners')).some(row => row.id === banner.id));
  const verifiedBanner = (await call('/api/admin/banners')).find(row => row.id === banner.id); assert.ok(verifiedBanner);
  await deleteOwned('banners', banner.id, `/api/admin/banners/${banner.id}`, verifiedBanner);
  await call('/api/admin/banners', { method: 'POST', body: { title: 'QA', image_url: 'javascript:alert(1)' }, expected: 400 });
  const logs = await call('/api/admin/audit?limit=300');
  assert.ok(logs.some(row => row.entity_id === String(record.id) && row.action === 'update'));
  assert.ok(logs.some(row => row.entity_id === String(borrow.id) && row.action === 'borrow_status'));
  note('document/news/wall CRUD and audit logs; historic files retained');
  for (const item of owned.uploads.filter(row => row.kind !== 'video-direct')) await readMedia(item.url, { label: 'Storage file retained after record replacement/deletion' });
}
async function expireOwnSession() {
  if (!pool) return;
  const cookie = decodeURIComponent(cookieJar.get('thd_admin_session') || '');
  const rawToken = cookie.startsWith('v1.') ? cookie.split('.')[1] : cookie;
  assert.match(rawToken, /^[a-f0-9]{64}$/, 'Own session token format invalid; token suppressed.');
  const expired = await pool.query(`UPDATE admin_sessions SET expires_at=NOW()-INTERVAL '1 second'
    WHERE token_hash=$1 AND user_agent=$2 AND username=$3 RETURNING token_hash`, [hash(rawToken), ua, env.ADMIN_USERNAME]);
  assert.equal(expired.rowCount, 1, 'Expire only this run own session.');
  assert.equal((await call('/api/admin/session')).authenticated, false);
  await call('/api/admin/dashboard', { expected: 401 });
  await call('/api/admin/upload/sign', { method: 'POST', body: {}, expected: 401 });
  note('own expired-session persistence rejected');
  await login(true);
  if (env.ADMIN_SESSION_NOT_BEFORE) {
    const freshCookie = decodeURIComponent(cookieJar.get('thd_admin_session') || '');
    const freshToken = freshCookie.startsWith('v1.') ? freshCookie.split('.')[1] : freshCookie;
    const old = await pool.query(`UPDATE admin_sessions SET created_at=$4::timestamptz-INTERVAL '1 second'
      WHERE token_hash=$1 AND user_agent=$2 AND username=$3 RETURNING token_hash`, [hash(freshToken), ua, env.ADMIN_USERNAME, env.ADMIN_SESSION_NOT_BEFORE]);
    assert.equal(old.rowCount, 1, 'Cutoff fixture modifies only newly-issued own QA session.');
    assert.equal((await call('/api/admin/session')).authenticated, false);
    await call('/api/admin/dashboard', { expected: 401 });
    note('development session cutoff rejects newly-created own QA simulation');
    await login();
  }
}
async function verifyLoginThrottle() {
  if (env.TEST_LOGIN_THROTTLE !== 'true') { skip('real login threshold', 'Opt-in TEST_LOGIN_THROTTLE=true is allowed only with a disposable QA admin username; unit regressions cover limiter.'); return; }
  assert.match(env.ADMIN_USERNAME || '', /^QA[- ]/, 'Login lockout testing requires a disposable QA admin username.');
  let limited = false;
  for (let attempt = 0; attempt < 11; attempt++) {
    const response = await call('/api/admin/login', { method: 'POST', body: { username: env.ADMIN_USERNAME, password: 'deliberately-invalid-qa-password' }, expected: [401, 429], raw: true });
    if (response.status === 429) { limited = true; break; }
  }
  assert.equal(limited, true, 'Repeated failed logins must reach shared database throttle.');
  await call('/api/admin/login', { method: 'POST', body: { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }, expected: 429 });
  note('database-backed brute-force lockout rejects correct credentials while limited');
}

try {
  await initDatabase();
  const health = await call('/api/health', { raw: true });
  assert.match(health.headers.get('cache-control') || '', /no-store/); assert.equal((await health.json()).ok, true);
  for (const route of ['/', '/tim-kiem?q=th%C6%B0', '/tai-lieu/thinh-hanh', '/tai-lieu/moi-nhat', '/tai-lieu/sach-giay', '/tai-lieu/sach-dien-tu', '/tai-lieu/sach-noi', '/tai-lieu/video', '/tai-lieu/album', '/tai-lieu/tai-lieu-khac', '/tin-tuc', '/gioi-thieu', '/admin/login']) {
    const html = await call(route, { admin: false }); assert.match(html, /<html/);
    assert.ok(!html.includes('Internal Server Error'), `Page ${route}`);
    assert.ok(!/src="\/_next\/image[^" ]*url=%2Fuploads/i.test(html), 'Legacy Storage images must bypass Next optimizer.');
    assert.match(html, /name="viewport"/, 'Responsive viewport metadata exists.');
  }
  const robots = await call('/robots.txt', { admin: false });
  assert.match(robots, /Disallow: \/admin/i); assert.match(robots, /Disallow: \/api/i);
  const sitemap = await call('/sitemap.xml', { admin: false });
  const canonical = env.APP_ORIGIN || 'https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn';
  assert.ok(sitemap.includes(`${canonical}/`), 'Sitemap uses production canonical origin.');
  assert.ok(!/<loc>[^<]*(?:localhost|127\.0\.0\.1|trycloudflare\.com|\/admin)/i.test(sitemap), 'Sitemap excludes internal/admin/tunnel URLs.');
  await call('/icon.png', { admin: false, raw: true });
  const optimized = await call('/_next/image?url=%2Flogo-thd.png&w=128&q=75', { admin: false, raw: true });
  assert.match(optimized.headers.get('content-type') || '', /^image\//, 'Static logo Next optimizer works.');
  await optimized.body?.cancel();
  note('robots/sitemap/icon/static image optimizer/legacy image markup');
  skip('desktop/mobile browser rendering and clicks', 'HTTP harness does not replace browser visual/interaction checks.');
  const list = await call('/api/library?limit=100'); assert.ok(Array.isArray(list.items));
  for (const query of ['type=thinh-hanh', 'type=moi-nhat', 'sort=popular']) {
    assert.ok((await call(`/api/library?${query}`)).items.every(item => !['video', 'album', 'ky-nang-song', 'bai-giang-dien-tu'].includes(item.type)));
  }
  for (const type of ['sach-giay', 'sach-dien-tu', 'sach-noi', 'video', 'album', 'tai-lieu-khac']) {
    const category = await call(`/api/library?type=${type}&limit=100`); assert.ok(category.items.every(item => item.type === type));
    const item = category.items[0];
    if (!item) { skip(`${type} existing detail`, 'No published record in category.'); continue; }
    const html = await call(`/tai-lieu/${type}/qa-${item.id}`); assert.ok(html.includes(String(item.id)));
    if (item.file_url) await readMedia(item.file_url, { range: true, label: `${type} existing media Range` });
    if (type === 'album') { assert.equal(item.cover_url, null); for (const url of item.gallery_urls.slice(0, 2)) await readMedia(url, { label: 'existing album image' }); }
    if (item.cover_url) await readMedia(item.cover_url, { label: item.cover_url.startsWith('/uploads/') ? 'legacy image HTTP' : 'Storage cover image HTTP' });
  }
  await call('/api/news'); await call('/api/banners');
  for (const route of ['/api/admin/dashboard', '/api/admin/documents', '/api/admin/news', '/api/admin/banners', '/api/admin/comments', '/api/admin/borrows', '/api/admin/settings', '/api/admin/audit', '/api/admin/upload/limits']) await call(route, { admin: false, expected: 401 });
  for (const route of ['/api/admin/documents', '/api/admin/news', '/api/admin/banners', '/api/admin/upload', '/api/admin/upload/sign', '/api/admin/upload/finalize']) await call(route, { method: 'POST', body: {}, admin: false, expected: 401 });
  for (const [route, methods] of [['documents', ['PUT', 'DELETE']], ['news', ['PUT', 'DELETE']], ['banners', ['PUT', 'DELETE']], ['comments', ['PATCH', 'DELETE']], ['borrows', ['PATCH']]]) {
    // ID zero can never identify a record even if an authorization regression occurs.
    for (const method of methods) await call(`/api/admin/${route}/0`, { method, body: {}, admin: false, expected: 401 });
  }
  await call('/api/admin/settings', { method: 'PUT', body: {}, admin: false, expected: 401 });
  await call('/api/admin/login', { method: 'POST', body: { username: env.ADMIN_USERNAME, password: 'deliberately-invalid-qa-password' }, expected: 401 });
  await login(true); const firstToken = cookieJar.get('thd_admin_session'); await login(); assert.notEqual(cookieJar.get('thd_admin_session'), firstToken, 'Every successful login must issue a fresh session.'); note('fresh session token per login');
  for (const route of ['/admin', '/admin/news', '/admin/operations', '/api/admin/dashboard', '/api/admin/settings']) await call(route);
  const media = await runSmallUploads();
  await runDirectUploads();
  await runFlows(media);
  await expireOwnSession();
  await call('/api/admin/logout', { method: 'POST', body: {}, expected: 303 });
  assert.equal((await call('/api/admin/session')).authenticated, false);
  await call('/api/admin/documents', { expected: 401 });
  note('logout clears and invalidates own session');
  await verifyLoginThrottle();
  await verifyPreservation();
  result = 'PASS'; await persist();
  console.log(`PASS production HTTP/API regression (${evidence.filter(row => row.result === 'PASS').length} checks). Report: ${reportPath}`);
} catch (error) {
  // Do not emit error stacks/SDK responses/connection strings/cookies/capabilities.
  safeFailure = error instanceof assert.AssertionError ? error.message : 'Regression request/database/storage failure; credential details suppressed.';
  if (preservation) preservation = preservation.map(table => { const safe = { ...table }; delete safe.records; return safe; });
  await persist();
  console.error(`FAIL production regression: ${safeFailure}. Report: ${reportPath}`);
  process.exitCode = 1;
} finally { await pool?.end(); }
