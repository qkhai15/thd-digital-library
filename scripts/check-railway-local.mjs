import dotenv from "dotenv";
import { readFile,mkdir,writeFile,mkdtemp,cp,symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes,randomUUID,createHash } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";
import assert from "node:assert/strict";

// Local rehearsal of the Railway start entrypoint; never deploys or edits .env.local.
dotenv.config({path:".env.local",quiet:true});
const certificate=await readFile(process.env.DB_SSL_CA_FILE || "deploy/data/certs/prod-ca-2021.crt");
const cutoff=new Date().toISOString();
const testPassword=randomBytes(24).toString("hex");
const origin="http://localhost:3103";
const publicOrigin="https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn";
const env={...process.env,DATABASE_URL:process.env.SUPABASE_DATABASE_URL,DB_SSL_CA_BASE64:certificate.toString("base64"),AUTO_MIGRATE:"false",STORAGE_DRIVER:"supabase",STORAGE_LEGACY_REMOTE:"true",ADMIN_SESSION_NOT_BEFORE:cutoff,ADMIN_PASSWORD:testPassword,SESSION_SECRET:randomBytes(48).toString("hex"),APP_ORIGIN:publicOrigin,PORT:"3103"};
// Match the Railway Docker image: public assets exist, public/uploads does not.
// Next serves existing public files before dynamic routes, so testing in the original
// workspace would accidentally exercise local storage. Original files remain intact.
const runtime=await mkdtemp(path.join(os.tmpdir(),"thd-railway-check-"));
await symlink(path.resolve("node_modules"),path.join(runtime,"node_modules"),"junction");
await symlink(path.resolve(".next"),path.join(runtime,".next"),"junction");
await cp("next.config.ts",path.join(runtime,"next.config.ts"));
await cp("package.json",path.join(runtime,"package.json"));
await cp("public",path.join(runtime,"public"),{recursive:true,filter:source=>source!==path.join("public","uploads")});
const server=spawn(process.execPath,[path.resolve("scripts/start-railway.mjs")],{env,cwd:runtime,stdio:["ignore","pipe","pipe"],windowsHide:true});
server.stdout.on("data",bytes=>{const line=bytes.toString();if(line.includes("preflight PASS"))console.log("PASS production runtime preflight: verified TLS and public Storage bucket");});
server.stderr.on("data",()=>undefined);
const request=(route,options={})=>fetch(new URL(route,origin),{...options,redirect:"manual",headers:{"x-forwarded-host":publicOrigin.slice(8),"x-forwarded-proto":"https",origin:publicOrigin,...options.headers},signal:AbortSignal.timeout(60000)});
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const report={runtime:"Railway entrypoint locally, real Supabase DB/Storage",tests:[],uploads:[]};
let adminCookie;
const dbUrl=new URL(env.DATABASE_URL);dbUrl.searchParams.set("sslmode","verify-full");dbUrl.searchParams.set("sslrootcert",process.env.DB_SSL_CA_FILE || "C:/Projects/thd-library/deploy/data/certs/prod-ca-2021.crt");
const pool=new pg.Pool({connectionString:dbUrl.toString(),max:1});
try {
 let ready=false;
 for(let attempt=0;attempt<30;attempt++){try{const response=await request("/api/health");if(response.status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
 assert.equal(ready,true,"Production startup/health");
 report.tests.push("runtime CA base64, PORT binding, hosted DB, health PASS");
 const oldToken=randomBytes(32).toString("hex");
 await pool.query("INSERT INTO admin_sessions(token_hash,username,expires_at,created_at) VALUES($1,$2,NOW()+INTERVAL '1 hour',$3::timestamptz-INTERVAL '1 day')",[hash(oldToken),"QA-session-cutoff",cutoff]);
 const old=await request("/api/admin/session",{headers:{cookie:`thd_admin_session=${oldToken}`}});
 assert.equal((await old.json()).authenticated,false);
 const login=await request("/api/admin/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:env.ADMIN_USERNAME,password:testPassword})});
 assert.equal(login.status,200);
 const setCookie=login.headers.getSetCookie().find(cookie=>cookie.startsWith("thd_admin_session="));
 assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/Secure/i);assert.match(setCookie,/SameSite=Lax/i);
 adminCookie=setCookie.split(";")[0];
 assert.equal((await (await request("/api/admin/session",{headers:{cookie:adminCookie}})).json()).authenticated,true);
 assert.equal((await request("/api/admin/dashboard",{headers:{cookie:adminCookie}})).status,200);
 report.tests.push("old session denied; new session/dashboard PASS; Secure/HttpOnly/Lax behind HTTPS proxy headers");
 const legacy=(await pool.query("SELECT DISTINCT url FROM (SELECT cover_url url FROM library_items UNION ALL SELECT file_url FROM library_items UNION ALL SELECT jsonb_array_elements_text(gallery_urls) FROM library_items UNION ALL SELECT cover_url FROM news_posts UNION ALL SELECT image_url FROM wall_banners) u WHERE url LIKE '/uploads/%'")).rows;
 for(const {url} of legacy){const response=await request(url,{method:"HEAD"});assert.equal(response.status,307);const remote=await fetch(response.headers.get("location"),{method:"HEAD"});assert.equal(remote.status,200);}
 let checkedImages=0;
 for(const route of ["/","/tai-lieu/sach-giay","/tai-lieu/sach-dien-tu","/tai-lieu/album","/tin-tuc","/admin","/admin/news","/admin/operations"]){
  const page=await request(route,{headers:{cookie:adminCookie}});assert.equal(page.status,200,route);
  const html=await page.text();
  assert.ok(!/src="\/_next\/image[^" ]*url=%2Fuploads/i.test(html),`${route}: uploaded images bypass optimizer redirects`);
  for(const match of html.matchAll(/<img[^>]+src="(\/uploads\/[^" ]+)"/g)){
   const image=await request(match[1]);assert.equal(image.status,307);
   const remote=await fetch(image.headers.get("location"));assert.equal(remote.status,200);assert.ok(remote.headers.get("content-type").startsWith("image/"));checkedImages++;
  }
 }
 assert.ok(checkedImages>0,"Regression must exercise real rendered upload images");
 report.tests.push(`${checkedImages} rendered upload images PASS across public/admin HTML and real Storage responses`);
 report.tests.push(`${legacy.length} legacy URLs PASS through remote-only redirects (no local upload reads)`);
 for(const [kind,name,mime]of[["document","test.pdf","application/pdf"],["audio","test.wav","audio/wav"],["video","test.mp4","video/mp4"]]){
  const original=await readFile(`tests/browser-fixtures/${name}`);
  const extra=8*1024*1024-original.length;
  let bytes;
  if(kind==="document")bytes=Buffer.concat([original,Buffer.from("\n%"),Buffer.alloc(extra,32),Buffer.from("\n")]);
  else if(kind==="video"){const header=Buffer.alloc(8);header.writeUInt32BE(extra+8,0);header.write("free",4);bytes=Buffer.concat([original,header,Buffer.alloc(extra)]);}
  else{bytes=Buffer.concat([original,Buffer.alloc(extra)]);bytes.writeUInt32LE(bytes.length-8,4);const offset=bytes.indexOf(Buffer.from("data"));if(offset>=0)bytes.writeUInt32LE(bytes.length-offset-8,offset+4);}
  const form=new FormData();form.set("kind",kind);form.set("file",new File([bytes],`railway-qa-${randomUUID()}${name.slice(name.lastIndexOf('.'))}`,{type:mime}));
  const response=await request("/api/admin/upload",{method:"POST",headers:{cookie:adminCookie},body:form});assert.equal(response.status,201,kind);
  const stored=await response.json();assert.equal(stored.driver,"supabase");
  const redirect=await request(stored.url);assert.equal(redirect.status,307);
  const download=await fetch(redirect.headers.get("location"));assert.equal(hash(Buffer.from(await download.arrayBuffer())),hash(bytes));
  report.uploads.push({kind,size:bytes.length,url:stored.url,result:"PASS"});console.log(`PASS production upload ${kind}: 8 MiB, real Storage and hash`);
 }
 await request("/api/admin/logout",{method:"POST",headers:{cookie:adminCookie}});
 assert.equal((await (await request("/api/admin/session",{headers:{cookie:adminCookie}})).json()).authenticated,false);
 report.result="PASS";
 await mkdir("test-results",{recursive:true});await writeFile(`test-results/railway-preparation-${Date.now()}.json`,JSON.stringify(report,null,2));
 console.log("PASS Railway local production rehearsal: health/auth/session cutoff/legacy URLs/large uploads/logout. Not a Railway edge or container test.");
}finally{server.kill("SIGTERM");await pool.end();}
