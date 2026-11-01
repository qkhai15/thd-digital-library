// Restore and upgrade a fresh, encrypted production snapshot on a disposable
// local Docker PostgreSQL only. Never connects to the source/production DB.
import {readFile,readdir,stat,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {Pool} from 'pg';
import {decryptFile,ensure,fileMetadata,OpsError,parseEncryptionKey,safeObjectKey,sha256,validateReceipt} from '../scripts/ops-backup/core.mjs';
import {databaseExtensions,isolatedExtensionSql,runProcess,tableDigest,toolPath,validateDatabaseManifest} from '../scripts/ops-backup/jobs.mjs';
import {migrateSchema,SCHEMA_VERSION} from '../scripts/schema.mjs';
import {assertReleasePreserved,releaseSnapshot} from '../scripts/feature-release-migration.mjs';

const TABLES=['library_items','library_comments','library_likes','library_views','borrow_requests','news_posts','wall_banners','site_settings','admin_sessions','admin_login_attempts','audit_logs','storage_upload_intents'];
const quote=value=>`"${value.replaceAll('"','""')}"`;
const newName=`thd-upgrade-restore-${randomUUID()}`;
let phase='config',key,directory,tempRoot,pool,containerCreated=false;
const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,USERPROFILE:process.env.USERPROFILE,HOME:process.env.HOME,
  DOCKER_CONFIG:process.env.DOCKER_CONFIG,DOCKER_HOST:process.env.DOCKER_HOST,DOCKER_CONTEXT:process.env.DOCKER_CONTEXT,
  PG_BIN:process.env.PG_BIN};
const stages=[];
const checked=stage=>stages.push(stage);
async function freshReceipt() {
  const proof=JSON.parse(await readFile('test-results/feature-release-backup.json','utf8'));
  ensure(proof.result==='PASS'&&Date.now()-Date.parse(proof.createdAt)>=0&&Date.now()-Date.parse(proof.createdAt)<24*3600000,'FEATURE_RESTORE_FRESH_PROOF_REQUIRED');
  ensure(proof.results?.some(result=>result.kind==='db'&&result.ciphertextChecksums==='PASS'&&result.authenticatedDecryption==='PASS'&&result.plaintextChecksums==='PASS'&&result.realIsolatedRestore==='PASS'&&result.recoveryKeyPersisted===true),'FEATURE_RESTORE_VERIFIED_BACKUP_REQUIRED');
  const root=await realpath('deploy/data/feature-release-backups');
  const entries=await readdir(root,{withFileTypes:true});
  const receipts=[];
  for(const entry of entries)if(entry.isFile()&&/^db-[\w-]+\.receipt\.json$/.test(entry.name)){
    const file=path.join(root,entry.name);ensure((await stat(file)).size<=1024*1024,'FEATURE_RESTORE_RECEIPT_TOO_LARGE');
    const receipt=validateReceipt(JSON.parse(await readFile(file,'utf8')));
    if(receipt.kind==='db')receipts.push(receipt);
  }
  receipts.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const receipt=receipts[0];
  ensure(receipt&&Date.now()-Date.parse(receipt.createdAt)>=0&&Date.now()-Date.parse(receipt.createdAt)<24*3600000,'FEATURE_RESTORE_FRESH_RECEIPT_REQUIRED');
  ensure(receipt.keyId===sha256(key).slice(0,12),'FEATURE_RESTORE_KEY_MISMATCH');
  const candidates=entries.filter(entry=>entry.isDirectory()&&/^local-rehearsal-\d+$/.test(entry.name));
  for(const candidate of candidates){
    const target=await realpath(path.join(root,candidate.name));
    ensure(path.dirname(target)===root,'FEATURE_RESTORE_TARGET_CONFINEMENT_FAILED');
    const files=new Map();let present=true;
    for(const artifact of receipt.files){
      safeObjectKey(artifact.objectKey);
      const file=path.resolve(target,...artifact.objectKey.split('/'));
      ensure(file.startsWith(target+path.sep),'FEATURE_RESTORE_ARTIFACT_CONFINEMENT_FAILED');
      try{const actual=await realpath(file);ensure(actual.startsWith(target+path.sep),'FEATURE_RESTORE_ARTIFACT_CONFINEMENT_FAILED');if(!(await stat(actual)).isFile())present=false;files.set(artifact.role,{file:actual,metadata:artifact});}
      catch(error){if(error.code==='ENOENT'){present=false;break;}throw error;}
    }
    if(present)return {receipt,files};
  }
  throw new OpsError('FEATURE_RESTORE_MATCHING_CIPHERTEXT_REQUIRED');
}

async function verifyRestored(client,manifest) {
  await client.query('BEGIN READ ONLY');
  try{
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    for(const expected of manifest.tables){const actual=await tableDigest(client,expected.table);ensure(actual.count===expected.count&&actual.sha256===expected.sha256,'FEATURE_RESTORE_SOURCE_TABLE_MISMATCH');}
    const count=async sql=>Number((await client.query(sql)).rows[0].count);
    ensure(await count("SELECT count(*) FROM pg_indexes WHERE schemaname='public'")===manifest.indexes.length,'FEATURE_RESTORE_INDEX_MISMATCH');
    ensure(await count("SELECT count(*) FROM pg_constraint WHERE contype<>'n' AND conrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)")===manifest.constraints.length,'FEATURE_RESTORE_CONSTRAINT_MISMATCH');
    ensure(await count("SELECT count(*) FROM pg_sequences WHERE schemaname='public'")===manifest.sequences.length,'FEATURE_RESTORE_SEQUENCE_MISMATCH');
    const nullability=(await client.query(`SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name COLLATE "C",column_name COLLATE "C"`)).rows;
    ensure(JSON.stringify(nullability)===JSON.stringify(manifest.nullability),'FEATURE_RESTORE_NULLABILITY_MISMATCH');
    const extensions=databaseExtensions(manifest.extensions);
    if(extensions.length){const actual=(await client.query('SELECT e.extname AS name,n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname=ANY($1::text[]) ORDER BY e.extname',[extensions.map(extension=>extension.name)])).rows;ensure(JSON.stringify(actual)===JSON.stringify(extensions),'FEATURE_RESTORE_EXTENSION_MISMATCH');}
  }finally{await client.query('ROLLBACK');}
}

async function verifySequenceSafety(client){
  const rows=(await client.query(`SELECT seq.relname sequence_name,t.relname table_name,a.attname column_name FROM pg_class seq JOIN pg_depend d ON d.objid=seq.oid AND d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass AND d.deptype IN('a','i') JOIN pg_class t ON t.oid=d.refobjid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid WHERE seq.relkind='S' AND seq.relnamespace='public'::regnamespace`)).rows;
  for(const row of rows){const state=(await client.query(`SELECT last_value::text,is_called FROM public.${quote(row.sequence_name)}`)).rows[0];const maximum=(await client.query(`SELECT max(${quote(row.column_name)})::text value FROM public.${quote(row.table_name)}`)).rows[0].value;if(maximum!==null)ensure(state.is_called?BigInt(state.last_value)>=BigInt(maximum):BigInt(state.last_value)>BigInt(maximum),'FEATURE_RESTORE_SEQUENCE_BEHIND_DATA');}
}

try{
  key=parseEncryptionKey((await readFile('deploy/data/feature-release-backup.key','utf8')).trim());
  tempRoot=await realpath(os.tmpdir());directory=await mkdtemp(path.join(tempRoot,'thd-upgrade-restored-'));
  const {receipt,files}=await freshReceipt();
  phase='authenticate-backup';
  const plain=new Map();
  for(const [role,artifact] of files){const file=path.join(directory,`${randomUUID()}.plain`);await decryptFile(artifact.file,file,key,artifact.metadata);plain.set(role,file);}
  ensure((await stat(plain.get('manifest'))).size<=32*1024*1024,'FEATURE_RESTORE_MANIFEST_TOO_LARGE');
  const manifest=JSON.parse(await readFile(plain.get('manifest'),'utf8'));
  ensure(manifest.kind==='db'&&manifest.createdAt===receipt.createdAt,'FEATURE_RESTORE_MANIFEST_RECEIPT_MISMATCH');
  const archive=plain.get('database');const metadata=await fileMetadata(archive);
  ensure(metadata.bytes===manifest.archive.bytes&&metadata.sha256===manifest.archive.sha256,'FEATURE_RESTORE_PLAINTEXT_CHECKSUM_MISMATCH');
  const toc=await runProcess(toolPath(env,'pg_restore'),['--list',archive],env,{capture:true});
  validateDatabaseManifest(manifest,toc);checked('ciphertext-checksums-authenticated-decryption-plaintext-manifest');

  phase='new-isolated-docker';
  await runProcess('docker',['run','--detach','--name',newName,'--memory','512m','--publish','127.0.0.1::5432','--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB=thd_restore_upgrade',`postgres:${manifest.pgDumpMajor}-bookworm`],env);containerCreated=true;
  const portOutput=await runProcess('docker',['port',newName,'5432/tcp'],env,{capture:true});
  const port=Number(portOutput.match(/^127\.0\.0\.1:(\d+)\s*$/)?.[1]);ensure(Number.isInteger(port)&&port>0&&port<65536,'FEATURE_RESTORE_DOCKER_PORT_INVALID');
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){try{await runProcess('docker',['exec',newName,'pg_isready','-h','127.0.0.1','-U','postgres','-d','thd_restore_upgrade'],env);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,500));}}
  ensure(ready,'FEATURE_RESTORE_DOCKER_NOT_READY');
  for(const sql of isolatedExtensionSql(manifest.extensions))await runProcess('docker',['exec',newName,'psql','--no-psqlrc','--set','ON_ERROR_STOP=1','--username=postgres','--dbname=thd_restore_upgrade','--command',sql],env);
  const listFile=path.join(directory,'restore.toc');await writeFile(listFile,toc.split(/\r?\n/).filter(line=>!/ SCHEMA - public | COMMENT - SCHEMA public /.test(line)).join('\n'),{flag:'wx',mode:0o600});
  await runProcess('docker',['cp',listFile,`${newName}:/tmp/restore.toc`],env);
  await runProcess('docker',['exec','-i',newName,'pg_restore','--no-owner','--no-acl','--exit-on-error','--single-transaction','--use-list=/tmp/restore.toc','--username=postgres','--dbname=thd_restore_upgrade'],env,{inputFile:archive});
  pool=new Pool({host:'127.0.0.1',port,user:'postgres',database:'thd_restore_upgrade',max:1,connectionTimeoutMillis:10000});
  phase='verify-restored-snapshot';
  const check=await pool.connect();try{await verifyRestored(check,manifest);await verifySequenceSafety(check);}finally{check.release();}
  ensure(Number((await pool.query('SELECT MAX(version) version FROM thd_schema_migrations')).rows[0].version)===2,'FEATURE_RESTORE_EXPECTED_V2');checked('real-fresh-production-snapshot-restored-and-verified');

  const oldColumns=(await pool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position",[TABLES])).rows;
  const columns=Object.fromEntries(TABLES.map(table=>[table,oldColumns.filter(row=>row.table_name===table).map(row=>row.column_name)]));
  ensure(TABLES.every(table=>columns[table].length>0),'FEATURE_RESTORE_BASELINE_COLUMNS_MISSING');
  const original=await releaseSnapshot(pool,columns);let before,abortAfter=true;const hooks=[];
  const options={beforeMigration:async client=>{hooks.push('before');await client.query("SET LOCAL lock_timeout='10s'");await client.query("SET LOCAL statement_timeout='90s'");await client.query(`LOCK TABLE ${TABLES.map(table=>'public.'+quote(table)).join(',')} IN SHARE ROW EXCLUSIVE MODE`);before=await releaseSnapshot(client,columns);assertReleasePreserved(original,before);},
    afterMigration:async client=>{hooks.push('after');assertReleasePreserved(before,await releaseSnapshot(client,columns));if(abortAfter)throw new OpsError('FEATURE_RESTORE_EXPECTED_POST_INVARIANT_ABORT');}};
  phase='deliberate-validation-rollback';
  let rolledBack=false;
  try{await migrateSchema(pool,options);}catch(error){if(error.code==='FEATURE_RESTORE_EXPECTED_POST_INVARIANT_ABORT')rolledBack=true;else throw error;}
  ensure(rolledBack,'FEATURE_RESTORE_EXPECTED_ABORT_DID_NOT_RUN');
  ensure(Number((await pool.query('SELECT MAX(version) version FROM thd_schema_migrations')).rows[0].version)===2,'FEATURE_RESTORE_VERSION_ROLLBACK_FAILED');
  ensure((await pool.query("SELECT to_regclass('public.library_subjects') name")).rows[0].name===null,'FEATURE_RESTORE_SCHEMA_ROLLBACK_FAILED');
  assertReleasePreserved(original,await releaseSnapshot(pool,columns));checked('failed-after-hook-rolls-back-to-v2-with-all-old-rows');

  phase='migrate-restored-v2-to-v5';abortAfter=false;
  await migrateSchema(pool,options);ensure(JSON.stringify(hooks)===JSON.stringify(['before','after','before','after']),'FEATURE_RESTORE_HOOKS_FAILED');
  assertReleasePreserved(original,await releaseSnapshot(pool,columns));
  await migrateSchema(pool,{beforeMigration:async()=>{throw new OpsError('FEATURE_RESTORE_REPLAY_CALLED_HOOK');},afterMigration:async()=>{throw new OpsError('FEATURE_RESTORE_REPLAY_CALLED_HOOK');}});
  ensure(Number((await pool.query('SELECT MAX(version) version FROM thd_schema_migrations')).rows[0].version)===SCHEMA_VERSION,'FEATURE_RESTORE_UPGRADE_VERSION_FAILED');
  const indexes=(await pool.query("SELECT indexname FROM pg_indexes WHERE schemaname='public'")).rows.map(row=>row.indexname);
  for(const index of ['idx_library_search_trigram','idx_library_items_topics','idx_collection_items_order','idx_borrow_request_code','idx_borrow_due'])ensure(indexes.includes(index),'FEATURE_RESTORE_UPGRADE_INDEX_MISSING');
  const constraints=(await pool.query("SELECT convalidated FROM pg_constraint WHERE conrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)")).rows;ensure(constraints.every(row=>row.convalidated),'FEATURE_RESTORE_UPGRADE_CONSTRAINT_INVALID');
  const sequenceCheck=await pool.connect();try{await verifySequenceSafety(sequenceCheck);}finally{sequenceCheck.release();}
  ensure((await pool.query("SELECT public.thd_search_normalize('Ngữ văn Địa lí') value")).rows[0].value==='ngu van dia li','FEATURE_RESTORE_SEARCH_NORMALIZATION_FAILED');
  checked('restored-production-v2-to-v5-old-columns-counts-digests-replay-indexes-constraints-sequences');
  const report={result:'PASS',verifiedAt:new Date().toISOString(),backupCreatedAt:receipt.createdAt,sourceVersion:2,targetVersion:SCHEMA_VERSION,
    baselineTables:manifest.tables.length,counts:Object.fromEntries(Object.entries(original).map(([table,row])=>[table,Number(row.count)])),stages,
    authenticatedDecryption:true,realFreshSnapshotRestore:true,sameTransactionInvariants:true,deliberateRollback:true,replay:true,indexes:true,constraints:true,sequences:true,
    productionConnection:false,productionWrites:false,storageWrites:false,cleanupScope:'only-this-new-container-and-private-temp'};
  if(process.env.FEATURE_RESTORED_REPORT)await writeFile(process.env.FEATURE_RESTORED_REPORT,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({result:'FAIL',phase,code:error instanceof OpsError?error.code:'FEATURE_RESTORED_DRILL_FAILED_PRIVATE_DETAILS_SUPPRESSED',productionConnection:false,productionWrites:false}));process.exitCode=1;}
finally{
  await pool?.end();key?.fill(0);
  try{if(containerCreated)await runProcess('docker',['rm','--force',newName],env);}
  finally{if(directory){ensure(path.dirname(directory)===tempRoot&&/^thd-upgrade-restored-[\w-]+$/.test(path.basename(directory)),'FEATURE_RESTORE_TEMP_CONFINEMENT_FAILED');await rm(directory,{recursive:true,force:true});}}
}
