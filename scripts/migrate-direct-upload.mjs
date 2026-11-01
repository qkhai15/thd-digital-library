import dotenv from 'dotenv';
import pg from 'pg';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { migrateSchema, SCHEMA_VERSION } from './schema.mjs';

dotenv.config({path:'.env.local',quiet:true});
const target=process.argv.find(value=>value.startsWith('--target='))?.slice(9);
if(!['local','supabase'].includes(target)) throw new Error('Use --target=local or --target=supabase, optionally --apply.');
const raw=target==='supabase' ? process.env.SUPABASE_DATABASE_URL : process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
if(!raw) throw new Error('Missing selected database configuration.');
const url=new URL(raw);
const ca=path.resolve(process.env.DB_SSL_CA_FILE || 'deploy/data/certs/prod-ca-2021.crt');
if(target==='supabase'){
 if(!/\.supabase\.(co|com)$/.test(url.hostname)||url.port==='6543') throw new Error('Select Supabase direct/session connection.');
 url.searchParams.set('sslmode','verify-full');url.searchParams.set('sslrootcert',ca);
}else if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Local migration requires local database.');
const pool=new pg.Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:15000});
const tools=process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const toolEnv={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),...(target==='supabase'?{PGSSLMODE:'verify-full',PGSSLROOTCERT:ca}:{})};
function run(name,args){return new Promise((resolve,reject)=>{const p=spawn(path.join(tools,`${name}${process.platform==='win32'?'.exe':''}`),args,{env:toolEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',()=>{});p.on('error',()=>reject(new Error(`${name} unavailable`)));p.on('close',n=>n===0?resolve(out):reject(new Error(`${name} failed; no private details logged`)));});}
const quote=n=>`"${n.replaceAll('"','""')}"`;
async function fingerprint(names){const records=[];for(const name of names){const row=(await pool.query(`SELECT count(*)::text count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) digest FROM public.${quote(name)} t`)).rows[0];records.push({table:name,...row});}return records;}
try{
 const versions=(await pool.query('SELECT version FROM thd_schema_migrations ORDER BY version')).rows.map(r=>r.version);
 if(versions.includes(SCHEMA_VERSION)){console.log(JSON.stringify({target,version:SCHEMA_VERSION,result:'Already applied; no writes'}));}
 else if(!process.argv.includes('--apply')){console.log(JSON.stringify({target,currentVersions:versions,nextVersion:SCHEMA_VERSION,result:'Preflight only; use --apply for backup + additive migration'}));}
 else{
  if(SCHEMA_VERSION<2)throw new Error('Direct upload migration not ready.');
  const names=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'thd_schema_migrations' ORDER BY tablename")).rows.map(r=>r.tablename);
  const before=await fingerprint(names);
  const directory=path.resolve('deploy/data/backups',`direct-upload-${target}-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  await mkdir(directory,{recursive:true});const dump=path.join(directory,'database.dump');
  await run('pg_dump',['--no-password','--format=custom',`--file=${dump}`]);
  if(!(await stat(dump)).size)throw new Error('Empty backup; migration cancelled.');
  const toc=await run('pg_restore',['--list',dump]);await writeFile(path.join(directory,'database.dump.toc'),toc);
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),target,versions,tables:before,backupSha256:createHash('sha256').update(await readFile(dump)).digest('hex'),verification:'Readable archive; do not restore over live data blindly'},null,2));
  await migrateSchema(pool);
  const after=await fingerprint(names);
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Existing data changed during migration; inspect backup/parallel writers.');
  console.log(JSON.stringify({target,result:'PASS',version:SCHEMA_VERSION,backup:directory,existingTablesPreserved:names.length,archiveReadable:true}));
 }
}catch{console.error('Direct upload migration/verification failed; no credentials logged. Check backup and schema state before retry.');process.exitCode=1;}
finally{await pool.end();}
