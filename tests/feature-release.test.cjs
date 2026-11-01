const test=require('node:test');const assert=require('node:assert/strict');
test('release invariants detect old data changes and snapshot selects only captured columns',async()=>{
 const {releaseSnapshot,assertReleasePreserved}=await import('../scripts/feature-release-migration.mjs');
 const columns=Object.fromEntries(['library_items','library_comments','library_likes','library_views','borrow_requests','news_posts','wall_banners','site_settings','admin_sessions','admin_login_attempts','audit_logs','storage_upload_intents'].map(table=>[table,['id','status']]));
 const calls=[];const snapshot=await releaseSnapshot({query:async sql=>{calls.push(sql);return {rows:[{count:'3',digest:'checksum'}]};}},columns);
 assert.equal(calls.length,12);assert.ok(calls.every(sql=>sql.includes('SELECT "id","status"')));assert.ok(calls.every(sql=>sql.includes('COLLATE "C"')));assertReleasePreserved(snapshot,structuredClone(snapshot));
 const changed=structuredClone(snapshot);changed.library_items.digest='changed';assert.throws(()=>assertReleasePreserved(snapshot,changed),/OLD_DATA_CHANGED/);
});
