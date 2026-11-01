const test = require('node:test');
const assert = require('node:assert/strict');
const loader = require('./load-project.cjs');

test('upload admission counts all buckets, pending source/copy reservations, headroom and unknown sizes', async () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, STORAGE_CAPACITY_LIMIT_BYTES: process.env.STORAGE_CAPACITY_LIMIT_BYTES, STORAGE_CAPACITY_HEADROOM_BYTES: process.env.STORAGE_CAPACITY_HEADROOM_BYTES };
  Object.assign(process.env, { NODE_ENV: 'production', STORAGE_CAPACITY_LIMIT_BYTES: '1000', STORAGE_CAPACITY_HEADROOM_BYTES: '20' });
  let row = { used: '700', reserved: '100', unknown: '0' }; let calls = 0;
  const connection = { query: async sql => { calls++; assert.match(sql, /FROM storage.objects/); assert.match(sql, /status='pending'/); assert.doesNotMatch(sql, /DELETE|INSERT|UPDATE/); return { rows: [row] }; } };
  const capacity = loader({ 'server-only': {}, '@/lib/db': { db: connection } })('src/lib/storage-capacity.ts');
  try {
    assert.equal(await capacity.storageCapacityAvailable(180), true);
    assert.equal(await capacity.storageCapacityAvailable(181), false);
    row = { used: '700', reserved: '100', unknown: '1' }; assert.equal(await capacity.storageCapacityAvailable(1), false);
    row = { used: 'NaN', reserved: '0', unknown: '0' }; await assert.rejects(capacity.storageCapacityAvailable(1), /unavailable/);
    process.env.STORAGE_CAPACITY_LIMIT_BYTES = '-1'; await assert.rejects(capacity.storageCapacityAvailable(1), /Invalid/);
    delete process.env.STORAGE_CAPACITY_LIMIT_BYTES; process.env.NODE_ENV = 'development'; const before = calls;
    assert.equal(await capacity.storageCapacityAvailable(1), true); assert.equal(calls, before);
  } finally { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
});

test('small cloud uploads refuse insufficient capacity before sending any file to Storage', async () => {
  let uploaded = false;
  const previous = process.env.STORAGE_DRIVER; process.env.STORAGE_DRIVER = 'supabase';
  const storage = loader({ 'server-only': {}, '@/lib/storage-capacity': { storageCapacityAvailable: async () => false, storageFullMessage: 'Storage không đủ dung lượng.' }, '@supabase/supabase-js': { createClient: () => { uploaded = true; throw new Error('Must not contact Storage'); } } })('src/lib/upload-storage.ts');
  try {
    await assert.rejects(storage.storeUpload(new File(['%PDF-1.7 fixture'], 'book.pdf', { type: 'application/pdf' }), 'document'), error => error.status === 507);
    assert.equal(uploaded, false);
  } finally { if (previous === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = previous; }
});
