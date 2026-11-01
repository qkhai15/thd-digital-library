// Called inside the additive catalog migration transaction. No external service.
export async function migrateSearchFeatures(client) {
  await client.query(`CREATE OR REPLACE FUNCTION public.thd_search_normalize(value text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
      SELECT translate(lower(coalesce(value,'')),
      'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')
    $$`);
  await client.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT ''`);
  await client.query(`CREATE OR REPLACE FUNCTION public.thd_library_search_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.search_text := public.thd_search_normalize(
      coalesce(NEW.title,'') || ' ' || coalesce(NEW.author,'') || ' ' || coalesce(NEW.description,'') || ' ' ||
      coalesce(NEW.publisher,'') || ' ' || coalesce(NEW.category,'') || ' ' || coalesce(NEW.class_level,'') || ' ' ||
      coalesce(array_to_string(NEW.topics,' '),'') || ' ' || coalesce(array_to_string(NEW.tags,' '),'')); RETURN NEW; END $$`);
  await client.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='thd_library_search_update' AND tgrelid='library_items'::regclass) THEN
    CREATE TRIGGER thd_library_search_update BEFORE INSERT OR UPDATE OF title,author,description,publisher,category,class_level,topics,tags
    ON library_items FOR EACH ROW EXECUTE FUNCTION public.thd_library_search_update(); END IF; END $$`);
  await client.query(`UPDATE library_items SET search_text=public.thd_search_normalize(
    coalesce(title,'') || ' ' || coalesce(author,'') || ' ' || coalesce(description,'') || ' ' || coalesce(publisher,'') || ' ' ||
    coalesce(category,'') || ' ' || coalesce(class_level,'') || ' ' || coalesce(array_to_string(topics,' '),'') || ' ' || coalesce(array_to_string(tags,' '),''))
    WHERE search_text=''`);
  // Supabase places pg_trgm in extensions; fresh PostgreSQL may place it in public.
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  const extension = await client.query("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm'");
  const schema = extension.rows[0]?.nspname;
  if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('Invalid pg_trgm schema');
  await client.query(`CREATE INDEX IF NOT EXISTS idx_library_search_trigram ON library_items USING gin (search_text "${schema}".gin_trgm_ops)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_library_views_recent ON library_views(created_at DESC,item_id)`);
  await client.query(`CREATE TABLE IF NOT EXISTS library_search_daily (
    search_day date NOT NULL DEFAULT CURRENT_DATE,
    normalized_query varchar(120) NOT NULL,
    query varchar(120) NOT NULL,
    search_count bigint NOT NULL DEFAULT 1 CHECK(search_count>0),
    zero_result_count bigint NOT NULL DEFAULT 0 CHECK(zero_result_count>=0),
    last_result_count integer NOT NULL DEFAULT 0 CHECK(last_result_count>=0),
    last_searched_at timestamptz NOT NULL DEFAULT NOW(),
    PRIMARY KEY(search_day,normalized_query)
  )`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_search_daily_time ON library_search_daily(last_searched_at DESC)`);
  await client.query(`ALTER TABLE library_search_daily ENABLE ROW LEVEL SECURITY`);
  await client.query(`REVOKE ALL ON library_search_daily FROM PUBLIC`);
  for (const role of ['anon','authenticated']) {
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role]);
    if (exists.rowCount) await client.query(`REVOKE ALL ON library_search_daily FROM ${role}`);
  }
}
