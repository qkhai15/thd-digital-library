const test = require('node:test');
const assert = require('node:assert/strict');
const loader = require('./load-project.cjs');

const request = (method, body, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/admin/documents/7', {
  method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const context = { params: Promise.resolve({ id: '7' }) };
function item(overrides = {}) {
  return { id: 7, title: 'Tài liệu hiện có', type: 'sach-dien-tu', class_level: '12', status: 'draft',
    author: 'Tác giả', category: 'Ôn thi', format: 'PDF', cover_url: '/uploads/existing-cover.jpg', file_url: '/uploads/existing.pdf',
    gallery_urls: [], description: 'Mô tả hiện có', stock: null, is_featured: false, published_at: null,
    publisher: 'NXB Giáo dục', publication_year: 2025, isbn: 'ID-2025', language: 'Tiếng Việt', page_count: 120,
    subject_id: 3, topics: ['Ôn thi'], tags: ['Ngữ văn'], source: 'Nguồn hiện có', rights: 'Quyền hiện có',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...overrides };
}
function harness(initial = item(), options = {}) {
  let current = initial;
  const queries = [], audits = [];
  let authorized = options.authorized ?? true;
  let conflict = false;
  const database = { ensureSchema: async () => { queries.push({ sql: 'ensureSchema' }); }, db: { query: async (sql, values) => {
    queries.push({ sql, values });
    if (sql.startsWith('UPDATE library_items')) {
      if (conflict) return { rows: [] };
      current = { ...current, title: values[0], status: values[12],
        publisher: values[15], publication_year: values[16], isbn: values[17], language: values[18],
        page_count: values[19], subject_id: values[20], topics: values[21], tags: values[22], source: values[23], rights: values[24],
        published_at: values[12] === 'published' ? current.published_at || '2026-10-17T00:00:00Z' : current.published_at };
      return { rows: [current] };
    }
    if (sql.includes("status='published'") && current.status !== 'published') return { rows: [] };
    return { rows: [current] };
  } } };
  const load = loader({ '@/lib/db': database, '@/lib/admin-auth': {
    isAdmin: async () => authorized, auditLog: async (...event) => audits.push(event),
  } });
  return { admin: load('src/app/api/admin/documents/[id]/route.ts'), public: load('src/app/api/library/[id]/route.ts'),
    create: load('src/app/api/admin/documents/route.ts'), queries, audits,
    current: () => current, setAuthorized: value => { authorized = value; }, setConflict: value => { conflict = value; } };
}

test('publishing policy validates four states without introducing a second-admin requirement or coercing null/arrays', () => {
  const policy = loader()('src/lib/publication-policy.ts');
  assert.equal(policy.publicationStatus(undefined), 'published'); // older create clients
  assert.equal(policy.publicationTransition('draft', 'review').action, 'submit_review');
  assert.equal(policy.publicationTransition('review', 'published').action, 'publish');
  assert.equal(policy.publicationTransition('published', 'archived').action, 'archive');
  assert.equal(policy.publicationTransition('archived', 'published').action, 'republish');
  assert.equal(policy.publicationTransition('published', 'published').changed, false);
  for (const value of [null, ['published'], {}, 'PUBLISHED', 'deleted', '']) assert.throws(() => policy.publicationStatus(value));
  assert.throws(() => policy.publicationTransition('unknown', 'published'));
});

test('publication changes preserve existing metadata, audit workflow and hide every non-published state publicly', async () => {
  const app = harness();
  for (const [status, action] of [['review', 'submit_review'], ['published', 'publish'], ['archived', 'archive'], ['published', 'republish'], ['draft', 'save_draft']]) {
    const previous = app.current().status;
    const response = await app.admin.PUT(request('PUT', { status }), context);
    assert.equal(response.status, 200);
    const row = await response.json();
    assert.equal(row.publisher, 'NXB Giáo dục');
    assert.deepEqual(row.tags, ['Ngữ văn']);
    assert.equal(row.subject_id, 3);
    const details = app.audits.at(-1)[3];
    assert.equal(details.fromStatus, previous);
    assert.equal(details.status, status);
    assert.equal(details.publicationAction, action);
    assert.equal((await app.public.GET(new Request('http://localhost:3000/api/library/7'), context)).status,
      status === 'published' ? 200 : 404);
  }
  assert.equal(app.current().published_at, '2026-10-17T00:00:00Z');
  const update = app.queries.find(entry => entry.sql.startsWith('UPDATE library_items'));
  assert.match(update.sql, /status IS NOT DISTINCT FROM \$26::varchar/);
  assert.match(update.sql, /COALESCE\(published_at,NOW\(\)\)/);
});

test('older edit clients preserve metadata while explicit empty nullable fields clear it', async () => {
  const app = harness(item({ status: 'review' }));
  let response = await app.admin.PUT(request('PUT', { title: 'Đổi tiêu đề' }), context);
  assert.equal(response.status, 200);
  let row = await response.json();
  assert.equal(row.status, 'review');
  assert.equal(row.publisher, 'NXB Giáo dục');
  assert.equal(row.publication_year, 2025);
  assert.equal(row.rights, 'Quyền hiện có');
  response = await app.admin.PUT(request('PUT', { publisher: null, publication_year: '', subject_id: null, topics: [], tags: [] }), context);
  assert.equal(response.status, 200);
  row = await response.json();
  assert.equal(row.publisher, null);
  assert.equal(row.publication_year, null);
  assert.equal(row.subject_id, null);
  assert.deepEqual(row.tags, []);
  assert.deepEqual(row.topics, []);
});

test('publish requires real content and a concurrent publication change cannot be silently overwritten', async () => {
  const missing = harness(item({ file_url: null }));
  const response = await missing.admin.PUT(request('PUT', { status: 'published' }), context);
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /file nội dung/);
  assert.ok(!missing.queries.some(entry => entry.sql.startsWith('UPDATE')));
  assert.equal(missing.audits.length, 0);

  const raced = harness(); raced.setConflict(true);
  assert.equal((await raced.admin.PUT(request('PUT', { status: 'published' }), context)).status, 409);
  assert.equal(raced.audits.length, 0);
  const update = raced.queries.find(entry => entry.sql.startsWith('UPDATE'));
  assert.equal(update.values[25], 'draft');
});

test('document create/update/delete and publication require authentication and origin before database work', async () => {
  const app = harness(item(), { authorized: false });
  assert.equal((await app.admin.PUT(request('PUT', { status: 'published' }), context)).status, 401);
  assert.equal((await app.admin.DELETE(request('DELETE', {}), context)).status, 401);
  assert.equal((await app.create.POST(request('POST', { title: 'New' }))).status, 401);
  assert.equal(app.queries.length, 0);
  app.setAuthorized(true);
  assert.equal((await app.admin.PUT(request('PUT', { status: 'published' }, 'https://untrusted.invalid'), context)).status, 403);
  assert.equal((await app.create.POST(request('POST', { title: 'New' }, 'https://untrusted.invalid'))).status, 403);
  assert.equal(app.queries.length, 0);
});

test('public collection list/detail and related queries exclude draft/review/archived members and self', async () => {
  const queries = [];
  const catalog = loader({ '@/lib/db': { ensureSchema: async () => {}, db: { query: async (sql, values) => {
    queries.push({ sql, values });
    return { rows: sql.startsWith('SELECT * FROM library_collections') ? [{ id: 2, title: 'Ôn thi', status: 'published', created_at: '2026-10-01', updated_at: '2026-10-01' }] : [] };
  } } } })('src/lib/catalog.ts');
  await catalog.getCollections();
  await catalog.getCollection('on-thi');
  await catalog.getRelatedItems(7, 100);
  assert.match(queries[0].sql, /i\.status='published'/);
  assert.match(queries[0].sql, /c\.status='published'/);
  assert.equal(queries[0].values[1], false);
  assert.match(queries[1].sql, /status='published'/);
  assert.match(queries[2].sql, /i\.status='published'/);
  assert.match(queries[3].sql, /i\.id<>\$1 AND i\.status='published'/);
  assert.equal(queries[3].values[2], 6);
});
