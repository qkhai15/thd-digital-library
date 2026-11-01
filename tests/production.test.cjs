const test=require('node:test');
const assert=require('node:assert/strict');
const loader=require('./load-project.cjs');

test('unexpected production child signal exits fail so Railway can restart',async()=>{
 const {productionChildExitCode}=await import('../scripts/production-config.mjs');
 assert.equal(productionChildExitCode(null,false),1);
 assert.equal(productionChildExitCode(null,true),0);
 assert.equal(productionChildExitCode(0,false),0);
 assert.equal(productionChildExitCode(1,true),1);
 assert.equal(productionChildExitCode(143,true),0);
 assert.equal(productionChildExitCode(143,false),143);
});

test('Railway production rejects local DB, weak flags, missing CA and disabled TLS',async()=>{
 const {validateProductionConfig}=await import('../scripts/production-config.mjs');
 const env={DATABASE_URL:'postgresql://postgres.example:test@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',SUPABASE_URL:'https://example.supabase.co',SUPABASE_STORAGE_BUCKET:'thd-library',SUPABASE_SECRET_KEY:'test-server-key',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'production-test-password',SESSION_SECRET:'a'.repeat(64),APP_ORIGIN:'https://library.example',ADMIN_SESSION_NOT_BEFORE:'2026-01-01T00:00:00Z',DB_SSL_CA_BASE64:'test',AUTO_MIGRATE:'false',STORAGE_DRIVER:'supabase',STORAGE_LEGACY_REMOTE:'true'};
 assert.equal(validateProductionConfig(env).port,'3000');
 for(const parameter of ['host=localhost','port=6543','database=local_db','user=other']) assert.throws(()=>validateProductionConfig({...env,DATABASE_URL:`${env.DATABASE_URL}?${parameter}`}));
 for(const change of [{DATABASE_URL:'postgresql://user:pass@localhost:5432/db'},{AUTO_MIGRATE:'true'},{STORAGE_DRIVER:'local'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},{DB_SSL_CA_BASE64:''},{ADMIN_SESSION_NOT_BEFORE:''},{APP_ORIGIN:'http://library.example'},{ADMIN_PASSWORD:'12345'},{ADMIN_PASSWORD:'CHANGE_ME_ADMIN_PASSWORD'},{ADMIN_PASSWORD:'passwordpasswordpassword'},{SESSION_SECRET:''},{SESSION_SECRET:'short'},{SESSION_SECRET:'doi-chuoi-nay-thanh-mot-chuoi-dai-kho-doan'},{PUBLIC_ORIGINS:'https://*.example.com'},{PUBLIC_ORIGINS:'http://localhost:3000'},{PUBLIC_ORIGINS:'https://library.example/path'}]) assert.throws(()=>validateProductionConfig({...env,...change}));
 assert.equal(validateProductionConfig({...env,PUBLIC_ORIGINS:'https://generated.example, https://temporary.example'}).port,'3000');
});

test('session cutoff is bound in SQL and keeps historical session records',async()=>{
 const previous=process.env.ADMIN_SESSION_NOT_BEFORE;
 process.env.ADMIN_SESSION_NOT_BEFORE='2026-10-13T00:00:00Z';
 let query;
 const auth=loader({'next/headers':{cookies:async()=>({get:()=>({value:'a'.repeat(64)})})},'@/lib/db':{ensureSchema:async()=>{},db:{query:async(sql,values)=>{query={sql,values};return {rows:[]};}}}})('src/lib/admin-auth.ts');
 try{assert.equal(await auth.getAdminSession(),null);assert.match(query.sql,/created_at >= \$2/);assert.equal(query.values[1],process.env.ADMIN_SESSION_NOT_BEFORE);assert.ok(!query.sql.includes('DELETE'));}
 finally{if(previous===undefined)delete process.env.ADMIN_SESSION_NOT_BEFORE;else process.env.ADMIN_SESSION_NOT_BEFORE=previous;}
});

test('large upload concurrency limit rejects a second request and releases on completion',async()=>{
 const previous=process.env.UPLOAD_MAX_CONCURRENT;process.env.UPLOAD_MAX_CONCURRENT='1';
 let release;
 const wait=new Promise(resolve=>{release=resolve;});
 const route=loader({'@/lib/admin-auth':{isAdmin:async()=>true,auditLog:async()=>{}},'@/lib/backend-utils':{sameOriginAllowed:()=>true},'@/lib/upload-storage':{storageDriver:()=> 'supabase',UploadValidationError:class extends Error{},storeUpload:async()=>{await wait;return {fileName:'test.pdf',url:'/uploads/supabase/test.pdf'};}}})('src/app/api/admin/upload/route.ts');
 const request=()=>{const body=new FormData();body.set('file',new File(['%PDF-fixture'],'test.pdf'));return new Request('http://localhost/api/admin/upload',{method:'POST',body});};
 try{const first=route.POST(request());await new Promise(resolve=>setImmediate(resolve));const busy=await route.POST(request());assert.equal(busy.status,429);assert.equal(busy.headers.get('retry-after'),'5');release();assert.equal((await first).status,201);assert.equal((await route.POST(request())).status,201);}
 finally{release();if(previous===undefined)delete process.env.UPLOAD_MAX_CONCURRENT;else process.env.UPLOAD_MAX_CONCURRENT=previous;}
});
