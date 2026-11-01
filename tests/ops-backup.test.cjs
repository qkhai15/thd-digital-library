const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, writeFile, rm, mkdir } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomBytes, createHash, createHmac } = require("node:crypto");
const core = import("../scripts/ops-backup/core.mjs");
const jobs = import("../scripts/ops-backup/jobs.mjs");

test("encrypted backup is randomized authenticated AES-GCM, streams a real multi-chunk payload and roundtrips SHA256", async () => {
  const { encryptFile, decryptFile, fileMetadata } = await core;
  const directory = await mkdtemp(path.join(os.tmpdir(), "thd-ops-test-"));
  try {
    const key = randomBytes(32), source = path.join(directory, "source.dump"), a = path.join(directory, "a.enc"), b = path.join(directory, "b.enc");
    const bytes = randomBytes(3 * 1024 * 1024 + 71);
    await writeFile(source, bytes);
    const metadataA = await encryptFile(source, a, key), metadataB = await encryptFile(source, b, key);
    assert.equal(metadataA.bytes, bytes.length + 36);
    assert.notEqual(metadataA.sha256, metadataB.sha256);
    const ciphertext = await readFile(a);
    assert.equal(ciphertext.includes(bytes.subarray(0, 128)), false);
    const result = await decryptFile(a, path.join(directory, "restored.dump"), key, metadataA);
    assert.deepEqual(result, await fileMetadata(source));
    assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
    await assert.rejects(decryptFile(a, path.join(directory, "wrongkey"), randomBytes(32), metadataA), /AUTHENTICATION_FAILED/);
    await assert.rejects(readFile(path.join(directory, "wrongkey")), { code: "ENOENT" });
    await assert.rejects(decryptFile(a, path.join(directory, "badhash"), key, { ...metadataA, sha256: "0".repeat(64) }), /CHECKSUM_MISMATCH/);
    ciphertext[200] ^= 1;
    const tampered = path.join(directory, "tampered.enc");
    await writeFile(tampered, ciphertext);
    await assert.rejects(decryptFile(tampered, path.join(directory, "badtag"), key), /AUTHENTICATION_FAILED/);
    await assert.rejects(readFile(path.join(directory, "badtag")), { code: "ENOENT" });
    const existing = path.join(directory, "existing");
    await writeFile(existing, "do not overwrite");
    await assert.rejects(decryptFile(a, existing, key, metadataA), /AUTHENTICATION_FAILED/);
    assert.equal(await readFile(existing, "utf8"), "do not overwrite");
    await writeFile(path.join(directory, "truncated"), ciphertext.subarray(0, 20));
    await assert.rejects(decryptFile(path.join(directory, "truncated"), path.join(directory, "badsize"), key), /TRUNCATED/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("empty Storage objects authenticate and decrypt without invalid file stream offsets", async () => {
  const { encryptFile, decryptFile, fileMetadata } = await core;
  const directory = await mkdtemp(path.join(os.tmpdir(), "thd-ops-test-"));
  try {
    const key = randomBytes(32), source = path.join(directory, "empty"), encrypted = path.join(directory, "empty.enc"), restored = path.join(directory, "restored");
    await writeFile(source, "");
    const ciphertext = await encryptFile(source, encrypted, key);
    assert.equal(ciphertext.bytes, 36);
    assert.deepEqual(await decryptFile(encrypted, restored, key, ciphertext), await fileMetadata(source));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("backup encryption key, paths, independent target and immutable receipt fail closed", async () => {
  const { parseEncryptionKey, safeObjectKey, s3Config, validateReceipt } = await core;
  const key = randomBytes(32);
  assert.deepEqual(parseEncryptionKey(key.toString("base64")), key);
  assert.deepEqual(parseEncryptionKey(key.toString("hex")), key);
  for (const input of [undefined, "password", key.toString("base64") + "!", randomBytes(31).toString("base64")]) assert.throws(() => parseEncryptionKey(input));
  for (const input of ["../x", "x/../../secret", "/root", "a//b", "a\\b", "a/./b", "a\u0000b"]) assert.throws(() => safeObjectKey(input));
  assert.equal(safeObjectKey("thd-library/backups/2026/a.enc"), "thd-library/backups/2026/a.enc");
  const env = { BACKUP_S3_ENDPOINT: "https://test.r2.cloudflarestorage.com", BACKUP_S3_REGION: "auto", BACKUP_S3_BUCKET: "backups", BACKUP_S3_ACCESS_KEY_ID: "fixture", BACKUP_S3_SECRET_ACCESS_KEY: "fixture" };
  assert.equal(s3Config(env).region, "auto");
  assert.throws(() => s3Config({ ...env, BACKUP_S3_ENDPOINT: "https://source.supabase.co" }), /INDEPENDENT/);
  assert.throws(() => s3Config({ ...env, BACKUP_S3_ENDPOINT: "http://localhost" }), /HTTPS/);
  assert.throws(() => s3Config({ ...env, BACKUP_S3_ENDPOINT: "https://user:pass@test.r2.cloudflarestorage.com" }), /HTTPS/);
  const receipt = { version: 1, kind: "db", createdAt: "2026-10-15T00:00:00.000Z", keyId: "a".repeat(12), files: [{ role: "manifest", objectKey: "x/manifest.enc", bytes: 100, sha256: "a".repeat(64) }, { role: "database", objectKey: "x/db.enc", bytes: 1000, sha256: "b".repeat(64) }] };
  assert.equal(validateReceipt(receipt), receipt);
  assert.throws(() => validateReceipt({ ...receipt, files: [receipt.files[0], receipt.files[0]] }));
  assert.throws(() => validateReceipt({ ...receipt, files: receipt.files.map(artifact => ({ ...artifact, objectKey: "../escape" })) }));
});

test("S3 SigV4 signs exact encoded path, headers, UTC scope and payload without leaking secret in URL", async () => {
  const { signS3Request } = await core;
  const signed = signS3Request({ endpoint: "https://example.r2.cloudflarestorage.com", region: "auto", bucket: "backup-bucket", accessKeyId: "EXAMPLE", secretAccessKey: "fake-signing-secret", method: "PUT", key: "a b/ảnh.pdf.enc", payloadHash: "a".repeat(64), date: new Date("2026-10-15T19:15:00.000Z"), headers: { "content-type": "application/octet-stream", "content-length": "42", "if-none-match": "*" } });
  assert.equal(signed.url, "https://example.r2.cloudflarestorage.com/backup-bucket/a%20b/%E1%BA%A3nh.pdf.enc");
  const expectedCanonical = ["PUT", "/backup-bucket/a%20b/%E1%BA%A3nh.pdf.enc", "", "content-length:42\ncontent-type:application/octet-stream\nhost:example.r2.cloudflarestorage.com\nif-none-match:*\nx-amz-content-sha256:" + "a".repeat(64) + "\nx-amz-date:20261015T191500Z\n", "content-length;content-type;host;if-none-match;x-amz-content-sha256;x-amz-date", "a".repeat(64)].join("\n");
  assert.equal(signed.canonical, expectedCanonical);
  const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
  const signingKey = hmac(hmac(hmac(hmac("AWS4fake-signing-secret", "20261015"), "auto"), "s3"), "aws4_request");
  const expectedSignature = createHmac("sha256", signingKey).update("AWS4-HMAC-SHA256\n20261015T191500Z\n20261015/auto/s3/aws4_request\n" + createHash("sha256").update(expectedCanonical).digest("hex")).digest("hex");
  assert.equal(signed.signature, expectedSignature);
  assert.match(signed.headers.authorization, /Credential=EXAMPLE\/20261015\/auto\/s3\/aws4_request/);
  assert.equal(signed.url.includes("secret"), false);
});

test("backup includes unknown/orphan content and never excludes a test-origin object still referenced by DB", async () => {
  const { shouldExcludeStorageObject } = await jobs;
  assert.equal(shouldExcludeStorageObject({ provenTest: true, isReferenced: false }), true);
  assert.equal(shouldExcludeStorageObject({ provenTest: true, isReferenced: true }), false);
  assert.equal(shouldExcludeStorageObject({ provenTest: false, isReferenced: false, category: "orphan" }), false);
  assert.equal(shouldExcludeStorageObject({ path: "qa-test-looking-file.pdf", isReferenced: false }), false);
  assert.equal(shouldExcludeStorageObject({ provenTest: true }), false);
});

test("archive verification requires actual expected public table data, not just any readable dump", async () => {
  const { REQUIRED_TABLES, archiveTables, validateDatabaseManifest } = await jobs;
  const toc = REQUIRED_TABLES.map((table, index) => `${index + 1}; 0 123 TABLE DATA public ${table} postgres`).join("\n");
  const manifest = { version: 1, kind: "db", serverMajor: 17, pgDumpMajor: 18, tables: REQUIRED_TABLES.map(table => ({ table, schema: "public", count: "0", sha256: "a".repeat(64) })), indexes: [], constraints: [], sequences: [], nullability: [{ table_name: "library_items", column_name: "id", is_nullable: "NO" }] };
  assert.deepEqual(archiveTables(toc), [...REQUIRED_TABLES]);
  validateDatabaseManifest(manifest, toc);
  assert.throws(() => validateDatabaseManifest(manifest, toc.split("\n").slice(1).join("\n")), /TABLES_MISMATCH/);
  assert.throws(() => validateDatabaseManifest({ ...manifest, tables: manifest.tables.slice(1) }, toc));
  assert.throws(() => validateDatabaseManifest({ ...manifest, pgDumpMajor: 16 }, toc), /VERSION_INVALID/);
  assert.throws(() => validateDatabaseManifest({ ...manifest, nullability: undefined }, toc), /NULLABILITY_MANIFEST_INVALID/);
  assert.throws(() => validateDatabaseManifest({ ...manifest, nullability: [{ table_name: "library_items", column_name: "id", is_nullable: "UNKNOWN" }] }, toc), /NULLABILITY_MANIFEST_INVALID/);
});

test("backup extension prerequisites preserve legacy manifests and allow only safe pg_trgm schemas", async () => {
  const { databaseExtensions, isolatedExtensionSql } = await jobs;
  assert.deepEqual(databaseExtensions(undefined), []);
  assert.deepEqual(isolatedExtensionSql(undefined), []);
  for (const schema of ["public", "extensions", "custom_extensions"]) {
    const extensions = [{ name: "pg_trgm", schema }];
    assert.deepEqual(databaseExtensions(extensions), extensions);
    assert.deepEqual(isolatedExtensionSql(extensions), [
      `CREATE SCHEMA IF NOT EXISTS "${schema}"; CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "${schema}";`,
    ]);
  }
  const invalid = [null, {}, "pg_trgm", [null], [{ name: "dblink", schema: "public" }],
    [{ name: "pg_trgm;DROP TABLE library_items", schema: "public" }],
    [{ name: "pg_trgm", schema: 'extensions";DROP SCHEMA public CASCADE;--' }],
    [{ name: "pg_trgm", schema: "public; SELECT 1" }], [{ name: "pg_trgm", schema: "pg_catalog" }],
    [{ name: "pg_trgm", schema: "pg_temp_1" }], [{ name: "pg_trgm", schema: "information_schema" }],
    [{ name: "pg_trgm", schema: "" }], [{ name: "pg_trgm", schema: "a".repeat(64) }],
    [{ name: "pg_trgm", schema: "extensions" }, { name: "pg_trgm", schema: "public" }]];
  for (const value of invalid) {
    assert.throws(() => databaseExtensions(value), error => error.code === "BACKUP_DB_EXTENSIONS_INVALID" && !error.message.includes("DROP"));
    assert.throws(() => isolatedExtensionSql(value), /EXTENSIONS_INVALID/);
  }
});

test("feature-era database archives include public search functions and validate extension metadata before restore", async () => {
  const { REQUIRED_TABLES, validateDatabaseManifest } = await jobs;
  const names = [...REQUIRED_TABLES, "library_search_daily"];
  const toc = names.map((table, index) => `${index + 1}; 0 123 TABLE DATA public ${table} postgres`).join("\n") +
    "\n80; 1255 990 FUNCTION public thd_search_normalize(text) postgres\n81; 1255 991 FUNCTION public thd_library_search_update() postgres\n";
  const manifest = { version: 1, kind: "db", serverMajor: 17, pgDumpMajor: 18,
    tables: names.map(table => ({ table, schema: "public", count: "0", sha256: "a".repeat(64) })),
    indexes: [], constraints: [], sequences: [], nullability: [], extensions: [{ name: "pg_trgm", schema: "extensions" }] };
  validateDatabaseManifest(manifest, toc);
  assert.throws(() => validateDatabaseManifest(manifest, toc.replace("FUNCTION public thd_search_normalize(text)", "FUNCTION private thd_search_normalize(text)")), /SEARCH_FUNCTIONS_MISSING/);
  assert.throws(() => validateDatabaseManifest(manifest, toc.replace("thd_library_search_update()", "unrelated_function()")), /SEARCH_FUNCTIONS_MISSING/);
  assert.throws(() => validateDatabaseManifest({ ...manifest, extensions: [{ name: "untrusted_extension", schema: "public" }] }, toc), /EXTENSIONS_INVALID/);
});

test("PostgreSQL version and failure-stage diagnostics handle Debian images without exposing command arguments", async () => {
  const { postgresToolMajor, processStage, privateFailureCategory } = await jobs;
  assert.equal(postgresToolMajor("pg_dump (PostgreSQL) 18.6\r\n"), 18);
  assert.equal(postgresToolMajor("pg_dump (PostgreSQL) 18.0 (Debian 18.0-1.pgdg13+3)\n"), 18);
  assert.throws(() => postgresToolMajor("unknown version 18"), /VERSION_UNREADABLE/);
  assert.equal(processStage("docker", ["exec", "private-container", "pg_restore", "private-path"]), "DOCKER_RESTORE");
  assert.equal(processStage("pg_dump", ["--version"]), "PG_DUMP_VERSION");
  assert.equal(processStage("pg_restore", ["--list", "private-path"]), "PG_RESTORE_LIST");
  assert.equal(processStage("unrecognized-private-tool", ["private-value"]), "UNKNOWN");
  assert.equal(privateFailureCategory('password authentication failed for user "private-name" password=do-not-log'), "AUTH");
  assert.equal(privateFailureCategory("could not import snapshot private-id"), "SNAPSHOT");
  assert.equal(privateFailureCategory("connection to server at private-host failed: Connection timed out"), "CONNECTION");
  assert.equal(privateFailureCategory("certificate verify failed with privatepath"), "TLS");
  assert.equal(privateFailureCategory("unexpected private secret message"), "UNKNOWN");
});

test("external tools have bounded runtime and missing executable errors remain redacted", async () => {
  const { runProcess } = await jobs;
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
  await assert.rejects(runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], env, { timeoutMs: 100 }), /BACKUP_TOOL_TIMEOUT_UNKNOWN/);
  await assert.rejects(runProcess(path.join(os.tmpdir(), "thd-missing-executable-private-name"), [], env), error => error.code === "BACKUP_EXECUTABLE_UNAVAILABLE_UNKNOWN" && !error.message.includes("private-name"));
  assert.throws(() => runProcess(process.execPath, [], env, { timeoutMs: 0 }), /TIMEOUT_INVALID/);
});

test("table digest uses a read-only cursor and binary collation for locale-independent restore comparison", async () => {
  const { tableDigest } = await jobs;
  const statements = [];
  let fetched = false;
  const client = { query: async sql => {
    statements.push(sql);
    if (sql === "FETCH 500 FROM ops_backup_rows" && !fetched) { fetched = true; return { rows: [{ value: '{"title":"A"}' }, { value: '{"title":"Á"}' }] }; }
    return { rows: [] };
  } };
  const actual = await tableDigest(client, "library_items");
  assert.equal(actual.count, "2");
  assert.equal(actual.sha256, createHash("sha256").update('{"title":"A"}\n{"title":"Á"}\n').digest("hex"));
  assert.match(statements[0], /ORDER BY to_jsonb\(t\)::text COLLATE "C"$/);
  assert.equal(statements.at(-1), "CLOSE ops_backup_rows");
  await assert.rejects(tableDigest(client, 'items";DROP TABLE items'), /IDENTIFIER_INVALID/);
});

test("Storage backup verification reads encrypted target artifacts, checks all unknown assets and rejects tampering or unsafe exclusions", async () => {
  const { encryptFile, fileMetadata, sha256 } = await core;
  const { verifyBackup } = await jobs;
  const { localRehearsalTarget } = await import("../scripts/ops-backup.mjs");
  const directory = await mkdtemp(path.join(os.tmpdir(), "thd-ops-test-"));
  try {
    const key = randomBytes(32), keyId = sha256(key).slice(0, 12), target = await localRehearsalTarget(path.join(directory, "target"));
    const objects = [];
    for (const [index, payload] of [Buffer.from("production content fixture"), Buffer.alloc(0)].entries()) {
      const source = path.join(directory, `source-${index}`), encrypted = `${source}.enc`;
      await writeFile(source, payload);
      const plaintext = await fileMetadata(source), ciphertext = await encryptFile(source, encrypted, key);
      const objectKey = `thd-library/backups/assets/${keyId}/${plaintext.sha256.slice(0, 2)}/${plaintext.sha256}.enc`;
      await target.put(objectKey, encrypted);
      objects.push({ bucket: "thd-library", path: `unknown/${index}.bin`, size: payload.length, excluded: false, plaintext, artifact: { objectKey, ...ciphertext } });
    }
    objects.push({ ...objects[0], plaintext: { ...objects[0].plaintext }, artifact: { ...objects[0].artifact }, path: "duplicate/content.bin" });
    objects.push({ bucket: "thd-library-quarantine", path: "qa/proven.bin", size: 7, excluded: true, provenTest: true, isReferenced: false, evidence: [{ type: "owned-qa-upload-manifest", file: "test-results/owned.json" }], reason: "Exact proven test artifact, no live DB reference" });
    const manifest = { version: 1, kind: "storage", createdAt: "2026-10-16T00:00:00.000Z", objects, counts: { total: 4, copied: 2, reused: 1, excluded: 1 } };
    let fixture = 0;
    const verify = async data => {
      const id = fixture++, manifestFile = path.join(directory, `manifest-${id}.json`), encrypted = `${manifestFile}.enc`, receiptFile = path.join(directory, `receipt-${id}.json`), scratch = path.join(directory, `verify-${id}`);
      await writeFile(manifestFile, JSON.stringify(data));
      const ciphertext = await encryptFile(manifestFile, encrypted, key), objectKey = `manifests/${id}.enc`;
      await target.put(objectKey, encrypted);
      await writeFile(receiptFile, JSON.stringify({ version: 1, kind: "storage", keyId, createdAt: data.createdAt, files: [{ role: "manifest", objectKey, ...ciphertext }] }));
      await mkdir(scratch);
      return verifyBackup({ key, keyId, directory: scratch, env: { BACKUP_RECEIPT_FILE: receiptFile }, s3: target });
    };
    const result = await verify(manifest);
    assert.equal(result.storageManifest, "PASS");
    assert.equal(result.authenticatedDecryption, "PASS");
    assert.equal(result.productionWrites, false);
    const invalidExclusion = structuredClone(manifest);
    invalidExclusion.objects[3].provenTest = false;
    await assert.rejects(verify(invalidExclusion), /EXCLUSION_INVALID/);
    const invalidReuse = structuredClone(manifest);
    invalidReuse.objects[2].artifact.sha256 = "0".repeat(64);
    await assert.rejects(verify(invalidReuse), /DUPLICATE_ARTIFACT_MISMATCH/);
    const invalidCounts = structuredClone(manifest);
    invalidCounts.counts.excluded = 0;
    await assert.rejects(verify(invalidCounts), /MANIFEST_INVALID/);
    const missingAsset = structuredClone(manifest);
    missingAsset.objects[0].artifact.objectKey = "../outside";
    await assert.rejects(verify(missingAsset), /MANIFEST_INVALID/);
    const targetFile = path.join(directory, "target", ...objects[0].artifact.objectKey.split("/"));
    const tampered = await readFile(targetFile);
    tampered[21] ^= 1;
    await writeFile(targetFile, tampered);
    await assert.rejects(verify(manifest), /CIPHERTEXT_CHECKSUM_MISMATCH/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cron cadence is daily DB at 02:15 Vietnam and weekly storage Sunday Vietnam; local adapter rejects traversal and overwrite", async () => {
  const { scheduledActions, localRehearsalTarget } = await import("../scripts/ops-backup.mjs");
  assert.deepEqual(scheduledActions(new Date("2026-10-16T19:15:00Z")), ["db"]);
  assert.deepEqual(scheduledActions(new Date("2026-10-17T19:15:00Z")), ["db", "storage"]);
  const directory = await mkdtemp(path.join(os.tmpdir(), "thd-ops-test-"));
  try {
    const target = await localRehearsalTarget(path.join(directory, "target")), source = path.join(directory, "source");
    await writeFile(source, "encryptedfixture");
    await target.put("immutable/one.enc", source, { sha256: "abc" });
    await assert.rejects(target.put("immutable/one.enc", source));
    await assert.rejects(target.put("../escape", source));
    assert.equal((await target.head("immutable/one.enc")).headers["x-amz-meta-sha256"], "abc");
    assert.equal(await target.head("missing"), null);
    await mkdir(path.join(directory, "download"));
    await target.get("immutable/one.enc", path.join(directory, "download", "copy"));
    assert.equal(await readFile(path.join(directory, "download", "copy"), "utf8"), "encryptedfixture");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
