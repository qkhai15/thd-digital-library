import {Pool} from 'pg';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {migrateSchema,SCHEMA_VERSION} from './schema.mjs';
import {databaseEnvironment,ensure} from './ops-backup/core.mjs';

const TABLES=['library_items','library_comments','library_likes','library_views','borrow_requests','news_posts','wall_banners','site_settings','admin_sessions','admin_login_attempts','audit_logs','storage_upload_intents'];
const quote=value=>`"${value.replaceAll('"','""')}"`;
export async function releaseSnapshot(client,columns){
  const output={};
  for(const table of TABLES){
    const fields=columns[table].map(quote).join(',');
    const result=await client.query(`SELECT COUNT(*)::text count,md5(COALESCE(string_agg(value,E'\\n' ORDER BY value COLLATE "C"),'')) digest
      FROM (SELECT to_jsonb(old_row)::text value FROM (SELECT ${fields} FROM public.${quote(table)}) old_row) rows`);
    output[table]=result.rows[0];
  }
  return output;
}
export function assertReleasePreserved(before,after){ensure(JSON.stringify(before)===JSON.stringify(after),'FEATURE_MIGRATION_OLD_DATA_CHANGED');}
export async function migrateFeatureRelease(env,{apply=false}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),'thd-feature-release-'));let pool;
  try{
    const {connectionString}=await databaseEnvironment(env,directory);
    pool=new Pool({connectionString,max:1,connectionTimeoutMillis:15000,application_name:'thd-feature-release'});
    const preflight=await pool.connect();let source;
    try{ensure(preflight.connection.stream.encrypted&&preflight.connection.stream.authorized,'FEATURE_MIGRATION_TLS_REQUIRED');source=Number((await preflight.query('SELECT MAX(version) version FROM thd_schema_migrations')).rows[0].version);}finally{preflight.release();}
    ensure([2,3,4,5].includes(source),'FEATURE_MIGRATION_UNEXPECTED_SOURCE_VERSION');
    if(!apply)return {result:'PLAN',sourceVersion:source,targetVersion:SCHEMA_VERSION,productionWrites:false};
    const proof=JSON.parse(await readFile(env.FEATURE_BACKUP_VERIFICATION_FILE,'utf8'));
    ensure(proof.result==='PASS'&&Date.now()-Date.parse(proof.createdAt)<24*3600000&&Date.parse(proof.createdAt)<=Date.now(),'FEATURE_MIGRATION_FRESH_BACKUP_REQUIRED');
    ensure(proof.results?.some(result=>result.kind==='db'&&result.ciphertextChecksums==='PASS'&&result.authenticatedDecryption==='PASS'&&result.plaintextChecksums==='PASS'&&result.realIsolatedRestore==='PASS'&&result.recoveryKeyPersisted===true),'FEATURE_MIGRATION_VERIFIED_RECOVERY_REQUIRED');
    ensure((await readFile(proof.recoveryKeyFile)).length>0,'FEATURE_MIGRATION_RECOVERY_KEY_REQUIRED');
    let before,columns;
    await migrateSchema(pool,{
      beforeMigration:async client=>{
        await client.query("SET LOCAL lock_timeout='15s'");await client.query("SET LOCAL statement_timeout='90s'");
        // Briefly serialize writes while comparing exactly the pre-release
        // columns. SELECT browsing remains available; no old data is rewritten.
        await client.query(`LOCK TABLE ${TABLES.map(table=>'public.'+quote(table)).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
        const result=await client.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position`,[TABLES]);
        columns=Object.fromEntries(TABLES.map(table=>[table,result.rows.filter(row=>row.table_name===table).map(row=>row.column_name)]));
        ensure(TABLES.every(table=>columns[table].length>0),'FEATURE_MIGRATION_SOURCE_INCOMPLETE');
        before=await releaseSnapshot(client,columns);
      },
      afterMigration:async client=>assertReleasePreserved(before,await releaseSnapshot(client,columns)),
    });
    // A second call proves the migration framework's current-version no-op.
    await migrateSchema(pool);
    const version=Number((await pool.query('SELECT MAX(version) version FROM thd_schema_migrations')).rows[0].version);ensure(version===SCHEMA_VERSION,'FEATURE_MIGRATION_VERSION_FAILED');
    const report={result:'PASS',sourceVersion:source,targetVersion:version,oldRowsPreserved:true,oldFieldsPreserved:true,replay:true,tls:'verify-full',counts:before?Object.fromEntries(Object.entries(before).map(([table,row])=>[table,Number(row.count)])):null,alreadyApplied:source===version,storageWrites:false};
    if(env.FEATURE_MIGRATION_REPORT)await writeFile(env.FEATURE_MIGRATION_REPORT,JSON.stringify({...report,verifiedAt:new Date().toISOString()},null,2));return report;
  }finally{
    await pool?.end();
    ensure(path.dirname(path.resolve(directory))===path.resolve(os.tmpdir())&&path.basename(directory).startsWith('thd-feature-release-'),'FEATURE_MIGRATION_TEMP_CONFINEMENT_FAILED');
    await rm(directory,{recursive:true,force:true});
  }
}
