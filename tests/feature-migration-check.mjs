// Explicit, isolated local database only. This runner never reads .env.local.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import {Pool} from 'pg';
import {migrateSchema,SCHEMA_VERSION} from '../scripts/schema.mjs';
const file=process.env.FEATURE_TEST_ENV_FILE;
if(!file)throw new Error('FEATURE_TEST_ENV_FILE must select an isolated local database.');
const env=dotenv.parse(await readFile(file));const url=new URL(env.DATABASE_URL);
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^\/thd_feature_[a-z0-9]+$/.test(url.pathname))throw new Error('Refusing migration outside isolated local feature database.');
const pool=new Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:5000});
const tables=['library_items','library_comments','library_likes','library_views','borrow_requests','wall_banners','news_posts','admin_sessions','admin_login_attempts','audit_logs','site_settings','storage_upload_intents'];
const oldItemFields='id,title,author,type,category,class_level,format,cover_url,file_url,gallery_urls,description,stock,views,likes,is_featured,status,published_at,created_at,updated_at';
const oldBorrowFields='id,item_id,visitor_id,borrower_name,class_name,phone,email,note,status,approved_at,returned_at,created_at,updated_at';
async function snapshot(){
 const counts={};
 for(const table of tables)counts[table]=Number((await pool.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count);
 const items=(await pool.query(`SELECT ${oldItemFields} FROM library_items ORDER BY id`)).rows;
 const borrows=(await pool.query(`SELECT ${oldBorrowFields} FROM borrow_requests ORDER BY id`)).rows;
 return {counts,items,borrows};
}
try{
 const before=await snapshot();await migrateSchema(pool);const after=await snapshot();assert.deepEqual(after,before);
 await migrateSchema(pool);assert.deepEqual(await snapshot(),before);
 const indexes=(await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).rows.map(row=>row.indexname);
 for(const name of ['idx_library_search_trigram','idx_library_items_topics','idx_collection_items_order','idx_borrow_request_code','idx_borrow_due'])assert.ok(indexes.includes(name),name);
 const version=Number((await pool.query('SELECT MAX(version) AS version FROM thd_schema_migrations')).rows[0].version);assert.equal(version,SCHEMA_VERSION);
 const normalized=(await pool.query("SELECT public.thd_search_normalize('Ngữ văn Địa lí') AS value")).rows[0].value;assert.equal(normalized,'ngu van dia li');
 const rls=(await pool.query(`SELECT relname,relrowsecurity FROM pg_class WHERE oid IN('library_subjects'::regclass,'library_collections'::regclass,'library_collection_items'::regclass,'library_search_daily'::regclass,'borrow_events'::regclass)`)).rows;assert.ok(rls.every(row=>row.relrowsecurity));
 const result={result:'PASS',schemaVersion:version,counts:before.counts,oldItemFieldsPreserved:true,oldBorrowFieldsPreserved:true,replay:true,indexes:true,rls:true,vietnameseNormalization:true,productionConnection:false};
 if(process.env.FEATURE_MIGRATION_REPORT)await writeFile(process.env.FEATURE_MIGRATION_REPORT,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({result:'FAIL',code:typeof error.code==='string'?error.code:'MIGRATION_ASSERTION_FAILED',privateDetailsSuppressed:true}));process.exitCode=1;}finally{await pool.end();}
