import pg from "pg";
import dotenv from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

// Explicit target only: NEVER use DATABASE_URL (which is the local source).
dotenv.config({ path: process.env.DB_TARGET_ENV_FILE || ".env.local", quiet: true });
const targetString = process.env.SUPABASE_DATABASE_URL;
if (!targetString) throw new Error("Configure SUPABASE_DATABASE_URL or DB_TARGET_ENV_FILE. No database changed.");
const target = new URL(targetString);
if (!["postgres:", "postgresql:"].includes(target.protocol) || !target.hostname.endsWith(".supabase.co") && !target.hostname.endsWith(".supabase.com")) throw new Error("Target must be an explicitly configured Supabase Postgres endpoint.");
if (target.port === "6543") throw new Error("Use direct/session connection for restore, not transaction pooler.");
target.searchParams.set("sslmode", "verify-full");
if (process.env.DB_SSL_CA_FILE) target.searchParams.set("sslrootcert", path.resolve(process.env.DB_SSL_CA_FILE));
const args = process.argv.slice(2);
const archiveEmpty = args.includes("--archive-empty-library-table");
const backup = args.find(arg => !arg.startsWith("--"));
if (!backup || args.filter(arg => !arg.startsWith("--")).length !== 1 || args.some(arg => arg.startsWith("--") && !["--apply", "--archive-empty-library-table"].includes(arg))) throw new Error("Usage: node scripts/restore-supabase.mjs BACKUP_DIRECTORY [--apply] [--archive-empty-library-table]");
const directory = path.resolve(backup);
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
const archive = path.join(directory, "public.dump");
const fingerprint = createHash("sha256").update(await readFile(archive)).digest("hex");
if (fingerprint !== manifest.files["public.dump"].sha256) throw new Error("Backup hash mismatch.");
if (manifest.tables.some(table => table.schema !== "public")) throw new Error("Non-public source tables require a reviewed migration plan.");
const quote = name => `"${name.replaceAll('"', '""')}"`;
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const tools = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
function run(tool, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(tools, `${tool}${process.platform === "win32" ? ".exe" : ""}`), args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", bytes => output += bytes);
    // Avoid printing database errors that could contain restored personal data.
    child.stderr.on("data", () => undefined);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(`${tool} failed (${code}); transaction rolled back if restore was attempted.`)));
  });
}
const childEnv = { ...process.env, PGHOST:target.hostname, PGPORT:target.port || "5432", PGDATABASE:decodeURIComponent(target.pathname.slice(1)), PGUSER:decodeURIComponent(target.username), PGPASSWORD:decodeURIComponent(target.password), PGSSLMODE:"verify-full", ...(target.searchParams.get("sslrootcert") ? { PGSSLROOTCERT:target.searchParams.get("sslrootcert") } : {}) };
const pool = new pg.Pool({ connectionString: target.toString(), max: 1, connectionTimeoutMillis: 15000 });
try {
  const info = (await pool.query("SELECT current_database() database,version() version,current_setting('server_version_num') version_num")).rows[0];
  const markerExists = (await pool.query("SELECT to_regclass('thd_ops.imports') present")).rows[0].present;
  if (markerExists && (await pool.query("SELECT 1 FROM thd_ops.imports WHERE fingerprint=$1", [fingerprint])).rowCount) {
    console.log("Already imported this exact backup. No writes, no duplicates, no overwrite of newer data.");
    process.exitCode = 0;
  } else {
    const sourceNames = manifest.tables.map(table => table.table);
    const conflicts = await pool.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])", [sourceNames]);
    let archiveExisting = false;
    let ownedSequence = null;
    if (conflicts.rowCount) {
      if (!archiveEmpty || conflicts.rowCount !== 1 || conflicts.rows[0].relname !== "library_items") throw new Error("Target contains application objects without a matching import marker; no overwrite or merge attempted.");
      const existing = (await pool.query("SELECT count(*)::text count FROM public.library_items")).rows[0];
      if (existing.count !== "0") throw new Error("Existing library_items has data; no archive or merge attempted.");
      if ((await pool.query("SELECT to_regclass('thd_legacy.library_items') present")).rows[0].present) throw new Error("Legacy archive destination already exists.");
      ownedSequence = (await pool.query("SELECT pg_get_serial_sequence('public.library_items','id') name")).rows[0].name?.split(".").pop();
      archiveExisting = true;
    }
    const sourceSequences = manifest.sequences.map(sequence => sequence.sequencename);
    if ((await pool.query("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])", [sourceSequences.filter(name => name !== ownedSequence)])).rowCount) throw new Error("Target sequence conflict.");
    console.log(JSON.stringify({ target:target.hostname, database:info.database, version:info.version, sourceTables:sourceNames, mode:args.includes("--apply") ? "apply" : "preflight-only" }));
    if (args.includes("--apply")) {
      // Preserve target auth/storage/extensions and existing unrelated data in a full backup.
      const targetBackup = `target-before-${Date.now()}.dump`;
      await run("pg_dump", ["--no-password", "--format=custom", `--file=${path.join(directory, targetBackup)}`], childEnv);
      const sqlFile = path.join(directory, "restore-public.sql");
      await run("pg_restore", ["--no-owner", "--no-acl", "--schema=public", `--file=${sqlFile}`, archive]);
      let sql = await readFile(sqlFile, "utf8");
      sql = sql.replace(/^CREATE SCHEMA public;\r?\n/gm, "");
      if (Number(info.version_num) < 170000) throw new Error("Target below PG17 requires an explicit compatibility rehearsal.");
      sql += "\nCREATE SCHEMA IF NOT EXISTS thd_ops;\nCREATE TABLE IF NOT EXISTS thd_ops.imports(fingerprint text PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now());\n";
      for (const table of manifest.tables) {
        const identifier = `${quote(table.schema)}.${quote(table.table)}`;
        sql += `DO $verify$ BEGIN IF (SELECT count(*) FROM ${identifier}) <> ${table.count} OR (SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) FROM ${identifier} t) <> ${literal(table.digest)} THEN RAISE EXCEPTION 'Imported table verification failed'; END IF; END $verify$;\n`;
        // Deny public Data API access to personal data/admin state; pg server uses a privileged DB role.
        sql += `ALTER TABLE ${identifier} ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE ${identifier} FROM anon, authenticated;\n`;
      }
      sql += `REVOKE ALL ON SCHEMA thd_ops FROM PUBLIC,anon,authenticated;\nINSERT INTO thd_ops.imports(fingerprint) VALUES(${literal(fingerprint)});\n`;
      const archiveSql = archiveExisting ? "CREATE SCHEMA IF NOT EXISTS thd_legacy; REVOKE ALL ON SCHEMA thd_legacy FROM PUBLIC,anon,authenticated; LOCK TABLE public.library_items IN ACCESS EXCLUSIVE MODE; DO $empty$ BEGIN IF EXISTS(SELECT 1 FROM public.library_items) THEN RAISE EXCEPTION 'Legacy table received data; abort'; END IF; END $empty$; ALTER TABLE public.library_items SET SCHEMA thd_legacy;\n" : "";
      await writeFile(sqlFile, `SET TIME ZONE 'UTC';\n${archiveSql}${sql}`);
      // No DROP/clean/TRUNCATE. Everything including COPY and marker commits atomically.
      await run("psql", ["--no-password", "--single-transaction", "--set=ON_ERROR_STOP=1", `--file=${sqlFile}`], childEnv);
      console.log("Restore committed; every table count/digest matched, sequences/indexes/constraints restored, public Data API blocked.");
    }
  }
} finally { await pool.end(); }
