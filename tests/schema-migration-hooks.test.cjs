const test = require('node:test');
const assert = require('node:assert/strict');
const migration = import('../scripts/schema.mjs');

function fixture({ current = false } = {}) {
  const statements = [];
  let released = 0;
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql.includes('WHERE version=$1')) return { rows: [], rowCount: current ? 1 : 0 };
      if (/SELECT 1 FROM thd_schema_migrations WHERE version=[1234]$/.test(sql)) return { rows: [{}], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() { released++; },
  };
  return { client, statements, pool: { connect: async () => client }, releases: () => released };
}

test('migration invariant hooks share the migration transaction and surround version writes before COMMIT', async () => {
  const { migrateSchema } = await migration;
  const db = fixture();
  await migrateSchema(db.pool, {
    async beforeMigration(client) {
      assert.equal(client, db.client);
      assert.ok(db.statements.some(entry => entry.sql === 'BEGIN'));
      assert.ok(db.statements.some(entry => entry.sql.includes('pg_advisory_xact_lock')));
      assert.ok(!db.statements.some(entry => entry.sql.includes('WHERE version=1')));
      await client.query('RELEASE_CHECK_BEFORE');
    },
    async afterMigration(client) {
      assert.equal(client, db.client);
      assert.ok(db.statements.some(entry => entry.sql === 'INSERT INTO thd_schema_migrations(version) VALUES(5)'));
      assert.ok(!db.statements.some(entry => entry.sql === 'COMMIT'));
      await client.query('RELEASE_CHECK_AFTER');
    },
  });
  const order = db.statements.map(entry => entry.sql);
  assert.ok(order.indexOf('RELEASE_CHECK_BEFORE') < order.findIndex(sql => sql.includes('ALTER TABLE borrow_requests')));
  assert.ok(order.indexOf('RELEASE_CHECK_AFTER') > order.indexOf('INSERT INTO thd_schema_migrations(version) VALUES(5)'));
  assert.equal(order.at(-1), 'COMMIT');
  assert.ok(!order.includes('ROLLBACK'));
  assert.equal(db.releases(), 1);
});

test('a failed post-migration invariant rolls back schema and version writes and releases the same client', async () => {
  const { migrateSchema } = await migration;
  const db = fixture();
  const rejected = new Error('invariant-fixture');
  await assert.rejects(migrateSchema(db.pool, {
    async afterMigration(client) {
      assert.equal(client, db.client);
      assert.ok(db.statements.some(entry => entry.sql.includes('VALUES(5)')));
      throw rejected;
    },
  }), error => error === rejected);
  assert.equal(db.statements.at(-1).sql, 'ROLLBACK');
  assert.ok(!db.statements.some(entry => entry.sql === 'COMMIT'));
  assert.equal(db.releases(), 1);
});

test('a failed pre-migration invariant aborts before application schema writes', async () => {
  const { migrateSchema } = await migration;
  const db = fixture();
  let afterCalled = false;
  await assert.rejects(migrateSchema(db.pool, {
    async beforeMigration() { throw new Error('lock-or-invariant-fixture'); },
    async afterMigration() { afterCalled = true; },
  }), /lock-or-invariant-fixture/);
  assert.equal(afterCalled, false);
  assert.equal(db.statements.at(-1).sql, 'ROLLBACK');
  assert.ok(!db.statements.some(entry => entry.sql.includes('WHERE version=1') || /ALTER TABLE|INSERT INTO thd_schema_migrations/.test(entry.sql)));
  assert.equal(db.releases(), 1);
});

test('current-schema replay commits without invoking hooks and existing runtime callers need no options', async () => {
  const { migrateSchema } = await migration;
  const current = fixture({ current: true });
  await migrateSchema(current.pool, {
    async beforeMigration() { assert.fail('Current-schema replay must skip hooks'); },
    async afterMigration() { assert.fail('Current-schema replay must skip hooks'); },
  });
  assert.equal(current.statements.at(-1).sql, 'COMMIT');
  assert.equal(current.releases(), 1);
  const runtime = fixture();
  await migrateSchema(runtime.pool);
  assert.equal(runtime.statements.at(-1).sql, 'COMMIT');
  assert.equal(runtime.releases(), 1);
});
