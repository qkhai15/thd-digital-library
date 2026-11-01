import dotenv from "dotenv";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { signedTransfer } from "./verify-signed-transfer.mjs";

// Builds/runs locally only. Credentials travel through process env or private stdin,
// never Docker build args, command-line values, image layers, or printed inspect data.
dotenv.config({ path: ".env.local", quiet: true });
const docker = process.env.DOCKER_BIN || (process.platform === "win32" ? "C:/Program Files/Docker/Docker/resources/bin/docker.exe" : "docker");
const config = await mkdtemp(path.join(os.tmpdir(), "thd-docker-client-"));
await writeFile(path.join(config,"config.json"), JSON.stringify(process.platform === "win32" ? { cliPluginsExtraDirs:["C:/Program Files/Docker/Docker/resources/cli-plugins"] } : {}));
const dockerArgs = ["--config",config,...(process.platform === "win32" ? ["--host",process.env.DOCKER_HOST || "npipe:////./pipe/dockerDesktopLinuxEngine"] : [])];
function cli(args, { input, env = process.env, print = false } = {}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(docker,[...dockerArgs,...args],{env,windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let output="";
    child.stdout.on("data",bytes=>{output+=bytes;if(print)process.stdout.write(bytes);});
    child.stderr.on("data",bytes=>{if(print)process.stderr.write(bytes);});
    child.on("error",()=>reject(new Error("Docker executable unavailable.")));
    child.on("close",code=>code===0?resolve(output):reject(new Error(`Docker ${args[0]} failed (${code}); engine/build/runtime needs attention.`)));
    child.stdin.end(input || "");
  });
}
const image="thd-library:railway-verify";
const name=`thd-railway-check-${Date.now()}`;
const origin="http://127.0.0.1:3104";
const publicOrigin="https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn";
const ca=await readFile(process.env.DB_SSL_CA_FILE || "deploy/data/certs/prod-ca-2021.crt");
const env={...process.env,DATABASE_URL:process.env.SUPABASE_DATABASE_URL,DB_SSL_CA_BASE64:ca.toString("base64"),AUTO_MIGRATE:"false",STORAGE_DRIVER:"supabase",STORAGE_LEGACY_REMOTE:"true",UPLOAD_MEDIA_MAX_MIB:"50",ADMIN_USERNAME:`QA-direct-${Date.now()}`,ADMIN_PASSWORD:randomBytes(24).toString("hex"),SESSION_SECRET:randomBytes(48).toString("hex"),ADMIN_SESSION_NOT_BEFORE:new Date().toISOString(),APP_ORIGIN:publicOrigin,PORT:"3000",DB_POOL_MAX:"5",UPLOAD_MAX_CONCURRENT:"1"};
if (process.env.DOCKER_VERIFY_TEST_ENV_FILE) {
  const filename = path.resolve(process.env.DOCKER_VERIFY_TEST_ENV_FILE);
  const privateRoot = path.resolve("deploy/data");
  if (!filename.startsWith(privateRoot + path.sep)) throw new Error("Test credentials must stay in ignored deploy/data.");
  await mkdir(path.dirname(filename), {recursive:true});
  const keys = ["DATABASE_URL","DB_SSL_CA_BASE64","AUTO_MIGRATE","STORAGE_DRIVER","STORAGE_LEGACY_REMOTE","UPLOAD_MEDIA_MAX_MIB","SUPABASE_URL","SUPABASE_STORAGE_BUCKET","SUPABASE_UPLOAD_BUCKET","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY","ADMIN_USERNAME","ADMIN_PASSWORD","SESSION_SECRET","ADMIN_SESSION_NOT_BEFORE","APP_ORIGIN","PUBLIC_ORIGINS","PORT","DB_POOL_MAX","UPLOAD_MAX_CONCURRENT"];
  await writeFile(filename, keys.filter(key=>env[key]).map(key=>`${key}=${JSON.stringify(env[key])}`).join("\n") + "\n", {mode:0o600});
}
const report={createdAt:new Date().toISOString(),docker:"not run",runtime:"not run",checks:[],memorySamples:[],uploads:[],note:"Local Docker only, no Railway deployment/DNS changes. Test Storage objects retained."};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const request=(route,options={})=>fetch(new URL(route,origin),{...options,redirect:"manual",headers:{origin:publicOrigin,"x-forwarded-host":publicOrigin.slice(8),"x-forwarded-proto":"https",...options.headers},signal:AbortSignal.timeout(180000)});
function memoryBytes(raw) {
  const match=raw.split("/")[0].trim().match(/^([\d.]+)\s*(B|KiB|MiB|GiB)$/);
  return match?Number(match[1])*({B:1,KiB:1024,MiB:1024**2,GiB:1024**3}[match[2]]):null;
}
let running=false,phase="idle",sampling=false,corsChecked=false;
async function sample() {
  if(sampling)return;
  sampling=true;
  try{const value=JSON.parse((await cli(["stats","--no-stream","--format","{{json .}}",name])).trim());report.memorySamples.push({at:new Date().toISOString(),phase,bytes:memoryBytes(value.MemUsage),cpu:value.CPUPerc});}finally{sampling=false;}
}
let timer;
try {
  await cli(["info","--format","{{.OSType}}"]).then(value=>assert.equal(value.trim(),"linux","Linux Docker engine required"));
  if(process.env.DOCKER_VERIFY_REUSE_IMAGE!=='true') await cli(["build","--file","deploy/Dockerfile.railway","--tag",image,"."],{print:true});
  report.docker="PASS";
  const metadata=JSON.parse(await cli(["image","inspect",image]))[0];
  report.imageId=metadata.Id;
  assert.equal(metadata.Config.User,"node");
  assert.ok(!metadata.Config.Env.some(item=>/^(DATABASE_URL|SUPABASE_.*KEY|DB_SSL_CA_BASE64)=/.test(item)));
  const secrets=[process.env.SUPABASE_SECRET_KEY,process.env.SUPABASE_SERVICE_ROLE_KEY];
  let genericPasswordTokens=0;
  for(const variable of [process.env.DATABASE_URL,process.env.SUPABASE_DATABASE_URL])if(variable){
    const url=new URL(variable), password=decodeURIComponent(url.password);
    secrets.push(variable,url.toString(),`${url.username}:${url.password}@`,`${decodeURIComponent(url.username)}:${password}@`);
    // A common short password also occurs in harmless package names/docs. Inspect
    // full credential contexts for it, rather than claiming those words are leaks.
    if(password.length>=10){secrets.push(password,url.password);}else genericPasswordTokens++;
  }
  // Scan the actual image filesystem, in a bare container with no runtime env.
  const scan=`const fs=require('fs'),path=require('path');const secrets=${JSON.stringify(secrets.filter(value=>value&&value.length>=8))}.map(value=>Buffer.from(value));const hits=[];let files=0;function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory()){walk(file);continue;}if(!e.isFile())continue;files++;if(file==='/app/.env.local'||file.startsWith('/app/deploy/data/')||/\\.(dump|crt|cer|pem)$/.test(file)&&!file.includes('/node_modules/'))hits.push(file);const fd=fs.openSync(file,'r');const chunk=Buffer.alloc(65536);let tail=Buffer.alloc(0),n;while((n=fs.readSync(fd,chunk,0,chunk.length,null))>0){const bytes=Buffer.concat([tail,chunk.subarray(0,n)]);if(secrets.some(secret=>bytes.includes(secret))){hits.push(file);break;}tail=bytes.subarray(Math.max(0,bytes.length-1024));}fs.closeSync(fd);}}walk('/app');console.log(JSON.stringify({files,hits}));`;
  const scanResult=JSON.parse(await cli(["run","--rm","--interactive","--entrypoint","node",image],{input:scan}));
  assert.deepEqual(scanResult.hits,[],"Private files or secret bytes in image");
  report.checks.push(`image secrets/private-file scan PASS (${scanResult.files} files; ${genericPasswordTokens} short passwords checked in credential context)`);
  const names=["DATABASE_URL","DB_SSL_CA_BASE64","AUTO_MIGRATE","STORAGE_DRIVER","STORAGE_LEGACY_REMOTE","UPLOAD_MEDIA_MAX_MIB","SUPABASE_URL","SUPABASE_STORAGE_BUCKET","SUPABASE_UPLOAD_BUCKET","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY","ADMIN_USERNAME","ADMIN_PASSWORD","SESSION_SECRET","ADMIN_SESSION_NOT_BEFORE","APP_ORIGIN","PUBLIC_ORIGINS","PORT","DB_POOL_MAX","UPLOAD_MAX_CONCURRENT"];
  await cli(["run","--detach","--name",name,"--publish","127.0.0.1:3104:3000","--memory","1g","--cpus","1",...names.filter(key=>env[key]).flatMap(key=>["--env",key]),image],{env});
  running=true;
  let healthy=false;
  for(let attempt=0;attempt<60;attempt++){try{const r=await request("/api/health");if(r.status===200){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
  assert.equal(healthy,true,"Container startup/health");
  assert.equal((await request("/api/health")).headers.get("cache-control"),"no-store");
  const tlsScript=`(async()=>{const {prepareProductionEnvironment}=await import('./scripts/production-config.mjs');const pg=require('pg');const env=await prepareProductionEnvironment(process.env);const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:1});try{const c=await pool.connect();try{const r=await c.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');const socket=c.connection.stream;console.log(JSON.stringify({verifyFull:new URL(env.DATABASE_URL).searchParams.get('sslmode')==='verify-full',clientEncrypted:socket.encrypted===true,clientAuthorized:socket.authorized===true,tls:socket.getProtocol(),poolerBackendSSL:r.rows[0].ssl}));}finally{c.release();}}finally{await pool.end();}})().catch(()=>{console.error('TLS check failed');process.exitCode=1;});`;
  const tls=JSON.parse(await cli(["exec","--interactive",name,"node"],{input:tlsScript}));
  assert.equal(tls.verifyFull,true);assert.equal(tls.clientEncrypted,true);assert.equal(tls.clientAuthorized,true);
  report.databaseTLS=tls;
  assert.equal((await cli(["exec",name,"node","-e","console.log(require('fs').existsSync('/app/public/uploads'))"])).trim(),"false");
  report.checks.push("container start/health/DB TLS verify-full PASS; no local uploads directory");
  const login=await request("/api/admin/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD})});assert.equal(login.status,200);
  const header=login.headers.getSetCookie().find(value=>value.startsWith("thd_admin_session="));assert.match(header,/HttpOnly/i);assert.match(header,/Secure/i);
  const cookie=header.split(";")[0];
  assert.equal((await (await request("/api/admin/session",{headers:{cookie}})).json()).authenticated,true);
  const signBody=(kind,size,fileName,mime)=>({kind,size,fileName,mime,documentType:kind==='video'?'video':kind==='audio'?'sach-noi':'sach-dien-tu'});
  const metadataRequest=(route,body,headers={cookie})=>request(route,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await request('/api/admin/upload/limits')).status,401);
  const actualLimits=await request('/api/admin/upload/limits',{headers:{cookie}});
  assert.equal(actualLimits.status,200);report.effectiveLimits=await actualLimits.json();
  assert.equal(report.effectiveLimits.maxBytes.video,50*1024**2);
  for(const size of [50*1024**2+1,64*1024**2]){
    const denied=await metadataRequest('/api/admin/upload/sign',signBody('video',size,'oversize.mp4','video/mp4'));
    assert.equal(denied.status,413);assert.match((await denied.json()).message,/nén|nâng/i);
  }
  report.checks.push('Free effective50MiB limits;50MiB+1/64MiB denied beforetoken/bytes PASS');
  assert.equal((await metadataRequest('/api/admin/upload/sign',signBody('video',32*1024**2,'test.mp4','video/mp4'),{})).status,401);
  assert.equal((await metadataRequest('/api/admin/upload/sign',signBody('video',32*1024**2,'test.mp4','video/mp4'),{cookie,origin:'https://untrusted.example'})).status,403);
  assert.equal((await metadataRequest('/api/admin/upload/sign',signBody('video',32*1024**2,'../test.mp4','video/mp4'))).status,400);
  const capped=new FormData();capped.set('kind','video');capped.set('file',new File([Buffer.alloc(17*1024**2)],'guard.mp4',{type:'video/mp4'}));
  assert.equal((await request('/api/admin/upload',{method:'POST',headers:{cookie},body:capped})).status,413);
  report.checks.push('sign requires Admin/origin/safe filename; compatibility multipart hard cap PASS');
  const docs=await (await request("/api/admin/documents",{headers:{cookie}})).json();
  const legacyUrls=[...new Set(docs.flatMap(item=>[item.cover_url,item.file_url,...item.gallery_urls]).filter(url=>url?.startsWith('/uploads/')))];
  for(const url of legacyUrls){const r=await request(url,{method:"HEAD"});assert.equal(r.status,307);assert.equal((await fetch(r.headers.get('location'),{method:'HEAD'})).status,200);}
  for(const type of ['sach-dien-tu','sach-noi','video']){
    const item=docs.find(item=>item.type===type&&item.file_url);assert.ok(item,type);
    const r=await request(item.file_url,{headers:{range:'bytes=0-15'}});assert.equal(r.status,307);
    const media=await fetch(r.headers.get('location'),{headers:{range:'bytes=0-15'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,16);
  }
  for(const route of ['/','/admin','/tai-lieu/album','/tin-tuc']){
    const page=await request(route,{headers:{cookie}});assert.equal(page.status,200);const html=await page.text();assert.ok(!/src="\/_next\/image[^" ]*url=%2Fuploads/i.test(html));
  }
  report.checks.push(`admin login/session, ${legacyUrls.length} legacy files/images and PDF/audio/video Range PASS`);
  for(let i=0;i<5;i++){await sample();await new Promise(resolve=>setTimeout(resolve,500));}
  timer=setInterval(()=>sample().catch(()=>undefined),750);
  const imageBytes=await readFile('tests/browser-fixtures/test-1.jpg');
  async function upload(kind,bytes,extension,mime,label){
    phase=label;await sample();
    const begin=Date.now();let r,intent;
    const direct=['document','audio','video'].includes(kind)&&bytes.length>6*1024**2;
    const fileName=`docker-qa-${randomUUID()}${extension}`;
    if(direct){
      const signed=await metadataRequest('/api/admin/upload/sign',signBody(kind,bytes.length,fileName,mime));
      if(!signed.ok)r=signed;
      else{
        intent=await signed.json();
        if(!corsChecked){
          const preflight=await fetch(intent.endpoint,{method:'OPTIONS',headers:{Origin:publicOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,tus-resumable,upload-length,upload-metadata,x-signature,x-upsert'}});
          assert.ok(preflight.ok);assert.ok(['*',publicOrigin].includes(preflight.headers.get('access-control-allow-origin')));
          const allowed=(preflight.headers.get('access-control-allow-headers')||'').toLowerCase();
          for(const required of ['x-signature','x-upsert','tus-resumable','upload-length','upload-metadata'])assert.ok(allowed==='*'||allowed.includes(required));
          report.checks.push('signed TUS CORS preflight PASS for production origin');corsChecked=true;
        }
        const operations=[];
        if(label==='video 32 MiB'){
          const paused=await signedTransfer(bytes,intent,{pauseAfterChunk:true,onRequest:v=>operations.push(v)});
          assert.equal(paused.paused,true);assert.ok(paused.offset>=6*1024**2);
          const resumed=await metadataRequest('/api/admin/upload/sign',{...signBody(kind,bytes.length,`unused${extension}`,mime),fileName:`unused${extension}`,resumeId:intent.id});
          // Exact original filename is required; retain it in the request below.
          assert.equal(resumed.status,409);
          const refreshed=await metadataRequest('/api/admin/upload/sign',{...signBody(kind,bytes.length,fileName,mime),resumeId:intent.id});
          assert.equal(refreshed.status,201);intent=await refreshed.json();
          await signedTransfer(bytes,intent,{resumeUrl:paused.url,onRequest:v=>operations.push(v)});
          assert.ok(operations.some(v=>v.method==='HEAD'));report.checks.push('real TUS pause/HEAD-offset resume PASS');
        }else await signedTransfer(bytes,intent,{onRequest:v=>operations.push(v)});
        assert.ok(operations.every(v=>v.host===new URL(intent.endpoint).host));
        report.checks.push(`${label}: every TUS byte request targets Storage directly`);
        const privateURL=`${env.SUPABASE_URL}/storage/v1/object/public/${intent.bucket}/${intent.path}`;
        assert.ok(![200,206].includes((await fetch(privateURL,{method:'HEAD'})).status));
        const uploaded=await metadataRequest('/api/admin/upload/sign',{...signBody(kind,bytes.length,fileName,mime),resumeId:intent.id});
        assert.equal(uploaded.status,201);assert.equal((await uploaded.json()).uploaded,true);
        if(label==='video 32 MiB'){
          // Simulate Storage copy succeeding before a lost database commit. This
          // acts on this new QA intent only, without changing its DB row or any
          // old document. App finalize must recover the existing immutable copy.
          const preCopy=`(async()=>{const {prepareProductionEnvironment}=await import('./scripts/production-config.mjs');const {createClient}=require('@supabase/supabase-js');const pg=require('pg');const env=await prepareProductionEnvironment(process.env);const p=new pg.Pool({connectionString:env.DATABASE_URL,max:1});try{const r=await p.query('SELECT source_bucket,source_key,destination_bucket,destination_key FROM storage_upload_intents WHERE id=$1 AND username=$2',[${JSON.stringify(intent.id)},${JSON.stringify(env.ADMIN_USERNAME)}]);if(r.rowCount!==1)throw Error();const row=r.rows[0],c=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});const copied=await c.storage.from(row.source_bucket).copy(row.source_key,row.destination_key,{destinationBucket:row.destination_bucket});if(copied.error)throw Error();console.log('PASS');}finally{await p.end();}})().catch(()=>{console.error('QA pre-copy simulation failed');process.exitCode=1;});`;
          assert.equal((await cli(['exec','--interactive',name,'node'],{input:preCopy})).trim(),'PASS');
          report.checks.push('own QA Storage pre-copy simulates lost commit without DB mutation');
        }
        r=await metadataRequest('/api/admin/upload/finalize',{id:intent.id});
      }
    }else{
      const body=new FormData();body.set('kind',kind);body.set('file',new File([bytes],`docker-qa-${randomUUID()}${extension}`,{type:mime}));
      r=await request('/api/admin/upload',{method:'POST',headers:{cookie},body});
    }
    assert.equal(r.status,direct?200:201,label);const stored=await r.json();assert.equal(stored.driver,'supabase');
    if(label==='video 32 MiB')report.checks.push('real existing-copy recovery despite multipart/single-copy ETag difference PASS');
    if(intent){assert.deepEqual(await(await metadataRequest('/api/admin/upload/finalize',{id:intent.id})).json(),stored);}
    const redirect=await request(stored.url,{headers:{range:'bytes=0-15'}});assert.equal(redirect.status,307);
    const range=await fetch(redirect.headers.get('location'),{headers:{range:'bytes=0-15'}});assert.equal(range.status,206);
    const download=await fetch(redirect.headers.get('location'));assert.equal(hash(Buffer.from(await download.arrayBuffer())),hash(bytes));
    await sample();report.uploads.push({label,size:bytes.length,elapsedMs:Date.now()-begin,url:stored.url,architecture:direct?'signed direct TUS':'server multipart',result:'PASS'});console.log(`PASS ${label}: ${Math.round(bytes.length/1024/1024)} MiB upload/hash/Range`);
  }
  await upload('cover',imageBytes,'.jpg','image/jpeg','small image');
  const original=await readFile('tests/browser-fixtures/test.mp4');
  for(const size of [16,32,48]){const padding=size*1024*1024-original.length-8;const box=Buffer.alloc(8);box.writeUInt32BE(padding+8);box.write('free',4);await upload('video',Buffer.concat([original,box,Buffer.alloc(padding)]),'.mp4','video/mp4',`video ${size} MiB`);}
  const pdf=await readFile('tests/browser-fixtures/test.pdf');
  await upload('document',Buffer.concat([pdf,Buffer.from('\n%'),Buffer.alloc(8*1024**2-pdf.length,32),Buffer.from('\n')]),'.pdf','application/pdf','PDF 8 MiB');
  const audio=await readFile('tests/browser-fixtures/test.wav');const wav=Buffer.concat([audio,Buffer.alloc(8*1024**2-audio.length)]);wav.writeUInt32LE(wav.length-8,4);const dataOffset=wav.indexOf(Buffer.from('data'));if(dataOffset>=0)wav.writeUInt32LE(wav.length-dataOffset-8,dataOffset+4);
  await upload('audio',wav,'.wav','audio/wav','audio 8 MiB');
  const metadataScript=`(async()=>{const {prepareProductionEnvironment}=await import('./scripts/production-config.mjs');const pg=require('pg');const env=await prepareProductionEnvironment(process.env);const p=new pg.Pool({connectionString:env.DATABASE_URL,max:1});try{const r=await p.query("SELECT count(*)::int count,bool_and(status='completed' AND result->>'url' LIKE '/uploads/supabase/%') valid FROM storage_upload_intents WHERE username=$1",[${JSON.stringify(env.ADMIN_USERNAME)}]);const security=await p.query("SELECT relrowsecurity,has_table_privilege('anon','storage_upload_intents','SELECT') anonymous_read FROM pg_class WHERE oid='storage_upload_intents'::regclass");console.log(JSON.stringify({intents:r.rows[0],security:security.rows[0]}));}finally{await p.end();}})().catch(()=>{console.error('Upload metadata verification failed');process.exitCode=1;});`;
  const persisted=JSON.parse(await cli(['exec','--interactive',name,'node'],{input:metadataScript}));
  assert.equal(persisted.intents.count,5);assert.equal(persisted.intents.valid,true);assert.equal(persisted.security.relrowsecurity,true);assert.equal(persisted.security.anonymous_read,false);
  report.persistedMetadata=persisted;report.checks.push('hosted DB upload metadata/idempotency/RLS PASS');
  phase='post-upload';await sample();
  const logout=await request('/api/admin/logout',{method:'POST',headers:{cookie}});assert.equal(logout.status,303);assert.equal((await (await request('/api/admin/session',{headers:{cookie}})).json()).authenticated,false);
  report.checks.push('admin logout PASS');report.runtime='PASS';
  report.peakMemoryBytes=Math.max(...report.memorySamples.map(sample=>sample.bytes||0));
  report.idleMemoryBytes=Math.max(...report.memorySamples.filter(sample=>sample.phase==='idle').map(sample=>sample.bytes||0));
  console.log(JSON.stringify({docker:report.docker,runtime:report.runtime,idleMiB:Math.round(report.idleMemoryBytes/1024**2),peakMiB:Math.round(report.peakMemoryBytes/1024**2),largestPassingUploadMiB:Math.round(Math.max(...report.uploads.filter(upload=>upload.result==='PASS').map(upload=>upload.size))/1024**2),uploadBlocker:Boolean(report.uploadBlocker)}));
}catch(error){report.failure=error.message;console.error(error.message);process.exitCode=1;}
finally{
  if(timer)clearInterval(timer);while(sampling)await new Promise(resolve=>setTimeout(resolve,100));
  if(running && process.env.DOCKER_VERIFY_KEEP_CONTAINER==='true' && report.runtime==='PASS'){
    report.retainedTestContainer=name;
    console.log(`Local test container retained for browser inspection: ${name}`);
  }else if(running){
    await cli(['stop',name]).catch(()=>undefined);
    const state=await cli(['inspect','--format','{{json .State}}',name]).catch(()=>null);
    if(state){const value=JSON.parse(state);report.shutdown={exitCode:value.ExitCode,OOMKilled:value.OOMKilled,running:value.Running};}
    await cli(['rm',name]).catch(()=>undefined);
  }
  await mkdir('test-results',{recursive:true});const filename=`test-results/docker-verification-${Date.now()}.json`;await writeFile(filename,JSON.stringify(report,null,2));console.log(`Verification report: ${filename}`);
}
