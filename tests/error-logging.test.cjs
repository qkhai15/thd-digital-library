const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const loader = require('./load-project.cjs');

test('backend logs only validated error codes, never exception messages/details/stacks', () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => { logged.push(args); };
  try {
    const { logBackendError } = loader()('src/lib/backend-utils.ts');
    for (const code of ['23503', 'ECONNRESET', 'bad\nprivate', { toString: () => 'PRIVATE' }, 'x'.repeat(100), undefined]) {
      logBackendError('PUBLIC_MUTATION_FAILED', { code, message: 'private-customer-secret', detail: 'private-SQL-details', stack: 'private-stack' });
    }
    assert.deepEqual(logged.map(args => args[1].code), ['23503', 'ECONNRESET', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
    assert.ok(logged.every(args => args.length === 2));
    assert.ok(!JSON.stringify(logged).includes('private'));
  } finally { console.error = original; }
});

test('reader and Admin write failures keep API errors and release clients without logging private DB data', async () => {
  const keys = ['APP_ORIGIN', 'PUBLIC_ORIGINS', 'PRODUCTION_REMOTE_ONLY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  const logged = [];
  const original = console.error;
  console.error = (...args) => { logged.push(args); };
  const privateError = Object.assign(new Error('private-customer-name-password'), { code: '23503', detail: 'private-contact-and-SQL', stack: 'private-stack' });
  const fixtures = [
    { file: 'src/app/api/library/[id]/like/route.ts', method: 'POST', body: {}, context: 'LIKE ERROR', transaction: true },
    { file: 'src/app/api/library/[id]/comments/route.ts', method: 'POST', body: { name: 'private-reader', content: 'private-content' }, context: 'POST COMMENT', transaction: true },
    { file: 'src/app/api/library/[id]/borrow/route.ts', method: 'POST', body: { borrower_name: 'private-reader', phone: 'private-contact' }, context: 'BORROW REQUEST', transaction: true },
    { file: 'src/app/api/admin/borrows/[id]/route.ts', method: 'PATCH', body: { status: 'approved' }, context: 'BORROW STATUS', transaction: true },
    { file: 'src/app/api/admin/documents/[id]/route.ts', method: 'DELETE', context: 'DELETE DOCUMENT', transaction: true },
    { file: 'src/app/api/admin/news/route.ts', method: 'POST', body: { title: 'private-title', content: 'private-content' }, context: 'SAVE NEWS' },
    { file: 'src/app/api/admin/news/[id]/route.ts', method: 'PUT', body: { title: 'private-title', content: 'private-content' }, context: 'SAVE NEWS' },
  ];
  try {
    for (const fixture of fixtures) {
      let released = false;
      const client = { query: async sql => { if (sql === 'BEGIN') throw privateError; return { rows: [], rowCount: 0 }; }, release: () => { released = true; } };
      const database = {
        ensureSchema: async () => {},
        db: {
          connect: async () => client,
          query: async sql => {
            if (sql.includes('SELECT * FROM news_posts')) return { rows: [{ id: 1, slug: 'existing-news' }], rowCount: 1 };
            if (sql.includes('SELECT 1')) return { rows: [], rowCount: 0 };
            throw privateError;
          },
        },
      };
      const route = loader({ '@/lib/db': database, '@/lib/admin-auth': { isAdmin: async () => true, getAdminSession: async () => ({ username: 'admin' }), auditLog: async () => {} }, '@/lib/site-settings': { commentsRequireApproval: async () => true } })(fixture.file);
      const request = new NextRequest('http://localhost:3000/api/test', { method: fixture.method, headers: { 'content-type': 'application/json' }, ...(fixture.body ? { body: JSON.stringify(fixture.body) } : {}) });
      const response = await route[fixture.method](request, { params: Promise.resolve({ id: '1' }) });
      assert.equal(response.status, 500, fixture.file);
      assert.ok(!(await response.text()).includes('private'), fixture.file);
      assert.deepEqual(logged.pop(), [fixture.context, { code: '23503' }], fixture.file);
      if (fixture.transaction) assert.equal(released, true, fixture.file);
    }
    assert.equal(logged.length, 0);
  } finally {
    console.error = original;
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});
