const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { NextRequest } = require('next/server');
const loader = require('./load-project.cjs');

function savedEnvironment(names) {
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  return () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  };
}

test('exact public proxy origins work while spoofed or unconfigured hosts are rejected', () => {
  const restore = savedEnvironment(['APP_ORIGIN', 'PUBLIC_ORIGINS', 'PRODUCTION_REMOTE_ONLY']);
  Object.assign(process.env, { APP_ORIGIN: 'https://library.example', PUBLIC_ORIGINS: 'https://temporary.example,https://railway.example', PRODUCTION_REMOTE_ONLY: 'true' });
  try {
    const utils = loader()('src/lib/backend-utils.ts');
    const request = (origin, extra = {}) => new Request('http://app:3000/api/admin/documents', { method: 'POST', headers: { host: 'app:3000', origin, ...extra } });
    for (const origin of ['https://library.example', 'https://temporary.example', 'https://railway.example']) {
      const proxied = request(origin, { 'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': 'https' });
      assert.equal(utils.requestOrigin(proxied), origin);
      assert.equal(utils.sameOriginAllowed(proxied), true);
      assert.equal(utils.sameOriginAllowed(request(origin, { host: new URL(origin).host })), true);
    }
    assert.equal(utils.sameOriginAllowed(request('https://evil.example', { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' })), false);
    assert.equal(utils.sameOriginAllowed(request('https://temporary.example', { 'x-forwarded-host': 'temporary.example', 'x-forwarded-proto': 'http' })), false);
    assert.equal(utils.sameOriginAllowed(request('https://evil.example', { 'x-forwarded-host': 'library.example', 'x-forwarded-proto': 'https' })), false);
    assert.equal(utils.sameOriginAllowed(new Request('http://app:3000/api/admin/login', { method: 'POST' })), false);
    assert.equal(utils.sameOriginAllowed(request('https://library.example', { host: 'library.example@evil.example' })), false);
    // Local/LAN support remains available when using the local dev server.
    delete process.env.PRODUCTION_REMOTE_ONLY;
    assert.equal(utils.sameOriginAllowed(request('http://192.168.0.106:3000', { host: '192.168.0.106:3000' })), true);
    assert.equal(utils.sameOriginAllowed(request('http://localhost:3000', { host: 'localhost:3000' })), true);
    process.env.PUBLIC_ORIGINS = 'https://*.example';
    assert.equal(utils.sameOriginAllowed(request('https://library.example', { host: 'library.example' })), false);
  } finally { restore(); }
});

test('admin cookie signatures reject tampering, secret rotation and unsigned migrated cookies before DB access', async () => {
  const restore = savedEnvironment(['SESSION_SECRET', 'NODE_ENV']);
  Object.assign(process.env, { SESSION_SECRET: 'a'.repeat(64), NODE_ENV: 'production' });
  let cookie;
  let queries = 0;
  const auth = loader({ 'next/headers': { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined }) }, '@/lib/db': { ensureSchema: async () => {}, db: { query: async () => { queries++; return { rows: [] }; } } } })('src/lib/admin-auth.ts');
  try {
    const raw = '1'.repeat(64);
    cookie = auth.encodeAdminSessionToken(raw);
    assert.match(cookie, /^v1\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(auth.decodeAdminSessionToken(cookie), raw);
    const original = cookie;
    for (const invalid of [raw, cookie.replace(raw, '2'.repeat(64)), cookie.slice(0, -2) + 'zz', 'v1.bad.bad', 'x'.repeat(5000)]) {
      cookie = invalid;
      assert.equal(await auth.getAdminSession(), null);
      await auth.deleteAdminSessionToken(cookie);
    }
    assert.equal(queries, 0);
    process.env.SESSION_SECRET = 'b'.repeat(64);
    assert.equal(auth.decodeAdminSessionToken(original), null);
    delete process.env.SESSION_SECRET;
    assert.throws(() => auth.decodeAdminSessionToken(raw), /SESSION_SECRET/);
    process.env.NODE_ENV = 'development';
    assert.equal(auth.decodeAdminSessionToken(raw), raw);
  } finally { restore(); }
});

test('each login creates a fresh signed session; lookup and logout hash only the opaque token', async () => {
  const restore = savedEnvironment(['SESSION_SECRET', 'NODE_ENV', 'ADMIN_SESSION_NOT_BEFORE']);
  Object.assign(process.env, { SESSION_SECRET: 'c'.repeat(64), NODE_ENV: 'production', ADMIN_SESSION_NOT_BEFORE: '2026-10-14T00:00:00Z' });
  const calls = [];
  let cookie;
  const auth = loader({ 'next/headers': { cookies: async () => ({ get: () => ({ value: cookie }) }) }, '@/lib/db': { ensureSchema: async () => {}, db: { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } } } })('src/lib/admin-auth.ts');
  try {
    cookie = await auth.createAdminSession({ username: 'admin' });
    const second = await auth.createAdminSession({ username: 'admin' });
    assert.notEqual(second, cookie);
    const expectedHash = createHash('sha256').update(cookie.split('.')[1]).digest('hex');
    assert.equal(calls[0].values[0], expectedHash);
    assert.equal(calls[0].values[4], '8');
    assert.equal(await auth.getAdminSession(), null); // DB controls expiry/revocation.
    const lookup = calls[2];
    assert.match(lookup.sql, /expires_at > NOW\(\)/);
    assert.match(lookup.sql, /created_at >= \$2/);
    assert.deepEqual(lookup.values, [expectedHash, process.env.ADMIN_SESSION_NOT_BEFORE]);
    await auth.deleteAdminSessionToken(cookie);
    assert.deepEqual(calls[3].values, [expectedHash]);
    assert.match(calls[3].sql, /DELETE FROM admin_sessions WHERE token_hash=\$1/);
  } finally { restore(); }
});

test('login rejects malformed and oversized bodies, enforces account/IP throttle and hides DB errors', async () => {
  const restore = savedEnvironment(['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'APP_ORIGIN', 'PUBLIC_ORIGINS', 'PRODUCTION_REMOTE_ONLY']);
  Object.assign(process.env, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'a-secure-test-password', APP_ORIGIN: 'https://library.example' });
  delete process.env.PUBLIC_ORIGINS;
  delete process.env.PRODUCTION_REMOTE_ONLY;
  let failures = 0, unavailable = false, lookup, sessions = 0;
  const database = { ensureSchema: async () => { if (unavailable) throw new Error('private-password-should-never-appear'); }, db: { connect: async () => ({ query: async (sql, values) => { if (sql.includes('COUNT')) lookup = { sql, values }; return { rows: [{ count: failures }] }; }, release: () => {} }) } };
  const auth = { createAdminSession: async () => { sessions++; return 'token'; }, setAdminCookie: () => {} };
  const { POST } = loader({ '@/lib/db': database, '@/lib/admin-auth': auth })('src/app/api/admin/login/route.ts');
  const request = (body, extra = {}) => new NextRequest('http://localhost:3000/api/admin/login', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    assert.equal((await POST(request('{bad'))).status, 400);
    assert.equal((await POST(request({ username: 'admin', password: 123 }))).status, 400);
    assert.equal((await POST(request('x'.repeat(17 * 1024)))).status, 413);
    assert.equal((await POST(request({ username: 'admin', password: 'bad' }))).status, 401);
    failures = 10;
    const limited = await POST(request({ username: 'admin', password: process.env.ADMIN_PASSWORD }, { 'x-forwarded-for': 'different-fake-ip' }));
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '900');
    assert.match(lookup.sql, /ip_address=\$1 OR username=\$2/);
    assert.equal(lookup.values[1], process.env.ADMIN_USERNAME);
    assert.equal(sessions, 0);
    unavailable = true;
    const error = await POST(request({ username: 'admin', password: process.env.ADMIN_PASSWORD }));
    assert.equal(error.status, 503);
    assert.equal(error.headers.get('cache-control'), 'no-store');
    assert.ok(!(await error.text()).includes('private-password'));
  } finally { restore(); }
});

test('concurrent failed logins cannot overshoot the shared ten-attempt allowance', async () => {
  const restore = savedEnvironment(['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'APP_ORIGIN', 'PUBLIC_ORIGINS', 'PRODUCTION_REMOTE_ONLY']);
  Object.assign(process.env, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'concurrent-login-test-password', APP_ORIGIN: 'https://library.example' });
  delete process.env.PUBLIC_ORIGINS;
  delete process.env.PRODUCTION_REMOTE_ONLY;
  let failureCount = 0, held = false, releasedClients = 0;
  const waiting = [];
  const acquire = () => new Promise(resolve => {
    if (!held) { held = true; resolve(); } else waiting.push(resolve);
  });
  const unlock = () => {
    const next = waiting.shift();
    if (next) next(); else held = false;
  };
  const database = {
    ensureSchema: async () => {},
    db: { connect: async () => {
      let locked = false;
      return {
        query: async (sql, values) => {
          if (sql.includes('pg_advisory_xact_lock')) { await acquire(); locked = true; }
          if (sql.includes('COUNT')) { assert.equal(locked, true); return { rows: [{ count: failureCount }] }; }
          if (sql.includes('INSERT')) { assert.equal(locked, true); assert.equal(values[2], false); failureCount++; }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') { assert.equal(locked, true); locked = false; unlock(); }
          return { rows: [] };
        },
        release: () => { assert.equal(locked, false); releasedClients++; },
      };
    } },
  };
  try {
    const { POST } = loader({ '@/lib/db': database, '@/lib/admin-auth': { createAdminSession: async () => { throw new Error('must not create a session'); } } })('src/app/api/admin/login/route.ts');
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => POST(new NextRequest('http://localhost:3000/api/admin/login', {
      method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-forwarded-for': `fake-ip-${index}` },
      body: JSON.stringify({ username: 'admin', password: 'incorrect' }),
    }))));
    assert.equal(results.filter(response => response.status === 401).length, 10);
    assert.equal(results.filter(response => response.status === 429).length, 10);
    assert.equal(failureCount, 10);
    assert.equal(releasedClients, 20);
  } finally { restore(); }
});

test('audit logging failure preserves completed mutations without printing private DB errors', async () => {
  const logged = [];
  const originalError = console.error;
  console.error = (...values) => { logged.push(values); };
  const auth = loader({
    'next/headers': { cookies: async () => ({ get: () => undefined }) },
    '@/lib/db': {
      ensureSchema: async () => {},
      db: { query: async () => { throw Object.assign(new Error('private-password-and-connection-string'), { code: '23502', detail: 'private SQL values', stack: 'private stack' }); } },
    },
  })('src/lib/admin-auth.ts');
  try {
    await auth.auditLog('document.create', 'document', '12', { private: 'private-payload' });
    assert.equal(logged.length, 1);
    assert.equal(logged[0].length, 2);
    assert.deepEqual(logged[0][1], { action: 'document.create', entityType: 'document', entityId: '12', code: '23502' });
    assert.ok(!JSON.stringify(logged).includes('private'));
  } finally { console.error = originalError; }
});
