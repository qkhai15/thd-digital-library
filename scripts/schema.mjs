import { migrateCatalogFeatures } from './feature-schema.mjs';
import { migrateSearchFeatures } from './search-feature-schema.mjs';
import { migrateBorrowFeatures } from './borrow-feature-schema.mjs';

/** Shared, additive migration used by the app and deployment CLI. */
export const SCHEMA_VERSION = 5;

/**
 * Hooks run on the same transaction/client so release tooling can lock and
 * compare existing data before COMMIT. A failed invariant aborts the migration.
 * Already-current databases skip both hooks; runtime callers need no options.
 * @param {import('pg').Pool} pool
 * @param {{beforeMigration?:(client:import('pg').PoolClient)=>Promise<void>,afterMigration?:(client:import('pg').PoolClient)=>Promise<void>}} options
 */
export async function migrateSchema(pool, { beforeMigration, afterMigration } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(74201831)');
    await client.query(`CREATE TABLE IF NOT EXISTS thd_schema_migrations (
      version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const complete = await client.query('SELECT 1 FROM thd_schema_migrations WHERE version=$1', [SCHEMA_VERSION]);
    if (complete.rowCount) { await client.query('COMMIT'); return; }
    if (beforeMigration) await beforeMigration(client);
    const applied = await client.query('SELECT 1 FROM thd_schema_migrations WHERE version=1');
    if (!applied.rowCount) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS library_items (
      id SERIAL PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      author VARCHAR(255) NOT NULL DEFAULT '',
      type VARCHAR(80) NOT NULL,
      category VARCHAR(150) NOT NULL DEFAULT '',
      class_level VARCHAR(30) NOT NULL DEFAULT 'Khác',
      format VARCHAR(120) NOT NULL DEFAULT '',
      cover_url TEXT,
      file_url TEXT,
      gallery_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
      description TEXT NOT NULL DEFAULT '',
      stock INTEGER,
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      status VARCHAR(30) NOT NULL DEFAULT 'published',
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS gallery_urls JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await client.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;`);
  await client.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS likes INTEGER NOT NULL DEFAULT 0;`);
  await client.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0;`);
  await client.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'published';`);
  await client.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;`);
  await client.query(`UPDATE library_items SET published_at = COALESCE(published_at, created_at) WHERE status='published' AND published_at IS NULL;`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS library_comments (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      visitor_id VARCHAR(120),
      name VARCHAR(120) NOT NULL,
      content TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'approved',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`ALTER TABLE library_comments ADD COLUMN IF NOT EXISTS visitor_id VARCHAR(120);`);
  await client.query(`ALTER TABLE library_comments ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'approved';`);
  await client.query(`ALTER TABLE library_comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS library_likes (
      item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      visitor_id VARCHAR(120) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_id, visitor_id)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS library_views (
      item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      visitor_id VARCHAR(120) NOT NULL,
      view_day DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_id, visitor_id, view_day)
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS borrow_requests (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      visitor_id VARCHAR(120),
      borrower_name VARCHAR(150) NOT NULL,
      class_name VARCHAR(80) NOT NULL DEFAULT '',
      phone VARCHAR(40) NOT NULL DEFAULT '',
      email VARCHAR(180) NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      approved_at TIMESTAMPTZ,
      returned_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS news_posts (
      id SERIAL PRIMARY KEY,
      title VARCHAR(500) NOT NULL,
      slug VARCHAR(520) NOT NULL UNIQUE,
      excerpt TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      cover_url TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'published',
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS wall_banners (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,
      link_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key VARCHAR(120) PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash VARCHAR(128) PRIMARY KEY,
      username VARCHAR(120) NOT NULL,
      ip_address VARCHAR(120),
      user_agent TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_login_attempts (
      id BIGSERIAL PRIMARY KEY,
      ip_address VARCHAR(120) NOT NULL,
      username VARCHAR(120) NOT NULL DEFAULT '',
      success BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(120) NOT NULL DEFAULT 'admin',
      action VARCHAR(120) NOT NULL,
      entity_type VARCHAR(80) NOT NULL DEFAULT '',
      entity_id VARCHAR(120) NOT NULL DEFAULT '',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_library_items_status_type ON library_items(status, type);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_library_items_views ON library_items(views DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_library_items_created_at ON library_items(created_at DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_library_comments_item_status ON library_comments(item_id, status, created_at DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_borrow_requests_status ON borrow_requests(status, created_at DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_news_posts_status_date ON news_posts(status, published_at DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_wall_banners_active_order ON wall_banners(is_active, sort_order, id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip_time ON admin_login_attempts(ip_address, created_at DESC);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);`);


    await client.query('INSERT INTO thd_schema_migrations(version) VALUES(1)');
    }
    // Additive v2: no existing library/session data is rewritten or removed.
    const v2 = await client.query('SELECT 1 FROM thd_schema_migrations WHERE version=2');
    if (!v2.rowCount) {
    await client.query(`CREATE TABLE IF NOT EXISTS storage_upload_intents (
      id UUID PRIMARY KEY,
      owner_token_hash VARCHAR(128) NOT NULL,
      username VARCHAR(120) NOT NULL,
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('document','audio','video')),
      document_type VARCHAR(80) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      expected_size BIGINT NOT NULL CHECK (expected_size > 0 AND expected_size <= 524288000),
      expected_mime VARCHAR(100) NOT NULL,
      source_bucket VARCHAR(100) NOT NULL,
      source_key TEXT NOT NULL UNIQUE,
      destination_bucket VARCHAR(100) NOT NULL,
      destination_key TEXT NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','rejected')),
      result JSONB,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CHECK ((status = 'completed' AND result IS NOT NULL AND completed_at IS NOT NULL) OR status <> 'completed')
    )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_upload_intents_owner_status ON storage_upload_intents(owner_token_hash,status,expires_at)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_upload_intents_username_created ON storage_upload_intents(username,created_at)');
    // The application is the only authority for upload intents. Supabase's
    // anon/authenticated Data API must never expose session hashes or metadata.
    await client.query('ALTER TABLE storage_upload_intents ENABLE ROW LEVEL SECURITY');
    await client.query('REVOKE ALL ON storage_upload_intents FROM PUBLIC');
    for (const role of ['anon', 'authenticated']) {
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
      if (exists.rowCount) await client.query(`REVOKE ALL ON storage_upload_intents FROM ${role}`);
    }
    await client.query('INSERT INTO thd_schema_migrations(version) VALUES(2)');
    }
    const catalogApplied=await client.query('SELECT 1 FROM thd_schema_migrations WHERE version=3');
    if(!catalogApplied.rowCount){await migrateCatalogFeatures(client);await client.query('INSERT INTO thd_schema_migrations(version) VALUES(3)');}
    const searchApplied=await client.query('SELECT 1 FROM thd_schema_migrations WHERE version=4');
    if(!searchApplied.rowCount){await migrateSearchFeatures(client);await client.query('INSERT INTO thd_schema_migrations(version) VALUES(4)');}
    const borrowApplied=await client.query('SELECT 1 FROM thd_schema_migrations WHERE version=5');
    if(!borrowApplied.rowCount){await migrateBorrowFeatures(client);await client.query('INSERT INTO thd_schema_migrations(version) VALUES(5)');}
    if (afterMigration) await afterMigration(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
