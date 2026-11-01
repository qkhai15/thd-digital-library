import pg from "pg";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { collectInventory } from "../ops-storage-inventory.mjs";
import { databaseEnvironment, decryptFile, encryptFile, ensure, fileMetadata, OpsError, safeObjectKey, validateReceipt } from "./core.mjs";

export const REQUIRED_TABLES = Object.freeze(["thd_schema_migrations", "library_items", "library_comments", "library_likes", "library_views", "borrow_requests", "news_posts", "wall_banners", "site_settings", "admin_sessions", "admin_login_attempts", "audit_logs", "storage_upload_intents"]);
const quote = value => `"${value.replaceAll('"', '""')}"`;
const keyName = (run, name) => `thd-library/backups/${run.kind}/${run.createdAt.slice(0, 10).replaceAll("-", "/")}/${run.id}/${name}`;
const NULLABILITY_SQL = `SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name COLLATE "C",column_name COLLATE "C"`;
export const toolPath = (env, name) => env.PG_BIN ? path.join(env.PG_BIN, `${name}${process.platform === "win32" ? ".exe" : ""}`) : name;

export function postgresToolMajor(version) {
  // Official Debian images include a package suffix after the version.
  const major = Number(version.match(/^pg_dump \(PostgreSQL\) (\d+)(?:\.\d+)*(?:\s|$)/m)?.[1]);
  ensure(Number.isInteger(major) && major >= 14 && major <= 99, "BACKUP_PG_DUMP_VERSION_UNREADABLE");
  return major;
}

export function processStage(binary, args) {
  // An allowlist supplies useful diagnostics without exposing command args,
  // provider response text, SQL, connection strings or file contents.
  const name = path.basename(binary).replace(/\.exe$/i, "");
  if (name === "pg_dump") return args.includes("--version") ? "PG_DUMP_VERSION" : "PG_DUMP_ARCHIVE";
  if (name === "pg_restore") return args.includes("--list") ? "PG_RESTORE_LIST" : "PG_RESTORE";
  if (name === "docker") {
    if (args[0] === "exec") return args.includes("pg_restore") ? "DOCKER_RESTORE" : args.includes("pg_isready") ? "DOCKER_READY" : "DOCKER_EXEC";
    return ["run", "port", "cp", "rm"].includes(args[0]) ? `DOCKER_${args[0].toUpperCase()}` : "DOCKER";
  }
  return "UNKNOWN";
}

export function privateFailureCategory(diagnostic) {
  // Only allowlisted categories leave memory. The captured provider/tool
  // message itself may contain credentials, SQL or PII and is never emitted.
  if (/password authentication failed|no password supplied|SASL authentication|authentication failed/i.test(diagnostic)) return "AUTH";
  if (/certificate|SSL error|TLS handshake|sslmode|SSL connection has been closed/i.test(diagnostic)) return "TLS";
  if (/snapshot/i.test(diagnostic)) return "SNAPSHOT";
  if (/permission denied|must be owner|insufficient privilege|not permitted/i.test(diagnostic)) return "PERMISSION";
  if (/no space left|disk full/i.test(diagnostic)) return "DISK";
  if (/unsupported version.*(?:file header|archive)/i.test(diagnostic)) return "ARCHIVE_VERSION";
  if (/cannot connect to.*docker|error during connect|daemon is not running|open.*pipe.*docker/i.test(diagnostic)) return "DOCKER_UNAVAILABLE";
  if (/could not connect|connection to server|server closed|connection.*(?:timeout|timed out|refused)|network.*unreachable|SSL SYSCALL error: EOF detected/i.test(diagnostic)) return "CONNECTION";
  return "UNKNOWN";
}

export function runProcess(binary, args, env, { capture = false, limit = 8 * 1024 * 1024, inputFile, timeoutMs = 15 * 60 * 1000 } = {}) {
  ensure(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60 * 60 * 1000, "BACKUP_TOOL_TIMEOUT_INVALID");
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, windowsHide: true, stdio: [inputFile ? "pipe" : "ignore", capture ? "pipe" : "ignore", "pipe"] });
    let output = "", bytes = 0, privateDiagnostic = "", timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    timeout.unref();
    child.stdout?.on("data", chunk => { bytes += chunk.length; if (bytes > limit) child.kill(); else output += chunk; });
    child.stderr.on("data", chunk => { if (privateDiagnostic.length < 16384) privateDiagnostic += chunk.toString().slice(0, 16384 - privateDiagnostic.length); });
    child.on("error", () => { clearTimeout(timeout); reject(new OpsError(`BACKUP_EXECUTABLE_UNAVAILABLE_${processStage(binary, args)}`)); });
    child.on("close", code => {
      clearTimeout(timeout);
      const category = privateFailureCategory(privateDiagnostic);
      privateDiagnostic = "";
      if (timedOut) reject(new OpsError(`BACKUP_TOOL_TIMEOUT_${processStage(binary, args)}`));
      else if (code === 0 && bytes <= limit) resolve(output);
      else reject(new OpsError(`BACKUP_TOOL_FAILED_${processStage(binary, args)}_${category}_PRIVATE_DETAILS_SUPPRESSED`));
    });
    if (inputFile) import("node:fs").then(({ createReadStream }) => pipeline(createReadStream(inputFile), child.stdin).catch(() => child.kill()));
  });
}

export async function tableDigest(client, table) {
  ensure(/^[a-zA-Z_][\w$]*$/.test(table), "BACKUP_TABLE_IDENTIFIER_INVALID");
  const hash = createHash("sha256"); let count = 0;
  // The source/restore OS locales can differ. Binary collation makes row
  // fingerprints deterministic across Supabase and the isolated restore.
  await client.query(`DECLARE ops_backup_rows NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text value FROM public.${quote(table)} t ORDER BY to_jsonb(t)::text COLLATE "C"`);
  try {
    while (true) {
      const { rows } = await client.query("FETCH 500 FROM ops_backup_rows");
      if (!rows.length) break;
      for (const row of rows) { hash.update(row.value); hash.update("\n"); count++; }
    }
  } finally { await client.query("CLOSE ops_backup_rows"); }
  return { table, schema: "public", count: String(count), sha256: hash.digest("hex") };
}

export function archiveTables(toc) {
  return toc.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\d+;\s+\d+\s+\d+\s+TABLE DATA public (\S+)\s/);
    return match ? [match[1]] : [];
  });
}

// Version-1 manifests predate search extensions: absence means no explicit
// prerequisites. Never accept arbitrary extension names or executable SQL.
export function databaseExtensions(value) {
  if (value === undefined) return [];
  ensure(Array.isArray(value) && value.length <= 1, "BACKUP_DB_EXTENSIONS_INVALID");
  const seen = new Set();
  return value.map(entry => {
    ensure(entry && typeof entry === "object" && entry.name === "pg_trgm" &&
      typeof entry.schema === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(entry.schema) &&
      !/^(?:pg_|information_schema$)/i.test(entry.schema) && !seen.has(entry.name), "BACKUP_DB_EXTENSIONS_INVALID");
    seen.add(entry.name);
    return { name: entry.name, schema: entry.schema };
  });
}

export function isolatedExtensionSql(value) {
  return databaseExtensions(value).map(entry =>
    `CREATE SCHEMA IF NOT EXISTS ${quote(entry.schema)}; CREATE EXTENSION IF NOT EXISTS ${quote(entry.name)} WITH SCHEMA ${quote(entry.schema)};`);
}

export function validateDatabaseManifest(manifest, toc) {
  ensure(manifest?.version === 1 && manifest.kind === "db" && Array.isArray(manifest.tables) && manifest.tables.length >= REQUIRED_TABLES.length, "BACKUP_DB_MANIFEST_INVALID");
  const names = manifest.tables.map(table => table.table);
  const archived = archiveTables(toc);
  ensure(new Set(names).size === names.length && REQUIRED_TABLES.every(table => names.includes(table)), "BACKUP_EXPECTED_TABLES_MISSING");
  ensure(names.length === archived.length && names.every(table => archived.includes(table)), "BACKUP_ARCHIVE_TABLES_MISMATCH");
  for (const table of manifest.tables) ensure(table.schema === "public" && /^\d+$/.test(table.count) && /^[a-f\d]{64}$/.test(table.sha256), "BACKUP_DB_MANIFEST_INVALID");
  ensure(Array.isArray(manifest.indexes) && Array.isArray(manifest.constraints) && Array.isArray(manifest.sequences), "BACKUP_DB_MANIFEST_INVALID");
  ensure(Array.isArray(manifest.nullability) && manifest.nullability.every(column => typeof column.table_name === "string" && typeof column.column_name === "string" && ["YES", "NO"].includes(column.is_nullable)), "BACKUP_DB_NULLABILITY_MANIFEST_INVALID");
  ensure(Number.isInteger(manifest.serverMajor) && manifest.serverMajor >= 14 && manifest.serverMajor <= 99 && Number.isInteger(manifest.pgDumpMajor) && manifest.pgDumpMajor >= manifest.serverMajor && manifest.pgDumpMajor <= 99, "BACKUP_DB_VERSION_INVALID");
  databaseExtensions(manifest.extensions);
  // --schema=public includes application functions as well as tables. Assert
  // the search trigger/normalizer are actually in feature-era archives.
  if (names.includes("library_search_daily")) {
    ensure(/^\d+;\s+\d+\s+\d+\s+FUNCTION public thd_search_normalize\(text\)\s/m.test(toc) &&
      /^\d+;\s+\d+\s+\d+\s+FUNCTION public thd_library_search_update\(\)\s/m.test(toc), "BACKUP_SEARCH_FUNCTIONS_MISSING");
  }
}

async function encryptedArtifact(context, plaintext, name, role) {
  const cipher = path.join(context.directory, `${randomUUID()}.enc`);
  const metadata = await encryptFile(plaintext, cipher, context.key);
  const objectKey = keyName(context.run, name);
  await context.s3.put(objectKey, cipher, { format: "thd-aes256gcm-v1", sha256: metadata.sha256, keyid: context.keyId });
  return { role, objectKey, ...metadata };
}

async function commitRun(context, manifest, artifacts) {
  const manifestFile = path.join(context.directory, `${randomUUID()}.manifest.json`);
  await writeFile(manifestFile, JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
  const encrypted = await encryptedArtifact(context, manifestFile, "manifest.json.enc", "manifest");
  const receipt = { version: 1, kind: context.run.kind, createdAt: context.run.createdAt, id: context.run.id, keyId: context.keyId, encryption: "AES-256-GCM-v1", files: [...artifacts, encrypted] };
  validateReceipt(receipt);
  const receiptKey = keyName(context.run, "receipt.json");
  const localReceipt = path.join(context.outputDirectory, `${context.run.kind}-${context.run.id}.receipt.json`);
  await mkdir(context.outputDirectory, { recursive: true, mode: 0o700 });
  await writeFile(localReceipt, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
  // Receipt uploaded last: its presence is the completed-backup marker.
  await context.s3.put(receiptKey, localReceipt, { format: "thd-receipt-v1" });
  return { kind: context.run.kind, receiptKey, receiptFile: localReceipt, completed: true };
}

export async function backupDatabase(context) {
  const { env, directory } = context;
  const { connectionString, childEnv } = await databaseEnvironment(env, directory);
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 15000, application_name: "thd-ops-backup" });
  let client;
  try {
    client = await pool.connect();
    const socket = client.connection.stream;
    ensure(socket.encrypted === true && socket.authorized === true, "BACKUP_DATABASE_TLS_NOT_VERIFIED");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const available = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
    ensure(REQUIRED_TABLES.every(table => available.includes(table)), "BACKUP_EXPECTED_TABLES_MISSING");
    const version = (await client.query("SELECT current_setting('server_version_num')::int version")).rows[0].version;
    const toolVersion = await runProcess(toolPath(env, "pg_dump"), ["--version"], childEnv, { capture: true });
    const toolMajor = postgresToolMajor(toolVersion);
    const serverMajor = Math.floor(version / 10000);
    ensure(toolMajor >= serverMajor, "BACKUP_PG_DUMP_VERSION_TOO_OLD");
    const snapshot = (await client.query("SELECT pg_export_snapshot() snapshot")).rows[0].snapshot;
    const tables = [];
    for (const table of available) tables.push(await tableDigest(client, table));
    const indexes = (await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname")).rows;
    // PG18 catalogs NOT NULL as pg_constraint type 'n'; PG17 does not.
    // Compare all other constraints and verify actual column nullability
    // independently so a cross-major restore has equivalent coverage.
    const constraints = (await client.query("SELECT c.relname table_name,p.conname name,p.contype type,pg_get_constraintdef(p.oid) definition FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid WHERE c.relnamespace='public'::regnamespace AND p.contype<>'n' ORDER BY 1,2")).rows;
    const nullability = (await client.query(NULLABILITY_SQL)).rows;
    const sequences = (await client.query("SELECT sequencename,start_value,min_value,max_value,increment_by,cycle,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
    const extensions = databaseExtensions((await client.query("SELECT e.extname AS name,n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname=$1 ORDER BY e.extname", ["pg_trgm"])).rows);
    const archive = path.join(directory, "public.dump");
    await runProcess(toolPath(env, "pg_dump"), ["--no-password", "--no-owner", "--no-acl", "--schema=public", "--format=custom", "--compress=6", "--lock-wait-timeout=30s", `--snapshot=${snapshot}`, `--file=${archive}`], childEnv);
    const toc = await runProcess(toolPath(env, "pg_restore"), ["--list", archive], childEnv, { capture: true });
    const manifest = { version: 1, kind: "db", createdAt: context.run.createdAt, scope: "Complete public application schema/data; Supabase managed schemas and roles excluded", serverMajor, pgDumpMajor: toolMajor, tls: { mode: "verify-full", authorized: true, protocol: socket.getProtocol() }, tables, indexes, constraints, nullability, sequences, extensions, archive: await fileMetadata(archive), notes: "Snapshot-consistent transactional tables. Sequences are nontransactional; restore must preserve max(id) safety. NOT NULL is verified via column nullability for PostgreSQL17/18 catalog compatibility. Session hashes/PII exist only in encrypted archive; invalidate sessions at disaster recovery cutover." };
    validateDatabaseManifest(manifest, toc);
    await client.query("ROLLBACK");
    const artifact = await encryptedArtifact(context, archive, "public.dump.enc", "database");
    return { ...await commitRun(context, manifest, [artifact]), tables: tables.length, sourceTls: "verify-full" };
  } finally {
    if (client) { await client.query("ROLLBACK").catch(() => undefined); client.release(); }
    await pool.end();
  }
}

export function shouldExcludeStorageObject(object) {
  // Historical/operational references do not equal live content, but any active
  // reference always wins over QA origin. Unknown objects are backed up.
  return object.provenTest === true && object.isReferenced === false;
}

function storageSource(env, object) {
  const project = new URL(env.SUPABASE_URL);
  ensure(project.protocol === "https:" && /\.supabase\.(co|com)$/.test(project.hostname) && !project.username && !project.password && !project.search && !project.hash && project.pathname === "/", "BACKUP_SUPABASE_URL_INVALID");
  safeObjectKey(object.path);
  ensure(/^[a-zA-Z0-9][\w.-]{0,62}$/.test(object.bucket), "BACKUP_SOURCE_BUCKET_INVALID");
  return `${project.origin}/storage/v1/object/authenticated/${encodeURIComponent(object.bucket)}/${object.path.split("/").map(encodeURIComponent).join("/")}`;
}

export async function backupStorage(context) {
  const { env, directory } = context;
  ensure(env.SUPABASE_URL && (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY), "BACKUP_STORAGE_SOURCE_CONFIG_REQUIRED");
  const inventory = await collectInventory(env);
  ensure(Array.isArray(inventory.objects) && inventory.coverage?.allStorageObjects && inventory.coverage?.allBuckets && inventory.coverage.unknownSizes === 0, "BACKUP_STORAGE_INVENTORY_INCOMPLETE");
  const objects = [];
  let copied = 0, reused = 0, excluded = 0;
  const credential = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  // Fetch streams the server-authenticated object body; SDK download() would
  // materialize an entire Blob. These headers are never sent outside Supabase.
  const headers = { apikey: credential, Authorization: `Bearer ${credential}` };
  for (const object of inventory.objects) {
    const entry = { bucket: object.bucket, path: object.path, size: object.size, createdAt: object.createdAt, updatedAt: object.updatedAt, category: object.category, isReferenced: object.isReferenced, provenTest: object.provenTest, references: object.references, evidence: object.evidence };
    if (shouldExcludeStorageObject(object)) { objects.push({ ...entry, excluded: true, reason: "Exact proven test artifact, no live DB reference" }); excluded++; continue; }
    ensure(Number.isSafeInteger(object.size) && object.size >= 0, "BACKUP_STORAGE_SIZE_UNKNOWN");
    const sourceFile = path.join(directory, `${randomUUID()}.asset`);
    const encryptedFile = `${sourceFile}.enc`;
    const response = await fetch(storageSource(env, object), { headers, redirect: "error", signal: AbortSignal.timeout(300000) });
    ensure(response.ok && response.body, "BACKUP_STORAGE_SOURCE_READ_FAILED");
    let transferred = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) { transferred += chunk.length; callback(transferred > object.size ? new OpsError("BACKUP_STORAGE_SOURCE_SIZE_CHANGED") : null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(sourceFile, { flags: "wx", mode: 0o600 }));
    const plaintext = await fileMetadata(sourceFile);
    ensure(plaintext.bytes === object.size, "BACKUP_STORAGE_SOURCE_SIZE_CHANGED");
    const objectKey = `thd-library/backups/assets/${context.keyId}/${plaintext.sha256.slice(0, 2)}/${plaintext.sha256}.enc`;
    const existing = await context.s3.head(objectKey);
    let ciphertext;
    if (existing) {
      const metadata = existing.headers;
      ensure(metadata["x-amz-meta-keyid"] === context.keyId && metadata["x-amz-meta-plaintextsha256"] === plaintext.sha256 && /^[a-f\d]{64}$/.test(metadata["x-amz-meta-sha256"] || ""), "BACKUP_EXISTING_ASSET_METADATA_INVALID");
      ciphertext = { bytes: Number(metadata["content-length"]), sha256: metadata["x-amz-meta-sha256"] };
      ensure(Number.isSafeInteger(ciphertext.bytes) && ciphertext.bytes === plaintext.bytes + 36, "BACKUP_EXISTING_ASSET_SIZE_INVALID");
      reused++;
    } else {
      ciphertext = await encryptFile(sourceFile, encryptedFile, context.key);
      await context.s3.put(objectKey, encryptedFile, { keyid: context.keyId, plaintextsha256: plaintext.sha256, sha256: ciphertext.sha256, format: "thd-aes256gcm-v1" });
      copied++;
    }
    objects.push({ ...entry, excluded: false, plaintext, artifact: { objectKey, ...ciphertext } });
    // Only files created under this invocation's fresh private temp directory.
    await rm(sourceFile); await rm(encryptedFile, { force: true });
  }
  const manifest = { version: 1, kind: "storage", createdAt: context.run.createdAt, sourceBuckets: inventory.buckets, coverage: inventory.coverage, objects, counts: { total: objects.length, copied, reused, excluded }, notes: "Supabase-independent encrypted content-addressed copies. Unknown/orphan content included. Only exact proven test artifacts without live DB references excluded. Never mirrors source deletions." };
  return { ...await commitRun(context, manifest, []), objects: objects.length, copied, reused, excluded };
}

export async function readReceipt(context) {
  let file = context.env.BACKUP_RECEIPT_FILE;
  if (!file) {
    ensure(context.env.BACKUP_RECEIPT_KEY, "BACKUP_RECEIPT_FILE_OR_KEY_REQUIRED");
    file = path.join(context.directory, "receipt.json");
    await context.s3.get(context.env.BACKUP_RECEIPT_KEY, file);
  }
  ensure((await stat(file)).size <= 1024 * 1024, "BACKUP_RECEIPT_TOO_LARGE");
  const receipt = validateReceipt(JSON.parse(await readFile(file, "utf8")));
  ensure(receipt.keyId === context.keyId, "BACKUP_ENCRYPTION_KEY_ID_MISMATCH");
  return receipt;
}

export async function verifyBackup(context, { restore = false } = {}) {
  const receipt = await readReceipt(context);
  const files = new Map();
  for (const artifact of receipt.files) {
    const encrypted = path.join(context.directory, `${randomUUID()}.enc`);
    const plaintext = `${encrypted}.plain`;
    await context.s3.get(artifact.objectKey, encrypted);
    await decryptFile(encrypted, plaintext, context.key, artifact);
    files.set(artifact.role, plaintext);
  }
  const manifestFile = files.get("manifest");
  ensure((await stat(manifestFile)).size <= 32 * 1024 * 1024, "BACKUP_MANIFEST_TOO_LARGE");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  ensure(manifest.version === 1 && manifest.kind === receipt.kind && manifest.createdAt === receipt.createdAt, "BACKUP_MANIFEST_RECEIPT_MISMATCH");
  let restored = false;
  if (receipt.kind === "db") {
    const archive = files.get("database");
    const metadata = await fileMetadata(archive);
    ensure(metadata.bytes === manifest.archive.bytes && metadata.sha256 === manifest.archive.sha256, "BACKUP_PLAINTEXT_CHECKSUM_MISMATCH");
    const toc = await runProcess(toolPath(context.env, "pg_restore"), ["--list", archive], { PATH: context.env.PATH, SystemRoot: context.env.SystemRoot }, { capture: true });
    validateDatabaseManifest(manifest, toc);
    if (restore) { await restoreDocker(context, archive, manifest); restored = true; }
  } else {
    ensure(Array.isArray(manifest.objects) && manifest.counts && manifest.objects.length === manifest.counts.total && ["total", "copied", "reused", "excluded"].every(name => Number.isSafeInteger(manifest.counts[name]) && manifest.counts[name] >= 0) && manifest.counts.copied + manifest.counts.reused + manifest.counts.excluded === manifest.counts.total, "BACKUP_STORAGE_MANIFEST_INVALID");
    const checked = new Map(), identities = new Set();
    let excluded = 0;
    for (const object of manifest.objects) {
      safeObjectKey(object.path);
      ensure(typeof object.bucket === "string" && /^[a-zA-Z0-9][\w.-]{0,62}$/.test(object.bucket) && !identities.has(`${object.bucket}\n${object.path}`), "BACKUP_STORAGE_MANIFEST_INVALID");
      identities.add(`${object.bucket}\n${object.path}`);
      if (object.excluded) { ensure(object.provenTest === true && object.isReferenced === false && Array.isArray(object.evidence) && object.evidence.length > 0 && object.reason === "Exact proven test artifact, no live DB reference", "BACKUP_STORAGE_EXCLUSION_INVALID"); excluded++; continue; }
      ensure(object.excluded === false && object.artifact && /^[a-f\d]{64}$/.test(object.plaintext?.sha256) && Number.isSafeInteger(object.plaintext.bytes) && object.plaintext.bytes >= 0 && object.size === object.plaintext.bytes, "BACKUP_STORAGE_MANIFEST_INVALID");
      const expectedKey = `thd-library/backups/assets/${context.keyId}/${object.plaintext.sha256.slice(0, 2)}/${object.plaintext.sha256}.enc`;
      ensure(object.artifact.objectKey === expectedKey && object.artifact.bytes === object.plaintext.bytes + 36 && /^[a-f\d]{64}$/.test(object.artifact.sha256), "BACKUP_STORAGE_MANIFEST_INVALID");
      const previous = checked.get(object.artifact.objectKey);
      if (previous) { ensure(previous.bytes === object.artifact.bytes && previous.sha256 === object.artifact.sha256, "BACKUP_STORAGE_DUPLICATE_ARTIFACT_MISMATCH"); continue; }
      const encrypted = path.join(context.directory, `${randomUUID()}.enc`), plaintext = `${encrypted}.plain`;
      await context.s3.get(object.artifact.objectKey, encrypted);
      const metadata = await decryptFile(encrypted, plaintext, context.key, object.artifact);
      ensure(metadata.bytes === object.plaintext.bytes && metadata.sha256 === object.plaintext.sha256, "BACKUP_STORAGE_PLAINTEXT_CHECKSUM_MISMATCH");
      checked.set(object.artifact.objectKey, object.artifact);
      await rm(encrypted); await rm(plaintext);
    }
    ensure(excluded === manifest.counts.excluded, "BACKUP_STORAGE_MANIFEST_INVALID");
  }
  return { kind: receipt.kind, ciphertextChecksums: "PASS", authenticatedDecryption: "PASS", plaintextChecksums: "PASS", expectedTables: receipt.kind === "db" ? manifest.tables.length : undefined, storageManifest: receipt.kind === "storage" ? "PASS" : undefined, realIsolatedRestore: restored ? "PASS" : "NOT_RUN", productionWrites: false };
}

async function restoreDocker(context, archive, manifest) {
  ensure(context.env.BACKUP_RESTORE_DOCKER === "true", "BACKUP_ISOLATED_DOCKER_RESTORE_FLAG_REQUIRED");
  const extensionSql = isolatedExtensionSql(manifest.extensions);
  const name = `thd-restore-${randomUUID()}`;
  const dockerEnv = { PATH: context.env.PATH, SystemRoot: context.env.SystemRoot, USERPROFILE: context.env.USERPROFILE, HOME: context.env.HOME, DOCKER_HOST: context.env.DOCKER_HOST, DOCKER_CONTEXT: context.env.DOCKER_CONTEXT };
  // Explicit new throwaway container, loopback-only port, no existing DB target,
  // no mounted data volume, no production URL/password in its environment.
  // Same major as pg_dump ensures pg_restore reads its archive format, and is
  // never older than the source. Logical restore into a newer PG is deliberate.
  const image = `postgres:${manifest.pgDumpMajor}-bookworm`;
  let created = false;
  try {
    await runProcess("docker", ["run", "--detach", "--name", name, "--memory", "512m", "--publish", "127.0.0.1::5432", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_DB=thd_restore_check", image], dockerEnv);
    created = true;
    const portOutput = await runProcess("docker", ["port", name, "5432/tcp"], dockerEnv, { capture: true });
    const port = Number(portOutput.match(/^127\.0\.0\.1:(\d+)\s*$/)?.[1]);
    ensure(port > 0, "BACKUP_RESTORE_DOCKER_PORT_INVALID");
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await runProcess("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "thd_restore_check"], dockerEnv); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    ensure(ready, "BACKUP_RESTORE_DOCKER_NOT_READY");
    for (const sql of extensionSql) {
      // This target is exclusively the fresh loopback-only throwaway container
      // above. There is no caller-supplied connection string or production URL.
      await runProcess("docker", ["exec", name, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--username=postgres", "--dbname=thd_restore_check", "--command", sql], dockerEnv);
    }
    const toc = await runProcess(toolPath(context.env, "pg_restore"), ["--list", archive], { PATH: context.env.PATH, SystemRoot: context.env.SystemRoot }, { capture: true });
    const listFile = path.join(context.directory, "restore.toc");
    // public already exists in a fresh standard database; retain every table,
    // index, constraint, sequence and function entry while avoiding recreation.
    await writeFile(listFile, toc.split(/\r?\n/).filter(line => !/ SCHEMA - public | COMMENT - SCHEMA public /.test(line)).join("\n"), { flag: "wx", mode: 0o600 });
    await runProcess("docker", ["cp", listFile, `${name}:/tmp/restore.toc`], dockerEnv);
    await runProcess("docker", ["exec", "-i", name, "pg_restore", "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", "--use-list=/tmp/restore.toc", "--username=postgres", "--dbname=thd_restore_check"], dockerEnv, { inputFile: archive });
    const pool = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", database: "thd_restore_check", max: 1, connectionTimeoutMillis: 10000 });
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN READ ONLY"); await client.query("SET LOCAL TIME ZONE 'UTC'");
        const expectedExtensions = databaseExtensions(manifest.extensions);
        if (expectedExtensions.length) {
          const actualExtensions = (await client.query("SELECT e.extname AS name,n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname=ANY($1::text[]) ORDER BY e.extname", [expectedExtensions.map(entry => entry.name)])).rows;
          ensure(JSON.stringify(actualExtensions) === JSON.stringify(expectedExtensions), "BACKUP_RESTORE_EXTENSIONS_MISMATCH");
        }
        for (const expected of manifest.tables) {
          const actual = await tableDigest(client, expected.table);
          const label = REQUIRED_TABLES.includes(expected.table) ? expected.table.toUpperCase() : "ADDITIONAL_TABLE";
          ensure(actual.count === expected.count, `BACKUP_RESTORE_ROW_COUNT_MISMATCH_${label}`);
          ensure(actual.sha256 === expected.sha256, `BACKUP_RESTORE_ROW_CHECKSUM_MISMATCH_${label}`);
        }
        const indexes = Number((await client.query("SELECT count(*) FROM pg_indexes WHERE schemaname='public'")).rows[0].count);
        const constraints = Number((await client.query("SELECT count(*) FROM pg_constraint WHERE contype<>'n' AND conrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)")).rows[0].count);
        const sequences = Number((await client.query("SELECT count(*) FROM pg_sequences WHERE schemaname='public'")).rows[0].count);
        ensure(indexes === manifest.indexes.length, "BACKUP_RESTORE_INDEX_COUNT_MISMATCH");
        ensure(constraints === manifest.constraints.length, "BACKUP_RESTORE_CONSTRAINT_COUNT_MISMATCH");
        ensure(sequences === manifest.sequences.length, "BACKUP_RESTORE_SEQUENCE_COUNT_MISMATCH");
        const nullability = (await client.query(NULLABILITY_SQL)).rows;
        ensure(JSON.stringify(nullability) === JSON.stringify(manifest.nullability), "BACKUP_RESTORE_NULLABILITY_MISMATCH");
        const owned = (await client.query(`SELECT seq.relname sequence_name,t.relname table_name,a.attname column_name FROM pg_class seq JOIN pg_depend d ON d.objid=seq.oid AND d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i') JOIN pg_class t ON t.oid=d.refobjid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid WHERE seq.relkind='S' AND seq.relnamespace='public'::regnamespace`)).rows;
        for (const sequence of owned) {
          const state = (await client.query(`SELECT last_value::text,is_called FROM public.${quote(sequence.sequence_name)}`)).rows[0];
          const max = (await client.query(`SELECT max(${quote(sequence.column_name)})::text value FROM public.${quote(sequence.table_name)}`)).rows[0].value;
          if (max !== null) ensure(state.is_called ? BigInt(state.last_value) >= BigInt(max) : BigInt(state.last_value) > BigInt(max), "BACKUP_RESTORE_SEQUENCE_BEHIND_DATA");
        }
        await client.query("ROLLBACK");
      } finally { client.release(); }
    } finally { await pool.end(); }
  } finally {
    // Only the exact uniquely named container created by this invocation, with
    // no production/local source volume. No Docker prune or existing deletion.
    if (created) await runProcess("docker", ["rm", "--force", name], dockerEnv);
  }
}

export function newRun(kind) {
  const createdAt = new Date().toISOString();
  return { kind, createdAt, id: `${createdAt.replace(/[:.]/g, "-")}-${randomUUID()}` };
}
