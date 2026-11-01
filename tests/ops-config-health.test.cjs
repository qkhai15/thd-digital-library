const test = require('node:test');
const assert = require('node:assert/strict');

test('storage thresholds distinguish normal, exact warning and critical using configurable byte budget', async () => {
  const { storageCapacityBudget, storageCapacityLevel } = await import('../scripts/storage-capacity-policy.mjs');
  assert.equal(storageCapacityLevel(699,1000),'normal'); assert.equal(storageCapacityLevel(700,1000),'warning');
  assert.equal(storageCapacityLevel(849,1000),'warning'); assert.equal(storageCapacityLevel(850,1000),'critical'); assert.equal(storageCapacityLevel(1100,1000),'critical');
  assert.deepEqual(storageCapacityBudget({STORAGE_CAPACITY_LIMIT_BYTES:'2000',STORAGE_CAPACITY_HEADROOM_BYTES:'20'}),{limit:2000,headroom:20});
  assert.throws(()=>storageCapacityBudget({STORAGE_CAPACITY_LIMIT_BYTES:'invalid'})); assert.throws(()=>storageCapacityBudget({STORAGE_CAPACITY_LIMIT_BYTES:'10',STORAGE_CAPACITY_HEADROOM_BYTES:'10'}));
});

test('backup provider missing and invalid config are separate from application failure, never echo private values', async () => {
  const { checkBackupProviderConfig, backupVariableNames } = await import('../scripts/ops-provider-config.mjs');
  assert.equal(checkBackupProviderConfig({}).status,'MISSING_CONFIG');
  const env = Object.fromEntries(backupVariableNames.map(name=>[name,'private-fixture']));
  assert.equal(checkBackupProviderConfig(env).status,'INVALID_CONFIG'); assert.ok(!JSON.stringify(checkBackupProviderConfig(env)).includes('private-fixture'));
  Object.assign(env,{BACKUP_S3_ENDPOINT:'https://example.r2.cloudflarestorage.com',BACKUP_S3_REGION:'auto',BACKUP_S3_BUCKET:'backup-fixture',BACKUP_ENCRYPTION_KEY:require('node:crypto').randomBytes(32).toString('base64')});
  const result=checkBackupProviderConfig(env); assert.equal(result.status,'READY'); assert.equal(result.externalBackupVerified,false);
});

test('operations health checks official GET targets only and refuses essential failures or extra secret fields', async () => {
  const { checkOperationsHealth } = await import('../scripts/ops-health.mjs');
  const seen=[];
  const healthy=async (url,options)=>{seen.push(url);assert.equal(options.method,'GET');return url.endsWith('/api/health') ? Response.json({ok:true,database:'connected',time:'2026-10-16'}) : new Response('<html>homepage</html>');};
  assert.equal((await checkOperationsHealth(healthy)).result,'PASS');assert.equal(seen.length,2);assert.ok(seen.every(url=>url.startsWith('https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn/')));
  await assert.rejects(checkOperationsHealth(async()=>new Response('',{status:500})),/non-200/);
  await assert.rejects(checkOperationsHealth(async url=>url.endsWith('/api/health') ? Response.json({ok:false,database:'error'}) : new Response('home')),/invalid/);
  await assert.rejects(checkOperationsHealth(async url=>url.endsWith('/api/health') ? Response.json({ok:true,database:'connected',DATABASE_URL:'secret-fixture'}) : new Response('home')),/invalid/);
});
