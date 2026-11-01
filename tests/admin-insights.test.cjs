const test = require('node:test');
const assert = require('node:assert/strict');
const loader = require('./load-project.cjs');

const baseStats = {
  items: { total: 6, published: 4 }, comments: { total: 2, pending: 1 },
  borrows: { total: 5, pending: 1 }, views: 40,
  news: { total: 2, published: 1 }, banners: { total: 1, active: 1 },
};

function insightsLoader(query, getDashboardStats = async () => baseStats) {
  return loader({
    'server-only': {},
    '@/lib/db': { ensureSchema: async () => {}, db: { query } },
    '@/lib/library-repository': { getDashboardStats },
  })('src/lib/admin-insights.ts');
}

test('admin read cache coalesces requests, expires and does not retain failures', async () => {
  const { createExpiringRead } = insightsLoader(async () => ({ rows: [] }));
  let now = 10, calls = 0, resolve;
  const read = createExpiringRead(() => { calls++; return new Promise(done => { resolve = done; }); }, 100, () => now);
  const a = read(), b = read();
  assert.equal(calls, 1);
  resolve({ count: 5 });
  assert.deepEqual(await a, { count: 5 });
  assert.deepEqual(await b, { count: 5 });
  now = 109;
  assert.deepEqual(await read(), { count: 5 });
  assert.equal(calls, 1);
  now = 110;
  const next = read();
  assert.equal(calls, 2);
  resolve({ count: 6 });
  assert.deepEqual(await next, { count: 6 });

  let failures = 0;
  const fails = createExpiringRead(async () => { if (++failures === 1) throw new Error('temporary'); return 'ok'; }, 100, () => now);
  await assert.rejects(fails(), /temporary/);
  assert.equal(await fails(), 'ok');
  assert.equal(failures, 2);
});

test('dashboard authorizes before reading counts; responses and failures cannot be shared or leak errors', async () => {
  let allowed = false, reads = 0, shouldFail = false;
  const route = loader({
    '@/lib/admin-auth': { isAdmin: async () => allowed },
    '@/lib/admin-insights': { getAdminDashboard: async days => {
      reads++;
      if (shouldFail) throw Object.assign(new Error('postgres://secret-password@private.example/db'), { code: 'CONNECTION_FAILED' });
      return { ...baseStats, insights: { days } };
    } },
    '@/lib/backend-utils': { logBackendError() {} },
  })('src/app/api/admin/dashboard/route.ts');
  const request = new Request('https://library.example/api/admin/dashboard?days=7');
  const anonymous = await route.GET(request);
  assert.equal(anonymous.status, 401);
  assert.equal(reads, 0);
  assert.equal(anonymous.headers.get('Cache-Control'), 'private, no-store');
  allowed = true;
  const authenticated = await route.GET(request);
  assert.equal(authenticated.status, 200);
  assert.equal((await authenticated.json()).insights.days, 7);
  assert.equal(authenticated.headers.get('Cache-Control'), 'private, no-store');
  shouldFail = true;
  const error = await route.GET(request);
  assert.equal(error.status, 503);
  assert.doesNotMatch(await error.text(), /password|postgres|private\.example/);
});

test('dashboard keeps the existing contract, aggregates bounded periods and caches Storage without listing objects', async () => {
  const queries = [];
  let baseReads = 0;
  const query = async (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('FROM storage.objects')) return { rows: [{ used_bytes: '900000000', object_count: '211', unknown: '0', secret: 'not-for-client' }] };
    if (sql.includes('GROUP BY type')) return { rows: [{ type: 'sach-giay', count: 3 }] };
    if (sql.includes('FROM library_views')) return { rows: [{ count: 8 }] };
    if (sql.includes('FROM borrow_requests')) return { rows: [{ pending: 1, approved: 1, ready_for_pickup: 1, borrowed: 2, overdue: 1, returned: 4 }] };
    if (sql.includes('FROM library_search_daily')) {
      if (sql.includes('GROUP BY search_day')) return { rows: [{ day: '2026-10-16', count: '9', zero_results: '2' }] };
      return { rows: [{ query: 'Ngữ văn', normalized_query: 'ngu van', count: '5', ip_address: 'private-fixture' }] };
    }
    return { rows: [{ id: 1, title: 'Ngữ văn', type: 'sach-dien-tu', status: 'published', views: 20,
      created_at: new Date('2026-10-01T00:00:00Z'), file_url: 'private-fixture', secret: 'not-for-client' }] };
  };
  const { getAdminDashboard } = insightsLoader(query, async () => { baseReads++; return baseStats; });
  const first = await getAdminDashboard(7);
  assert.equal(first.items.total, baseStats.items.total);
  assert.equal(first.views, baseStats.views);
  assert.deepEqual(first.insights.circulation, { pending: 1, approved: 1, ready_for_pickup: 1, borrowed: 2, overdue: 1, returned: 4 });
  assert.equal(first.insights.recent_views, 8);
  assert.equal(first.insights.storage.object_count, 211);
  assert.equal(first.insights.storage.status, 'warning');
  assert.equal(first.insights.searches.topQueries[0].count, 5);
  assert.equal(first.insights.searches.trend[0].zero_results, 2);
  assert.equal(first.insights.top_items[0].created_at, '2026-10-01T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(first), /private-fixture|not-for-client|ip_address|file_url/);
  await getAdminDashboard(7);
  assert.equal(baseReads, 1);
  const fallback = await getAdminDashboard(99999);
  assert.equal(fallback.insights.days, 30);
  await getAdminDashboard(30);
  assert.equal(baseReads, 2);
  assert.equal(queries.filter(q => q.sql.includes('FROM storage.objects')).length, 1);
  assert.ok(queries.every(q => q.sql.trim().startsWith('SELECT')));
  assert.ok(queries.filter(q => q.values).every(q => [7, 30].includes(q.values[0])));
  assert.match(queries.find(q => q.sql.includes('FROM borrow_requests')).sql, /status='borrowed' AND due_at < NOW\(\)/);
  assert.match(queries.find(q => q.sql.includes('HAVING')).sql, /HAVING SUM\(zero_result_count\)>0/);
  assert.ok(queries.filter(q => q.sql.includes('SELECT id,title')).every(q => /LIMIT 8/.test(q.sql)));
});

test('unknown or unavailable Storage measurement is never reported as zero usage', async () => {
  let calls = 0;
  const { getAdminDashboard } = insightsLoader(async sql => {
    if (sql.includes('FROM storage.objects')) { calls++; throw new Error('missing test Storage schema'); }
    return { rows: [] };
  });
  const result = await getAdminDashboard();
  assert.equal(result.insights.storage.status, 'unavailable');
  assert.equal(result.insights.storage.used_bytes, null);
  assert.equal(result.insights.storage.limit_bytes, null);
  await getAdminDashboard(90);
  assert.equal(calls, 1);
});
