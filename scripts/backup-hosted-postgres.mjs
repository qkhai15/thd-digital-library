import pg from 'pg';
import dotenv from 'dotenv';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Explicit application allowlist: never back up/restore Supabase's managed
// auth, storage, realtime or extension schemas through this command.
const APP_TABLES = Object.freeze([
  'thd_schema_migrations', 'library_items', 'library_comments', 'library_likes',
  'library_views', 'borrow_requests', 'news_posts', 'wall_banners', 'site_settings',
  'admin_sessions', 'admin_login_attempts', 'audit_logs', 'storage_upload_intents',
]);
const quote = value => `"${value.replaceAll('"', '""')}"`;
let pool;
let client;
let directory;

async function fileMetadata(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return { bytes: (await stat(file)).size, sha256: digest.digest('hex') };
}

try {
  // Loading is read-only and quiet. Values never enter CLI arguments or logs.
  const envFile = process.env.BACKUP_ENV_FILE || '.env.local';
  const env = { ...dotenv.parse(await readFile(envFile)), ...process.env };
  const raw = env.BACKUP_DATABASE_URL || env.SUPABASE_DATABASE_URL;
  if (!raw) throw new Error('BACKUP_DATABASE_URL or SUPABASE_DATABASE_URL is required.');
  const source = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) throw new Error('Hosted PostgreSQL connection required.');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Verified encrypted database connection requires TLS verification enabled.');
  const caFile = path.resolve(env.BACKUP_DB_SSL_CA_FILE || env.DB_SSL_CA_FILE || 'deploy/data/certs/prod-ca-2021.crt');
  if (!(await stat(caFile)).isFile()) throw new Error('Database CA certificate file is required.');
  source.searchParams.set('sslmode', 'verify-full');
  source.searchParams.set('sslrootcert', caFile);
  // Do not accept URL flags that weaken verification or redirect SSL material.
  for (const parameter of ['sslcert', 'sslkey']) source.searchParams.delete(parameter);
  const binaryDir = env.PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
  const tool = name => binaryDir ? path.join(binaryDir, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;
  const childEnv = {
    ...env, PGHOST: source.hostname, PGPORT: source.port || '5432',
    PGDATABASE: decodeURIComponent(source.pathname.slice(1)), PGUSER: decodeURIComponent(source.username),
    PGPASSWORD: decodeURIComponent(source.password), PGSSLMODE: 'verify-full', PGSSLROOTCERT: caFile,
    PGAPPNAME: 'thd-library-hosted-backup',
  };
  delete childEnv.PGSERVICE; delete childEnv.PGSERVICEFILE;
  const run = (name, args) => new Promise((resolve, reject) => {
    const child = spawn(tool(name), args, { env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => output += bytes);
    // libpq/SDK errors can include connection metadata. Never emit stderr.
    child.stderr.on('data', () => undefined);
    child.on('error', () => reject(new Error(`${name} executable unavailable.`)));
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${name} failed (${code}); private details suppressed.`)));
  });
  pool = new pg.Pool({ connectionString: source.toString(), max: 1, connectionTimeoutMillis: 15000, application_name: 'thd-library-hosted-backup' });
  client = await pool.connect();
  const socket = client.connection.stream;
  if (!socket.encrypted || !socket.authorized) throw new Error('Verified encrypted database connection required.');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const available = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])", [APP_TABLES])).rows.map(row => row.tablename);
  if (available.length !== APP_TABLES.length || APP_TABLES.some(table => !available.includes(table))) throw new Error('Application schema incomplete; backup not started.');
  const version = (await client.query("SELECT current_database() database, current_user username, current_setting('server_version') version, current_setting('server_version_num') server_version_num")).rows[0];
  const snapshot = (await client.query('SELECT pg_export_snapshot() snapshot')).rows[0].snapshot;
  const tables = [];
  for (const table of APP_TABLES) {
    const row = (await client.query(`SELECT COUNT(*)::text count, md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) digest FROM public.${quote(table)} t`)).rows[0];
    tables.push({ schema: 'public', table, ...row });
  }
  const indexes = (await client.query("SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY 1,2,3", [APP_TABLES])).rows;
  const constraints = (await client.query("SELECT n.nspname schema,c.relname table_name,con.conname name,con.contype type,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY 1,2,3", [APP_TABLES])).rows;
  const columns = (await client.query("SELECT table_schema,table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY 1,2,ordinal_position", [APP_TABLES])).rows;
  const sequences = (await client.query(`SELECT s.* FROM pg_sequences s
    JOIN pg_namespace n ON n.nspname=s.schemaname JOIN pg_class seq ON seq.relnamespace=n.oid AND seq.relname=s.sequencename
    JOIN pg_depend d ON d.objid=seq.oid AND d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')
    JOIN pg_class t ON t.oid=d.refobjid JOIN pg_namespace tn ON tn.oid=t.relnamespace
    WHERE s.schemaname='public' AND tn.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY s.sequencename`, [APP_TABLES])).rows;
  for (const sequence of sequences) {
    const state = (await client.query(`SELECT last_value::text, is_called FROM public.${quote(sequence.sequencename)}`)).rows[0];
    sequence.last_value = state.last_value; sequence.is_called = state.is_called;
  }
  const rls = (await client.query("SELECT relname table_name,relrowsecurity enabled,relforcerowsecurity forced FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[]) ORDER BY relname", [APP_TABLES])).rows;
  const policies = (await client.query("SELECT * FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,policyname", [APP_TABLES])).rows;
  const migrations = (await client.query('SELECT * FROM public.thd_schema_migrations ORDER BY version')).rows;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  directory = path.resolve('deploy/data/backups', `hosted-app-${timestamp}`);
  await mkdir(directory, { recursive: true });
  const filters = [...APP_TABLES.map(table => `--table=public.${table}`), ...sequences.map(sequence => `--table=public.${sequence.sequencename}`)];
  const common = ['--no-password', '--no-owner', '--no-acl', '--strict-names', `--snapshot=${snapshot}`, ...filters];
  const dump = path.join(directory, 'public.dump');
  await run('pg_dump', [...common, '--format=custom', `--file=${dump}`]);
  await run('pg_dump', [...common, '--schema-only', `--file=${path.join(directory, 'schema.sql')}`]);
  const toc = await run('pg_restore', ['--list', dump]);
  for (const table of APP_TABLES) if (!toc.split(/\r?\n/).some(line => line.includes(` TABLE DATA public ${table} `))) throw new Error('Backup archive missing application table data.');
  await writeFile(path.join(directory, 'public.dump.toc'), toc);
  const files = Object.fromEntries(await Promise.all(['public.dump', 'schema.sql', 'public.dump.toc'].map(async name => [name, await fileMetadata(path.join(directory, name))])));
  if (files['public.dump'].bytes === 0) throw new Error('Empty archive.');
  const manifest = {
    created_at: new Date().toISOString(), scope: '13 explicitly allowlisted public application tables and their owned sequences; Supabase managed schemas excluded.',
    info: version, tls: { mode: 'verify-full', encrypted: true, authorized: true, protocol: socket.getProtocol() },
    tables, indexes, constraints, columns, sequences, rls, policies, migrations, files,
    verification: 'Snapshot-consistent custom archive readable with pg_restore --list. Restore rehearsal is a separate read/write operation and was not run.',
    notes: 'Private backup contains PII and session hashes; keep encrypted/off-site and outside Git. This script performs no database mutation. Sequence counters are non-transactional; preserve observed values/max IDs when restoring into a fresh isolated database. Never restore blindly over the live database.',
  };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ result: 'PASS', backup: directory, tls: 'verify-full', tables: tables.map(({ table, count }) => ({ table, count })), indexes: indexes.length, constraints: constraints.length, sequences: sequences.length, archiveReadable: true }, null, 2));
} catch (error) {
  const safeMessages = /^(?:BACKUP_DATABASE_URL|Hosted PostgreSQL|Database CA|Verified encrypted|Application schema|Backup archive|Empty archive|pg_dump|pg_restore)/;
  const message = error instanceof Error && safeMessages.test(error.message) ? error.message : 'Hosted backup failed; connection/credential details suppressed.';
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,15}$/.test(error.code) ? error.code : undefined;
  console.error(JSON.stringify({ result: 'FAIL', message, ...(code ? { code } : {}), ...(directory ? { partialBackup: directory } : {}) }));
  process.exitCode = 1;
} finally {
  if (client) { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
  await pool?.end();
}
