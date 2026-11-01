// Explicit fresh local fixture only. Never reads .env.local or a hosted target.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import dotenv from 'dotenv';
import {Pool} from 'pg';
import {migrateSchema,SCHEMA_VERSION} from '../scripts/schema.mjs';
import {assertReleasePreserved,releaseSnapshot} from '../scripts/feature-release-migration.mjs';

const TABLES=['library_items','library_comments','library_likes','library_views','borrow_requests','news_posts','wall_banners','site_settings','admin_sessions','admin_login_attempts','audit_logs','storage_upload_intents'];
const quote=value=>`"${value.replaceAll('"','""')}"`;
let sourcePool,targetPool;
let phase='config';
try {
  const file=process.env.FEATURE_TEST_ENV_FILE;
  if(!file)throw new Error('Explicit isolated local environment required');
  const env=dotenv.parse(await readFile(file));
  const source=new URL(env.DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(source.protocol)||!['localhost','127.0.0.1','[::1]'].includes(source.hostname)||!/^\/thd_feature_[a-z0-9]+$/.test(source.pathname))throw new Error('Refusing non-isolated database');
  for(const name of ['host','hostaddr','port','user','password','dbname','database','service'])if(source.searchParams.has(name))throw new Error('Refusing database routing override');
  const oldSchema=await import(pathToFileURL(path.resolve('deploy/data/runtime/schema-checkpoint2.mjs')).href);
  assert.equal(oldSchema.SCHEMA_VERSION,2);
  const name=`thd_feature_upgrade${randomUUID().replaceAll('-','')}`;
  assert.match(name,/^thd_feature_[a-z0-9]+$/);
  sourcePool=new Pool({connectionString:source.toString(),max:1,connectionTimeoutMillis:5000});
  phase='create-isolated-database';
  await sourcePool.query(`CREATE DATABASE ${quote(name)}`);
  await sourcePool.end();sourcePool=undefined;
  const target=new URL(source);target.pathname=`/${name}`;
  targetPool=new Pool({connectionString:target.toString(),max:1,connectionTimeoutMillis:5000});
  phase='checkpoint-v2';
  await oldSchema.migrateSchema(targetPool);
  assert.equal(Number((await targetPool.query('SELECT MAX(version) version FROM thd_schema_migrations')).rows[0].version),2);

  phase='seed-local-fixture';
  await targetPool.query(`INSERT INTO library_items(id,title,author,type,category,class_level,format,cover_url,file_url,gallery_urls,description,stock,views,likes,is_featured,status,published_at,created_at,updated_at)
    VALUES(403,'Fixture Ngữ văn lớp 12','Tác giả fixture','sach-giay','Ôn thi','12','Sách giấy','/uploads/fixture-cover.png',NULL,'[]','Nội dung giả trên database cô lập',0,1,1,false,'published','2025-01-02T00:00:00Z','2025-01-01T00:00:00Z','2025-01-02T00:00:00Z')`);
  await targetPool.query(`INSERT INTO borrow_requests(id,item_id,visitor_id,borrower_name,class_name,phone,email,note,status,approved_at,created_at,updated_at)
    VALUES(901,403,'fixturevisitor00001','Người mượn fixture','12A','','','Fixture không phải dữ liệu thật','approved','2025-02-02T00:00:00Z','2025-02-01T00:00:00Z','2025-02-02T00:00:00Z')`);
  await targetPool.query(`INSERT INTO library_comments(id,item_id,visitor_id,name,content,status) VALUES(701,403,'fixturevisitor00001','Fixture','Bình luận fixture','approved')`);
  await targetPool.query(`INSERT INTO library_likes(item_id,visitor_id) VALUES(403,'fixturevisitor00001')`);
  await targetPool.query(`INSERT INTO library_views(item_id,visitor_id,view_day) VALUES(403,'fixturevisitor00001','2025-02-01')`);
  await targetPool.query(`INSERT INTO news_posts(id,title,slug,excerpt,content,status) VALUES(801,'Tin fixture','tin-fixture','Fixture','Nội dung fixture','published')`);
  await targetPool.query(`INSERT INTO wall_banners(id,title,image_url,link_url) VALUES(601,'Banner fixture','/uploads/fixture-banner.png','/tin-tuc')`);
  await targetPool.query(`INSERT INTO site_settings(key,value) VALUES('fixture_setting','{"enabled":true}'::jsonb)`);
  await targetPool.query(`INSERT INTO admin_sessions(token_hash,username,expires_at) VALUES($1,'fixture-admin','2035-01-01T00:00:00Z')`,['a'.repeat(64)]);
  await targetPool.query(`INSERT INTO admin_login_attempts(ip_address,username,success) VALUES('fixture-only','fixture-admin',true)`);
  await targetPool.query(`INSERT INTO audit_logs(username,action,entity_type,entity_id,details) VALUES('fixture-admin','fixture','library_item','403','{"fixture":true}')`);
  await targetPool.query(`INSERT INTO storage_upload_intents(id,owner_token_hash,username,kind,document_type,original_name,expected_size,expected_mime,source_bucket,source_key,destination_bucket,destination_key,expires_at)
    VALUES('cbe50000-0000-4000-8000-000000000001',$1,'fixture-admin','document','sach-dien-tu','fixture.pdf',1024,'application/pdf','fixture-private','fixture/source.pdf','fixture-public','fixture/destination.pdf','2035-01-01T00:00:00Z')`,['b'.repeat(64)]);

  const initialColumns=(await targetPool.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position`,[TABLES])).rows;
  const columns=Object.fromEntries(TABLES.map(table=>[table,initialColumns.filter(row=>row.table_name===table).map(row=>row.column_name)]));
  const initial=await releaseSnapshot(targetPool,columns);
  const hooks=[];
  let expectedFailure=true;
  let before;
  const options={
    beforeMigration:async client=>{
      hooks.push('before');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query(`LOCK TABLE ${TABLES.map(table=>'public.'+quote(table)).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
      before=await releaseSnapshot(client,columns);
      assertReleasePreserved(initial,before);
    },
    afterMigration:async client=>{
      hooks.push('after');
      assertReleasePreserved(before,await releaseSnapshot(client,columns));
      if(expectedFailure)throw new Error('EXPECTED_ISOLATED_POST_VALIDATION_ABORT');
    },
  };
  phase='post-validation-rollback';
  await assert.rejects(migrateSchema(targetPool,options),/EXPECTED_ISOLATED_POST_VALIDATION_ABORT/);
  assert.equal(Number((await targetPool.query('SELECT MAX(version) version FROM thd_schema_migrations')).rows[0].version),2);
  assert.equal((await targetPool.query("SELECT to_regclass('public.library_subjects') table_name")).rows[0].table_name,null);
  assert.equal((await targetPool.query("SELECT COUNT(*)::int count FROM information_schema.columns WHERE table_schema='public' AND table_name='borrow_requests' AND column_name='request_code'")).rows[0].count,0);
  assertReleasePreserved(initial,await releaseSnapshot(targetPool,columns));

  phase='upgrade-v2-to-current';
  expectedFailure=false;
  await migrateSchema(targetPool,options);
  assert.deepEqual(hooks,['before','after','before','after']);
  assertReleasePreserved(initial,await releaseSnapshot(targetPool,columns));
  await migrateSchema(targetPool,{beforeMigration:async()=>assert.fail('Replay called before hook'),afterMigration:async()=>assert.fail('Replay called after hook')});
  assert.equal(Number((await targetPool.query('SELECT MAX(version) version FROM thd_schema_migrations')).rows[0].version),SCHEMA_VERSION);

  phase='indexes-defaults-and-legacy-writer';
  const indexes=(await targetPool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public'")).rows.map(row=>row.indexname);
  for(const name of ['idx_library_search_trigram','idx_library_items_topics','idx_collection_items_order','idx_borrow_request_code','idx_borrow_due'])assert.ok(indexes.includes(name));
  assert.equal((await targetPool.query("SELECT public.thd_search_normalize('Ngữ văn Địa lí') value")).rows[0].value,'ngu van dia li');
  const legacy=(await targetPool.query('SELECT b.request_code,b.requested_at,b.created_at,b.status,i.stock,b.borrowed_at,b.due_at FROM borrow_requests b JOIN library_items i ON i.id=b.item_id WHERE b.id=901')).rows[0];
  assert.match(legacy.request_code,/^BR-[A-F0-9]{18}$/);assert.equal(legacy.requested_at.toISOString(),legacy.created_at.toISOString());assert.equal(legacy.status,'approved');assert.equal(legacy.stock,0);assert.equal(legacy.borrowed_at,null);assert.equal(legacy.due_at,null);
  assert.equal(Number((await targetPool.query("SELECT COUNT(*) count FROM borrow_events WHERE request_id=901 AND from_status IS NULL AND to_status='approved' AND actor='migration'")).rows[0].count),1);
  const inserted=(await targetPool.query(`INSERT INTO borrow_requests(item_id,borrower_name,status) VALUES(403,'Old writer fixture','pending') RETURNING request_code,requested_at`)).rows[0];
  assert.match(inserted.request_code,/^BR-[A-F0-9]{18}$/);assert.ok(inserted.requested_at instanceof Date);assert.notEqual(inserted.request_code,legacy.request_code);
  const tables=['library_subjects','library_collections','library_collection_items','library_search_daily','borrow_events'];
  const rls=(await targetPool.query('SELECT relname,relrowsecurity FROM pg_class WHERE relname=ANY($1::text[]) AND relnamespace=\'public\'::regnamespace',[tables])).rows;
  assert.equal(rls.length,tables.length);assert.ok(rls.every(row=>row.relrowsecurity));
  const constraints=(await targetPool.query("SELECT contype,convalidated FROM pg_constraint WHERE conrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)")).rows;
  assert.ok(constraints.some(row=>row.contype==='f'));assert.ok(constraints.every(row=>row.convalidated));
  const result={result:'PASS',database:name,retained:true,sourceVersion:2,targetVersion:SCHEMA_VERSION,
    baselineCounts:Object.fromEntries(Object.entries(initial).map(([table,row])=>[table,Number(row.count)])),
    sameTransactionHooks:true,postValidationRollback:true,oldColumnsPreserved:true,replay:true,legacyWriterDefault:true,indexes:true,constraints:true,rls:true,productionConnection:false,storageWrites:false};
  if(process.env.FEATURE_UPGRADE_REPORT)await writeFile(process.env.FEATURE_UPGRADE_REPORT,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} catch(error) {
  console.error(JSON.stringify({result:'FAIL',phase,code:typeof error.code==='string'?error.code:'ISOLATED_UPGRADE_ASSERTION_FAILED',privateDetailsSuppressed:true,productionConnection:false}));
  process.exitCode=1;
} finally {await sourcePool?.end();await targetPool?.end();}
