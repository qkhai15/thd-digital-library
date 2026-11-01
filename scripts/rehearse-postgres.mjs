import pg from "pg";
import dotenv from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

dotenv.config({ path: ".env.local", quiet: true });
const directory = path.resolve(process.argv[2] || "");
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
const archive = path.join(directory, "public.dump");
if (createHash("sha256").update(await readFile(archive)).digest("hex") !== manifest.files["public.dump"].sha256) throw new Error("Archive hash mismatch.");
const source = new URL(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)) throw new Error("Local rehearsal only.");
const database = `thd_restore_check_${Date.now()}`;
const admin = new pg.Pool({ connectionString: source.toString(), max: 1 });
// A fresh isolated database, never DROP/reset/truncate the original database.
try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
const toc = (await readFile(path.join(directory, "public.dump.toc"), "utf8")).split(/\r?\n/).filter(line => !/ SCHEMA - public | COMMENT - SCHEMA public /.test(line)).join("\n");
const list = path.join(directory, "rehearsal.toc");
await writeFile(list, toc);
const childEnv = { ...process.env, PGHOST:source.hostname, PGPORT:source.port || "5432", PGDATABASE:database, PGUSER:decodeURIComponent(source.username), PGPASSWORD:decodeURIComponent(source.password) };
await new Promise((resolve, reject) => {
  const binary = path.join(process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin", process.platform === "win32" ? "pg_restore.exe" : "pg_restore");
  const child = spawn(binary, ["--no-password", "--no-owner", "--no-acl", "--single-transaction", "--exit-on-error", `--use-list=${list}`, `--dbname=${database}`, archive], { env:childEnv, windowsHide:true, stdio:["ignore","ignore","pipe"] });
  child.stderr.on("data", () => undefined);
  child.on("error", reject);
  child.on("close", code => code === 0 ? resolve() : reject(new Error(`Restore failed (${code}); isolated database retained.`)));
});
source.pathname = `/${database}`;
const pool = new pg.Pool({ connectionString:source.toString(), max:1 });
const client = await pool.connect();
const quote = value => `"${value.replaceAll('"','""')}"`;
try {
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  for (const table of manifest.tables) {
    const row = (await client.query(`SELECT count(*)::text count, md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) digest FROM ${quote(table.schema)}.${quote(table.table)} t`)).rows[0];
    if (row.count !== table.count || row.digest !== table.digest) throw new Error(`Rehearsal verification failed: ${table.table}`);
  }
  const indexes = Number((await client.query("SELECT count(*) FROM pg_indexes WHERE schemaname='public'")).rows[0].count);
  const constraints = Number((await client.query("SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'")).rows[0].count);
  if (indexes !== manifest.indexes.length || constraints !== manifest.constraints.length) throw new Error("Schema object counts do not match.");
  const report = { database, tables:manifest.tables.length, tableCountsAndDigests:"PASS", indexes, constraints, result:"PASS", note:"Isolated restored copy retained. Original database untouched. This is not a Supabase verification." };
  await writeFile(path.join(directory,"rehearsal.json"), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally { await client.query("ROLLBACK").catch(()=>undefined); client.release(); await pool.end(); }
