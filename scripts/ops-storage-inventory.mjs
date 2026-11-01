import pg from 'pg';
import dotenv from 'dotenv';
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { storageCapacityBudget, storageCapacityLevel } from './storage-capacity-policy.mjs';

const MIB = 1024 ** 2;
const PROVENANCE_MAX_BYTES = 2 * MIB;
const PROVENANCE_PURPOSE = 'backup-exclusion-only-not-deletion-authorization';
const quote = value => `"${value.replaceAll('"', '""')}"`;
const objectId = (bucket, key) => `${bucket}\n${key}`;
const safeKey = key => key && key.length <= 1024 && key.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\\u0000-\u001f]/.test(part));

/** Resolve only this application's bucket URLs; discard signed URL query values. */
export function parseStorageReference(raw, env) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replaceAll('\\/', '/').replaceAll('&amp;', '&');
  try {
    // URL parsing normalizes dot segments, so reject traversal before parsing.
    const rawPath = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    if (/[\\\u0000-\u001f]/.test(rawPath) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) return null;
    const storage = new URL(env.SUPABASE_URL);
    const applicationOrigins = new Set([env.APP_ORIGIN, ...(env.PUBLIC_ORIGINS || '').split(',')].filter(Boolean).map(origin => new URL(origin.trim()).origin));
    const url = new URL(value, env.APP_ORIGIN || 'https://inventory.invalid');
    let bucket;
    let key;
    if (value.startsWith('/uploads/') || applicationOrigins.has(url.origin) && url.pathname.startsWith('/uploads/')) {
      bucket = env.SUPABASE_STORAGE_BUCKET;
      key = decodeURIComponent(url.pathname.slice('/uploads/'.length).replace(/^supabase\//, ''));
    } else if (url.origin === storage.origin) {
      const match = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (!match) return null;
      bucket = decodeURIComponent(match[1]); key = decodeURIComponent(match[2]);
    }
    if (!bucket || !safeKey(key) || !/^[a-zA-Z0-9_.-]+$/.test(bucket)) return null;
    return { bucket, path: key };
  } catch { return null; }
}

export function extractStorageReferences(value, env) {
  const found = new Map();
  function visit(part) {
    if (typeof part === 'string') {
      const normalized = part.replaceAll('\\/', '/');
      for (const candidate of [normalized, ...(normalized.match(/(?:https?:\/\/|\/uploads\/)[^\s<>"'`]+/g) || [])]) {
        const match = parseStorageReference(candidate, env);
        if (match) found.set(objectId(match.bucket, match.path), match);
      }
    } else if (Array.isArray(part)) part.forEach(visit);
    else if (part && typeof part === 'object') Object.values(part).forEach(visit);
  }
  visit(value);
  return [...found.values()];
}

/** Only exact manifest-owned upload URLs are proof. Names/prefixes alone are not. */
export function evidenceFromReports(reports, env) {
  const proof = new Map();
  for (const { name, report } of reports) {
    if (!/^[a-f0-9-]{36}$/i.test(report?.runId || '') || !report.owned || !Array.isArray(report.owned.uploads)) continue;
    for (const upload of report.owned.uploads) {
      const ref = parseStorageReference(upload?.url, env);
      if (!ref) continue;
      const id = objectId(ref.bucket, ref.path);
      const entry = proof.get(id) || [];
      entry.push({ type: 'owned-qa-upload-manifest', file: name, runId: report.runId });
      proof.set(id, entry);
    }
  }
  return proof;
}

/** Tracked provenance contains paths/ownership evidence only, never credentials.
 * It may exclude proven QA from backup; it never authorizes source deletion.
 */
export function validateTestProvenance(document) {
  const fail = () => { throw new Error('Invalid QA provenance manifest.'); };
  const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  if (!exactKeys(document, ['schemaVersion', 'purpose', 'generatedAt', 'objects']) || document.schemaVersion !== 1 || document.purpose !== PROVENANCE_PURPOSE || typeof document.generatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(document.generatedAt) || !Number.isFinite(Date.parse(document.generatedAt)) || !Array.isArray(document.objects) || document.objects.length > 10000) fail();
  const proof = new Map();
  const entries = new Set();
  for (const record of document.objects) {
    if (!exactKeys(record, ['bucket', 'path', 'runId', 'sourceReport']) || typeof record.bucket !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(record.bucket) || typeof record.path !== 'string' || !safeKey(record.path) || !record.path.split('/').every(part => /^[a-zA-Z0-9_.-]+$/.test(part)) || typeof record.runId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.runId)) fail();
    const allowedReports = [`test-results/production-regression-${record.runId}.json`, `test-results/browser-production-${record.runId}/report.json`, `test-results/ops-web-smoke-${record.runId}.json`];
    if (!allowedReports.includes(record.sourceReport)) fail();
    const id = objectId(record.bucket, record.path);
    const unique = `${id}\n${record.runId}\n${record.sourceReport}`;
    if (entries.has(unique)) fail();
    entries.add(unique);
    if (!proof.has(id)) proof.set(id, []);
    proof.get(id).push({ type: 'owned-qa-upload-manifest', file: record.sourceReport, runId: record.runId, provenance: 'tracked-backup-only-proof' });
  }
  return proof;
}

export function createTestProvenance(inventory) {
  const objects = [];
  const seen = new Set();
  for (const object of inventory.objects) for (const evidence of object.evidence) {
    if (evidence.type !== 'owned-qa-upload-manifest') continue;
    const record = { bucket: object.bucket, path: object.path, runId: evidence.runId, sourceReport: evidence.file };
    const unique = JSON.stringify(record);
    if (seen.has(unique)) continue;
    seen.add(unique); objects.push(record);
  }
  objects.sort((a, b) => `${a.bucket}/${a.path}/${a.sourceReport}`.localeCompare(`${b.bucket}/${b.path}/${b.sourceReport}`));
  const document = { schemaVersion: 1, purpose: PROVENANCE_PURPOSE, generatedAt: inventory.generatedAt, objects };
  validateTestProvenance(document);
  return document;
}

export function parseTestProvenanceBytes(raw) {
  try {
    const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
    if (bytes.length > PROVENANCE_MAX_BYTES) throw new Error();
    return validateTestProvenance(JSON.parse(bytes.toString('utf8')));
  } catch { throw new Error('Invalid QA provenance manifest.'); }
}

async function loadPersistentTestEvidence(file) {
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > PROVENANCE_MAX_BYTES) throw new Error('Invalid QA provenance manifest.');
    const raw = await readFile(file);
    return parseTestProvenanceBytes(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw new Error('Invalid QA provenance manifest.');
  }
}

async function loadTestEvidence(env, directory) {
  const reports = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  for (const entry of entries) {
    const file = entry.isFile() && /^(?:production-regression|ops-web-smoke)-[a-f0-9-]+\.json$/i.test(entry.name)
      ? path.join(directory, entry.name)
      : entry.isDirectory() && /^browser-production-[a-f0-9-]+$/i.test(entry.name) ? path.join(directory, entry.name, 'report.json') : null;
    if (!file) continue;
    try { reports.push({ name: file.replaceAll('\\', '/'), report: JSON.parse(await readFile(file, 'utf8')) }); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
  }
  return evidenceFromReports(reports, env);
}

/** Classify conservatively. Historical/intent references do not prove public use. */
export function classifyObjects(rawObjects, references, testProof, intents = []) {
  const proof = new Map([...testProof].map(([key, evidence]) => [key, [...evidence]]));
  const intentByObject = new Map();
  for (const intent of intents) {
    const source = objectId(intent.source_bucket, intent.source_key);
    const destination = objectId(intent.destination_bucket, intent.destination_key);
    for (const id of [source, destination]) {
      const existing = intentByObject.get(id) || [];
      existing.push({ table: 'storage_upload_intents', column: id === source ? 'source_key' : 'destination_key', rowId: intent.id, kind: 'operational', status: intent.status });
      intentByObject.set(id, existing);
    }
    // Exact recorded source/destination pair of a completed QA transfer proves
    // the quarantine copy's provenance. No name or size heuristic is used.
    if (intent.status === 'completed' && proof.has(destination)) proof.set(source, [...(proof.get(source) || []), { type: 'completed-qa-upload-intent', rowId: intent.id, destination: { bucket: intent.destination_bucket, path: intent.destination_key } }]);
  }
  const objects = rawObjects.map(raw => {
    const id = objectId(raw.bucket, raw.path);
    const refs = [...(references.get(id) || []), ...(intentByObject.get(id) || [])];
    const isReferenced = refs.some(ref => ref.kind === 'content');
    const provenTest = proof.has(id);
    const evidence = [...(proof.get(id) || [])];
    let category;
    if (isReferenced) category = 'A-production-referenced';
    else if (provenTest) category = 'B-proven-test';
    else if (/^(?:backups?|tmp|temp)\//i.test(raw.path)) {
      category = 'E-backup-temp-unconfirmed';
      evidence.push({ type: 'path-hint-only', note: 'Directory label does not prove disposability; preserve.' });
    } else if (refs.some(ref => ref.kind === 'historical')) category = 'C-orphan-historical';
    else category = 'F-unknown-unreferenced';
    return { ...raw, references: refs, isReferenced, hasAnyDbReference: refs.length > 0, provenTest, category, evidence, cleanupCandidate: provenTest && !isReferenced, duplicateGroup: null };
  });
  // ETag is an object-store validator, not a guaranteed content hash. Report
  // possible duplicates for review, and never exclude/delete based on it.
  const groups = new Map();
  for (const object of objects) {
    if (!object.etag || !object.size) continue;
    const fingerprint = `${object.size}:${object.etag}`;
    if (!groups.has(fingerprint)) groups.set(fingerprint, []);
    groups.get(fingerprint).push(object);
  }
  let groupId = 0;
  for (const group of groups.values()) if (group.length > 1) {
    const label = `metadata-duplicate-${++groupId}`;
    for (const object of group) object.duplicateGroup = label;
  }
  return objects;
}

export async function collectInventory(env, options = {}) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Inventory requires TLS verification.');
  const source = new URL(env.DATABASE_URL || env.SUPABASE_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || !/\.supabase\.(?:co|com)$/.test(source.hostname)) throw new Error('Inventory requires hosted Supabase PostgreSQL.');
  for (const name of ['host', 'hostaddr', 'port', 'user', 'password', 'database', 'dbname']) if (source.searchParams.has(name)) throw new Error('Inventory rejects database routing overrides.');
  let ca;
  if (env.DB_SSL_CA_BASE64) ca = Buffer.from(env.DB_SSL_CA_BASE64, 'base64').toString('utf8');
  else if (env.DB_SSL_CA_FILE) ca = await readFile(env.DB_SSL_CA_FILE, 'utf8');
  else throw new Error('Inventory requires verified database CA configuration.');
  for (const name of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) source.searchParams.delete(name);
  const pool = new pg.Pool({ connectionString: source.toString(), ssl: { ca, rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 15000, application_name: 'thd-ops-storage-inventory' });
  let client;
  try {
    client = await pool.connect();
    if (!client.connection.stream.encrypted || !client.connection.stream.authorized) throw new Error('Inventory TLS verification failed.');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '60s'");
    const tls = { mode: 'verify-full', authorized: true, protocol: client.connection.stream.getProtocol() };
    const buckets = (await client.query('SELECT id,name,public,file_size_limit,created_at,updated_at FROM storage.buckets ORDER BY id')).rows.map(row => ({ bucket: row.id, name: row.name, public: row.public, fileSizeLimit: row.file_size_limit === null ? null : Number(row.file_size_limit), createdAt: row.created_at, updatedAt: row.updated_at }));
    const rawObjects = (await client.query('SELECT bucket_id,name,metadata,created_at,updated_at,version FROM storage.objects ORDER BY bucket_id,name')).rows.map(row => ({ bucket: row.bucket_id, path: row.name, size: Number(row.metadata?.size || 0), sizeKnown: Number.isSafeInteger(Number(row.metadata?.size)) && Number(row.metadata?.size) >= 0, mime: row.metadata?.mimetype || null, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version, etag: row.metadata?.eTag || row.metadata?.etag || null }));
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
    const references = new Map();
    const appTables = [];
    const intents = [];
    let scannedCells = 0;
    for (const table of tables) {
      const rows = (await client.query(`SELECT to_jsonb(t) row FROM public.${quote(table)} t`)).rows;
      appTables.push({ table, rows: rows.length });
      for (const [index, record] of rows.entries()) {
        const row = record.row;
        if (table === 'storage_upload_intents') intents.push({ id: row.id, status: row.status, source_bucket: row.source_bucket, source_key: row.source_key, destination_bucket: row.destination_bucket, destination_key: row.destination_key });
        // Never persist raw rows, PII, session hashes, request bodies or secrets.
        const rowId = typeof row.id === 'number' || typeof row.id === 'string' && /^[a-f0-9-]{36}$/i.test(row.id) ? row.id : table === 'site_settings' ? String(row.key).slice(0, 120) : `row-${index + 1}`;
        for (const [column, value] of Object.entries(row)) {
          scannedCells++;
          for (const ref of extractStorageReferences(value, env)) {
            const id = objectId(ref.bucket, ref.path);
            if (!references.has(id)) references.set(id, []);
            references.get(id).push({ table, column, rowId, kind: table === 'audit_logs' ? 'historical' : table === 'storage_upload_intents' ? 'operational' : 'content' });
          }
        }
      }
    }
    await client.query('ROLLBACK');
    const testProof = options.testEvidence || await loadPersistentTestEvidence(options.provenanceFile || 'deploy/storage-qa-provenance.json');
    if (!options.testEvidence) {
      const localProof = await loadTestEvidence(env, options.evidenceDirectory || 'test-results');
      for (const [id, evidence] of localProof) {
        const merged = testProof.get(id) || [];
        for (const entry of evidence) if (!merged.some(existing => existing.file === entry.file && existing.runId === entry.runId)) merged.push(entry);
        testProof.set(id, merged);
      }
    }
    const objects = classifyObjects(rawObjects, references, testProof, intents);
    const objectIds = new Set(objects.map(object => objectId(object.bucket, object.path)));
    const missingReferences = [...references].filter(([id, refs]) => !objectIds.has(id) && refs.some(ref => ref.kind === 'content')).map(([id, refs]) => ({ bucket: id.split('\n')[0], path: id.split('\n')[1], references: refs }));
    const totalBytes = objects.reduce((sum, object) => sum + object.size, 0);
    const { limit: capacityBytes } = storageCapacityBudget(env);
    const cleanup = objects.filter(object => object.cleanupCandidate);
    const byCategory = {};
    for (const object of objects) {
      byCategory[object.category] ||= { objects: 0, bytes: 0 };
      byCategory[object.category].objects++; byCategory[object.category].bytes += object.size;
    }
    return {
      schemaVersion: 1, generatedAt: new Date().toISOString(), readOnly: true, tls, buckets, appTables, objects,
      summary: { objects: objects.length, totalBytes, totalMiB: totalBytes / MIB, capacityBytes, usagePercent: 100 * totalBytes / capacityBytes, level: storageCapacityLevel(totalBytes, capacityBytes), cleanupCandidates: cleanup.length, reclaimableBytes: cleanup.reduce((sum, object) => sum + object.size, 0), byCategory, duplicateGroups: new Set(objects.map(object => object.duplicateGroup).filter(Boolean)).size },
      coverage: { allBuckets: true, allStorageObjects: true, allPublicTables: true, scannedCells, contentReferenceCount: objects.filter(object => object.isReferenced).length, missingReferences, unknownSizes: objects.filter(object => !object.sizeKnown).length, testEvidenceAvailable: testProof.size > 0, historicalReferencesRetained: true, duplicateContentHashesVerified: false },
    };
  } finally {
    if (client) { await client.query('ROLLBACK').catch(() => undefined); client.release(); }
    await pool.end();
  }
}

export const gatherStorageInventory = collectInventory;

function markdown(value) { return String(value ?? '-').replaceAll('|', '\\|').replaceAll('\n', ' '); }
const mib = bytes => (bytes / MIB).toFixed(2);
const date = value => value ? new Date(value).toISOString() : '-';

export function renderInventoryReport(inventory) {
  const { summary, objects, coverage } = inventory;
  const candidates = objects.filter(object => object.cleanupCandidate);
  const references = object => object.references.map(ref => `${ref.table}.${ref.column} #${ref.rowId} (${ref.kind}${ref.status ? `/${ref.status}` : ''})`).join('; ') || 'none';
  const rows = list => list.map(object => `| ${markdown(object.bucket)} | ${markdown(object.path)} | ${markdown(object.category)} | ${object.size} | ${mib(object.size)} | ${date(object.createdAt)} | ${date(object.updatedAt)} | ${object.isReferenced ? 'yes' : 'no'} | ${markdown(references(object))} | ${markdown(object.evidence.map(item => item.type === 'owned-qa-upload-manifest' ? `${item.type}: ${item.file}` : item.type === 'completed-qa-upload-intent' ? `${item.type}: ${item.rowId}` : item.note || item.type).join('; '))} |`).join('\n');
  const header = '| Bucket | Path | Class | Bytes | MiB | Created UTC | Updated UTC | Current content ref | All DB references | Evidence |\n|---|---|---|---:|---:|---|---|---|---|---|';
  return `# Storage cleanup dry-run\n\nGenerated: ${inventory.generatedAt}. Read-only PostgreSQL snapshot; TLS ${inventory.tls.mode} / ${inventory.tls.protocol}. **No objects deleted, copied, or uploaded. No database mutation.**\n\n## Capacity\n\n- All ${inventory.buckets.length} buckets / ${summary.objects} objects: **${summary.totalBytes} bytes (${mib(summary.totalBytes)} MiB)**.\n- Configured allowance: ${summary.capacityBytes} bytes (${mib(summary.capacityBytes)} MiB); **${summary.usagePercent.toFixed(2)}% — ${summary.level.toUpperCase()}**. Object metadata totals are a snapshot; provider billing/quota accounting can lag or differ.\n- Warning >=70%; critical >=85%. At current usage, stop test uploads and review cleanup/backup before adding large content. Do not automatically delete to make room.\n- Proven QA files with no current content reference: **${candidates.length} objects / ${mib(summary.reclaimableBytes)} MiB estimated reclaim**. This estimate includes private quarantine copies and is not deletion approval.\n\n| Bucket | Public | Objects | MiB | File limit bytes |\n|---|---|---:|---:|---:|\n${inventory.buckets.map(bucket => { const bucketObjects = objects.filter(object => object.bucket === bucket.bucket); return `| ${bucket.bucket} | ${bucket.public} | ${bucketObjects.length} | ${mib(bucketObjects.reduce((sum, object) => sum + object.size, 0))} | ${bucket.fileSizeLimit ?? 'provider default'} |`; }).join('\n')}\n\n## Classification and safety rules\n\n| Class | Objects | MiB | Meaning |\n|---|---:|---:|---|\n${Object.entries(summary.byCategory).sort().map(([category, total]) => `| ${category} | ${total.objects} | ${mib(total.bytes)} | ${category.startsWith('A') ? 'Current content reference, including draft/archived rows; preserve' : category.startsWith('B') ? 'Exact QA upload manifest or completed intent pair; review candidate only' : category.startsWith('C') ? 'Detached from content; historical audit reference remains; preserve pending review' : category.startsWith('E') ? 'Backup/temp name hint only; preserve pending owner confirmation' : 'Unreferenced but provenance unproven; preserve'} |`).join('\n')}\n\n- A wins over QA provenance: a file currently used by any content row is preserved.\n- B requires exact manifest-owned upload URL, or the recorded completed-upload intent source paired with such a destination. Filename, timestamp, size, QA-looking directory, orphan status and ETag alone never prove test ownership.\n- C means no current content reference but a retained audit reference; it does not authorize deletion. Unexplained unreferenced files remain F (unknown).\n- D is an additional **possible duplicate** flag: ${summary.duplicateGroups} groups with matching size/ETag. ETags are not guaranteed content checksums; no duplicate deletion/reclaim is included.\n- E directory hints are unconfirmed; F unknown files must not be deleted. Unknown/orphan files remain eligible for backup.\n- Complete scan: ${inventory.appTables.length} public tables, ${coverage.scannedCells} cells, nested JSON/gallery/settings and URLs embedded in content, operational intents and retained audit details. Raw DB rows/PII/session values are not saved.\n- Missing current-content object references: ${coverage.missingReferences.length}; unknown object sizes: ${coverage.unknownSizes}.\n\n## Cleanup candidates — explicit approval required\n\n${header}\n${rows(candidates) || '| - | No proven safe candidates | - | - | - | - | - | - |'}\n\n## Preserved objects\n\nThe following are **not cleanup approvals**, even if unreferenced or possibly duplicated.\n\n${header}\n${rows(objects.filter(object => !object.cleanupCandidate))}\n\n## Possible duplicate metadata (not content-hash verified)\n\n| Group | Bucket/path | Current content reference | MiB |\n|---|---|---|---:|\n${objects.filter(object => object.duplicateGroup).map(object => `| ${object.duplicateGroup} | ${markdown(`${object.bucket}/${object.path}`)} | ${object.isReferenced ? 'yes' : 'no'} | ${mib(object.size)} |`).join('\n') || '| - | None | - | - |'}\n\n## Missing content references\n\n${coverage.missingReferences.length ? coverage.missingReferences.map(ref => `- ${markdown(`${ref.bucket}/${ref.path}`)}: ${markdown(ref.references.map(item => `${item.table}.${item.column} #${item.rowId}`).join('; '))}`).join('\n') : 'None in this snapshot.'}\n\n## Review and cleanup procedure\n\nTracked deploy/storage-qa-provenance.json preserves exact QA manifest evidence for cloud backup runs without ignored local reports. Its purpose is backup exclusion only, never deletion authorization. It is schema/size bounded, contains only bucket/path/run ID/source report provenance, and current content references always override exclusion.\n\n1. Finish independent encrypted DB/Storage backup and verification. Preserve the full ignored JSON snapshot.\n2. Obtain explicit approval of exact bucket/path list; review any current references or ownership uncertainty with the administrator.\n3. Re-run this read-only inventory immediately before approved cleanup. Reject entries with new current-content references, changed version/size/ETag or unclear proof.\n4. Delete only the approved immutable list with a separately reviewed tool; this script has **no delete mode**. Keep deletion evidence and backup manifest.\n5. Recheck usage and production media. Do not delete backups solely because their source disappeared.\n\nRe-run: set OPS_ENV_FILE to the ignored production environment file (or provide process env), then \`node scripts/ops-storage-inventory.mjs\`. Full private inventory is written under ignored \`deploy/data/ops/\`; this report contains paths/provenance only and no credentials.\n`;
}

async function main() {
  try {
    const env = { ...(process.env.OPS_ENV_FILE ? dotenv.parse(await readFile(process.env.OPS_ENV_FILE)) : {}), ...process.env };
    const inventory = await collectInventory(env);
    await mkdir('deploy/data/ops', { recursive: true });
    const jsonFile = 'deploy/data/ops/storage-inventory.json';
    const reportFile = 'deploy/STORAGE-CLEANUP-REPORT.md';
    await writeFile(jsonFile, JSON.stringify(inventory, null, 2));
    await writeFile(reportFile, renderInventoryReport(inventory));
    console.log(JSON.stringify({ result: 'PASS', readOnly: true, ...inventory.summary, report: reportFile, inventory: jsonFile, deleted: 0 }));
  } catch {
    console.error('Storage inventory failed; connection and credential details suppressed.'); process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
