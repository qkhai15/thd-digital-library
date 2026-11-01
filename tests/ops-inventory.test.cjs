const test = require('node:test');
const assert = require('node:assert/strict');
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_STORAGE_BUCKET: 'library', APP_ORIGIN: 'https://library.example.edu.vn', PUBLIC_ORIGINS: 'https://old.example.edu.vn' };
const load = () => import('../scripts/ops-storage-inventory.mjs');

test('inventory resolves known legacy/storage URLs and strips signed query secrets', async () => {
  const { parseStorageReference, extractStorageReferences } = await load();
  assert.deepEqual(parseStorageReference('/uploads/supabase/covers/one.png?download=1', env), { bucket: 'library', path: 'covers/one.png' });
  assert.deepEqual(parseStorageReference('https://old.example.edu.vn/uploads/documents/a.pdf', env), { bucket: 'library', path: 'documents/a.pdf' });
  assert.deepEqual(parseStorageReference('https://example.supabase.co/storage/v1/object/sign/private/key.pdf?token=secret', env), { bucket: 'private', path: 'key.pdf' });
  assert.equal(parseStorageReference('https://untrusted.example/uploads/covers/a.png', env), null);
  assert.equal(parseStorageReference('/uploads/supabase/a/%2e%2e/b', env), null);
  assert.equal(parseStorageReference('/uploads/%5csecret', env), null);
  assert.deepEqual(extractStorageReferences({ gallery: ['/uploads/gallery/1.png'], content: '<img src="https://example.supabase.co/storage/v1/object/public/library/news/a.jpg">' }, env), [{ bucket: 'library', path: 'gallery/1.png' }, { bucket: 'library', path: 'news/a.jpg' }]);
});

test('QA ownership requires exact manifest upload, current content always preserved', async () => {
  const { evidenceFromReports, classifyObjects } = await load();
  const reports = [{ name: 'report.json', report: { runId: '12345678-1234-1234-1234-123456789012', owned: { uploads: [{ url: '/uploads/supabase/covers/test.png' }, { url: '/uploads/supabase/covers/used.png' }] } } }];
  const evidence = evidenceFromReports(reports, env);
  const refs = new Map([['library\ncovers/used.png', [{ table: 'library_items', column: 'cover_url', rowId: 3, kind: 'content' }]]]);
  const objects = classifyObjects(['test', 'used', 'qa-name-only'].map(name => ({ bucket: 'library', path: `covers/${name}.png`, size: 1 })), refs, evidence);
  assert.equal(objects[0].category, 'B-proven-test'); assert.equal(objects[0].cleanupCandidate, true);
  assert.equal(objects[1].category, 'A-production-referenced'); assert.equal(objects[1].cleanupCandidate, false); assert.equal(objects[1].provenTest, true);
  assert.equal(objects[2].category, 'F-unknown-unreferenced'); assert.equal(objects[2].cleanupCandidate, false);
});

test('completed QA intent proves exact quarantine pair; pending intent and duplicate hints do not', async () => {
  const { classifyObjects } = await load();
  const proof = new Map([['library\nvideos/a.mp4', [{ type: 'owned-qa-upload-manifest' }]]]);
  const intents = [
    { id: 'a', status: 'completed', source_bucket: 'quarantine', source_key: 'in/a.mp4', destination_bucket: 'library', destination_key: 'videos/a.mp4' },
    { id: 'b', status: 'pending', source_bucket: 'quarantine', source_key: 'in/b.mp4', destination_bucket: 'library', destination_key: 'videos/a.mp4' },
  ];
  const objects = classifyObjects([
    { bucket: 'quarantine', path: 'in/a.mp4', size: 5, etag: 'same' },
    { bucket: 'quarantine', path: 'in/b.mp4', size: 5, etag: 'same' },
    { bucket: 'library', path: 'temp/keep.pdf', size: 2 },
    { bucket: 'library', path: 'old.pdf', size: 3 },
  ], new Map([['library\nold.pdf', [{ table: 'audit_logs', column: 'details', rowId: 2, kind: 'historical' }]]]), proof, intents);
  assert.equal(objects[0].cleanupCandidate, true); assert.equal(objects[0].hasAnyDbReference, true);
  assert.equal(objects[1].cleanupCandidate, false); assert.equal(objects[0].duplicateGroup, objects[1].duplicateGroup);
  assert.equal(objects[2].category, 'E-backup-temp-unconfirmed'); assert.equal(objects[2].cleanupCandidate, false);
  assert.equal(objects[3].category, 'C-orphan-historical'); assert.equal(objects[3].cleanupCandidate, false);
});

test('unproven or malformed reports cannot prove ownership', async () => {
  const { evidenceFromReports } = await load();
  const reports = [{ name: 'a', report: { runId: 'invalid', owned: { uploads: [{ url: '/uploads/secret.png' }] } } }, { name: 'b', report: { runId: '12345678-1234-1234-1234-123456789012', uploads: [{ url: '/uploads/secret.png' }] } }];
  assert.equal(evidenceFromReports(reports, env).size, 0);
});

test('tiny Operations smoke uploads retain exact provenance without authorizing deletion', async () => {
  const { createTestProvenance, validateTestProvenance } = await load();
  const runId='102b9148-3245-442c-80d7-da1a31557508';
  const document=createTestProvenance({generatedAt:'2026-10-16T01:11:08.000Z',objects:[{bucket:'library',path:'covers/owned.png',evidence:[{type:'owned-qa-upload-manifest',runId,file:`test-results/ops-web-smoke-${runId}.json`}]}]});
  assert.match(document.purpose,/not-deletion/);assert.equal(validateTestProvenance(document).size,1);
});

test('tracked QA provenance validates exact backup-only schema and content references still win', async () => {
  const { createTestProvenance, validateTestProvenance, classifyObjects } = await load();
  const runId = '12345678-1234-1234-1234-123456789012';
  const snapshot = { generatedAt: '2026-10-15T00:00:00.000Z', objects: [{ bucket: 'library', path: 'covers/a.png', evidence: [{ type: 'owned-qa-upload-manifest', runId, file: `test-results/production-regression-${runId}.json` }] }] };
  const document = createTestProvenance(snapshot);
  const proof = validateTestProvenance(document);
  assert.equal(proof.size, 1);
  assert.deepEqual(Object.keys(document.objects[0]), ['bucket', 'path', 'runId', 'sourceReport']);
  const refs = new Map([['library\ncovers/a.png', [{ table: 'news_posts', column: 'cover_url', rowId: 5, kind: 'content' }]]]);
  const [object] = classifyObjects([{ bucket: 'library', path: 'covers/a.png', size: 10 }], refs, proof);
  assert.equal(object.isReferenced, true); assert.equal(object.cleanupCandidate, false); assert.equal(object.category, 'A-production-referenced');
});

test('tracked QA provenance rejects deletion purpose, extra fields, unsafe paths and unrelated report IDs', async () => {
  const { validateTestProvenance } = await load();
  const runId = '12345678-1234-1234-1234-123456789012';
  const document = { schemaVersion: 1, purpose: 'backup-exclusion-only-not-deletion-authorization', generatedAt: '2026-10-15T00:00:00.000Z', objects: [{ bucket: 'library', path: 'a.pdf', runId, sourceReport: `test-results/browser-production-${runId}/report.json` }] };
  const changes = [
    draft => { draft.purpose = 'delete-authorized'; },
    draft => { draft.secret = 'not-allowed'; },
    draft => { draft.objects[0].token = 'not-allowed'; },
    draft => { draft.objects[0].path = '../private'; },
    draft => { draft.objects[0].sourceReport = 'test-results/unrelated.json'; },
    draft => { draft.objects.push(draft.objects[0]); },
    draft => { draft.objects[0].bucket = 12; },
  ];
  for (const mutate of changes) {
    const draft = structuredClone(document); mutate(draft);
    assert.throws(() => validateTestProvenance(draft), /Invalid QA provenance manifest/);
  }
});

test('tracked QA provenance rejects oversized bytes and malformed JSON without logging payload', async () => {
  const { parseTestProvenanceBytes } = await load();
  assert.throws(() => parseTestProvenanceBytes(Buffer.alloc(2 * 1024 ** 2 + 1)), /^Error: Invalid QA provenance manifest\.$/);
  assert.throws(() => parseTestProvenanceBytes('{"secret":"must-not-appear"'), /^Error: Invalid QA provenance manifest\.$/);
});
