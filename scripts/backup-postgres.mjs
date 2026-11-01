import pg from "pg";
import dotenv from "dotenv";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

dotenv.config({ path: ".env.local", quiet: true });
const connectionString = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("Missing source DATABASE_URL.");
const source = new URL(connectionString);
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("This backup command requires a local source database.");
const binaryDir = process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin";
const tool = name => path.join(binaryDir, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = path.resolve("deploy/data/backups", `local-${timestamp}`);
await mkdir(directory, { recursive: true });
const childEnv = { ...process.env, PGHOST: source.hostname, PGPORT: source.port || "5432", PGDATABASE: decodeURIComponent(source.pathname.slice(1)), PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password) };
function run(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(tool(name), args, { env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "";
    child.stdout.on("data", bytes => output += bytes);
    child.stderr.on("data", bytes => error += bytes);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(`${name} failed (${code}): ${error}`)));
  });
}
const quote = name => `"${name.replaceAll('"', '""')}"`;
const pool = new pg.Pool({ connectionString, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  const info = (await client.query("SELECT current_database() database, current_user username, version() version, current_setting('server_version_num') server_version_num, pg_database_size(current_database()) bytes")).rows[0];
  const snapshot = (await client.query("SELECT pg_export_snapshot() snapshot")).rows[0].snapshot;
  const tables = (await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename")).rows;
  const counts = [];
  for (const table of tables) {
    const identifier = `${quote(table.schemaname)}.${quote(table.tablename)}`;
    const result = await client.query(`SELECT count(*)::text count, md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text),'')) digest FROM ${identifier} t`);
    counts.push({ schema: table.schemaname, table: table.tablename, ...result.rows[0] });
  }
  const indexes = (await client.query("SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3")).rows;
  const constraints = (await client.query("SELECT n.nspname schema,c.relname table_name,con.conname name,con.contype type,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3")).rows;
  const columns = (await client.query("SELECT table_schema,table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,ordinal_position")).rows;
  const sequences = (await client.query("SELECT * FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,sequencename")).rows;
  const extensions = (await client.query("SELECT extname,extversion FROM pg_extension ORDER BY extname")).rows;
  const migrations = (await client.query("SELECT * FROM public.thd_schema_migrations ORDER BY version")).rows;
  const files = {};
  for (const [name, extras] of [["database.dump", []], ["public.dump", ["--schema=public"]], ["schema.sql", ["--schema-only"]]]) {
    const destination = path.join(directory, name);
    await run("pg_dump", ["--no-password", `--snapshot=${snapshot}`, ...extras, ...(name.endsWith(".dump") ? ["--format=custom"] : []), `--file=${destination}`]);
    const bytes = await readFile(destination);
    files[name] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  for (const name of ["database.dump", "public.dump"]) {
    const toc = await run("pg_restore", ["--list", path.join(directory, name)]);
    await writeFile(path.join(directory, `${name}.toc`), toc);
    if (!(await stat(path.join(directory, name))).size) throw new Error("Empty backup.");
  }
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ created_at: new Date().toISOString(), info, tables: counts, indexes, constraints, columns, sequences, extensions, migrations, files, verification: "archive readable; restore rehearsal still required", notes: "Contains private data/session hashes; keep encrypted and off-site. No database mutations by this command." }, null, 2));
  await client.query("ROLLBACK");
  console.log(JSON.stringify({ backup: directory, tables: counts.map(({ schema, table, count }) => ({ schema, table, count })), indexes: indexes.length, constraints: constraints.length, sequences: sequences.length, files }, null, 2));
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  client.release();
  await pool.end();
}
