/** Additive only: existing approved loans remain reserved; no stock rewrite. */
export async function migrateBorrowFeatures(client) {
  await client.query(`ALTER TABLE borrow_requests
    ADD COLUMN IF NOT EXISTS request_code varchar(24),
    ADD COLUMN IF NOT EXISTS requested_at timestamptz,
    ADD COLUMN IF NOT EXISTS ready_at timestamptz,
    ADD COLUMN IF NOT EXISTS borrowed_at timestamptz,
    ADD COLUMN IF NOT EXISTS due_at timestamptz,
    ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz`);
  await client.query(`UPDATE borrow_requests SET request_code='BR-'||upper(substr(replace(pg_catalog.gen_random_uuid()::text,'-',''),1,18)) WHERE request_code IS NULL`);
  await client.query('UPDATE borrow_requests SET requested_at=created_at WHERE requested_at IS NULL');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_borrow_request_code ON borrow_requests(request_code)');
  await client.query(`ALTER TABLE borrow_requests
    ALTER COLUMN request_code SET DEFAULT ('BR-'||upper(substr(replace(pg_catalog.gen_random_uuid()::text,'-',''),1,18))),
    ALTER COLUMN request_code SET NOT NULL,
    ALTER COLUMN requested_at SET NOT NULL,
    ALTER COLUMN requested_at SET DEFAULT NOW()`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_borrow_due ON borrow_requests(due_at) WHERE status='borrowed'`);
  await client.query(`CREATE TABLE IF NOT EXISTS borrow_events (
    id bigserial PRIMARY KEY, request_id integer NOT NULL REFERENCES borrow_requests(id) ON DELETE CASCADE,
    from_status varchar(30), to_status varchar(30) NOT NULL, actor varchar(120) NOT NULL DEFAULT 'admin',
    created_at timestamptz NOT NULL DEFAULT NOW())`);
  await client.query('CREATE INDEX IF NOT EXISTS idx_borrow_events_request ON borrow_events(request_id,created_at,id)');
  // A snapshot records legacy status without inventing historical transitions
  // or marking an approved reservation as physically handed over.
  await client.query(`INSERT INTO borrow_events(request_id,from_status,to_status,actor,created_at)
    SELECT b.id,NULL,b.status,'migration',NOW() FROM borrow_requests b
    WHERE NOT EXISTS (SELECT 1 FROM borrow_events e WHERE e.request_id=b.id)`);
  await client.query('ALTER TABLE borrow_events ENABLE ROW LEVEL SECURITY');
  await client.query('REVOKE ALL ON borrow_events FROM PUBLIC');
  await client.query('REVOKE ALL ON SEQUENCE borrow_events_id_seq FROM PUBLIC');
  for(const role of ['anon','authenticated']) {
    const exists=await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role]);
    if(exists.rowCount){await client.query(`REVOKE ALL ON borrow_events FROM ${role}`);await client.query(`REVOKE ALL ON SEQUENCE borrow_events_id_seq FROM ${role}`);}
  }
}
