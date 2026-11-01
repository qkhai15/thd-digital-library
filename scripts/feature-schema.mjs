/** Additive catalog migration. The caller owns transaction/advisory lock. */
export async function migrateCatalogFeatures(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS library_subjects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL CHECK (length(trim(name)) > 0),
    slug VARCHAR(180) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query(`ALTER TABLE library_items
    ADD COLUMN IF NOT EXISTS publisher VARCHAR(255),
    ADD COLUMN IF NOT EXISTS publication_year INTEGER CHECK (publication_year BETWEEN 1 AND 9999),
    ADD COLUMN IF NOT EXISTS isbn VARCHAR(32),
    ADD COLUMN IF NOT EXISTS language VARCHAR(80),
    ADD COLUMN IF NOT EXISTS page_count INTEGER CHECK (page_count BETWEEN 1 AND 1000000),
    ADD COLUMN IF NOT EXISTS source TEXT,
    ADD COLUMN IF NOT EXISTS rights TEXT,
    ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES library_subjects(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS topics TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_library_items_subject_grade
    ON library_items(subject_id,class_level,status)`);
  await client.query('CREATE INDEX IF NOT EXISTS idx_library_items_topics ON library_items USING GIN(topics)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_library_items_tags ON library_items USING GIN(tags)');
  await client.query(`CREATE TABLE IF NOT EXISTS library_collections (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL CHECK (length(trim(title)) > 0),
    slug VARCHAR(280) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    cover_url TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','archived')),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS library_collection_items (
    collection_id INTEGER NOT NULL REFERENCES library_collections(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    PRIMARY KEY(collection_id,item_id)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_collection_items_order
    ON library_collection_items(collection_id,sort_order,item_id)`);
  await client.query('CREATE INDEX IF NOT EXISTS idx_collection_items_item ON library_collection_items(item_id,collection_id)');
  await client.query(`CREATE INDEX IF NOT EXISTS idx_collections_public_order
    ON library_collections(status,is_featured,sort_order,id)`);
  // Only the privileged application connection is allowed to read/write these.
  // Public Data API access is deliberately not added by this migration.
  for (const table of ['library_subjects', 'library_collections', 'library_collection_items']) {
    await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await client.query(`REVOKE ALL ON ${table} FROM PUBLIC`);
    for (const role of ['anon', 'authenticated']) {
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
      if (exists.rowCount) await client.query(`REVOKE ALL ON ${table} FROM ${role}`);
    }
  }
  for (const sequence of ['library_subjects_id_seq', 'library_collections_id_seq']) {
    await client.query(`REVOKE ALL ON SEQUENCE ${sequence} FROM PUBLIC`);
    for (const role of ['anon', 'authenticated']) {
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
      if (exists.rowCount) await client.query(`REVOKE ALL ON SEQUENCE ${sequence} FROM ${role}`);
    }
  }
}
