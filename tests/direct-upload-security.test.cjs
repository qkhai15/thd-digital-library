const test = require('node:test');
const assert = require('node:assert/strict');
const loader = require('./load-project.cjs');

const ID = '12345678-1234-4123-8123-123456789abc';
const OWNER = {username:'test-admin',token_hash:'test-owner-session-hash'};
const METADATA = {kind:'video',documentType:'video',fileName:'school-video.mp4',size:32*1024*1024,mime:'video/mp4'};
const ENV = {STORAGE_DRIVER:'supabase',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_SECRET_KEY:'test-server-secret-never-public',SUPABASE_STORAGE_BUCKET:'test-public-media',SUPABASE_UPLOAD_BUCKET:'test-private-quarantine',UPLOAD_MEDIA_MAX_MIB:'50'};

async function withEnvironment(run) {
  const saved = Object.fromEntries(Object.keys(ENV).map(key=>[key,process.env[key]]));
  Object.assign(process.env,ENV);
  try { return await run(); }
  finally { for (const [key,value] of Object.entries(saved)) { if(value===undefined)delete process.env[key];else process.env[key]=value; } }
}

function fixtureIntent(overrides={}) {
  return {id:ID,owner_token_hash:OWNER.token_hash,username:OWNER.username,kind:'video',document_type:'video',original_name:METADATA.fileName,expected_size:String(METADATA.size),expected_mime:METADATA.mime,source_bucket:ENV.SUPABASE_UPLOAD_BUCKET,source_key:`pending/${ID}/12345678-1234-4123-8123-123456789def.mp4`,destination_bucket:ENV.SUPABASE_STORAGE_BUCKET,destination_key:'videos/2026/10/12345678-1234-4123-8123-123456789def.mp4',status:'pending',expires_at:new Date(Date.now()+60000),result:null,...overrides};
}

function harness(options={}) {
  const calls={sdk:0,sql:[],signed:[],copied:[],released:0,info:[],capacity:[]};
  let intent=options.intent;
  const connection={
    async query(sql,values=[]) {
      calls.sql.push({sql,values});
      if(sql.includes('SELECT * FROM storage_upload_intents'))return {rows:intent?[intent]:[]};
      if(sql.includes('COUNT(*) FILTER'))return {rows:[options.quota||{active:'0',daily:'0',bytes:'0'}]};
      if(sql.includes('INSERT INTO storage_upload_intents')) {
        const [id,owner_token_hash,username,kind,document_type,original_name,expected_size,expected_mime,source_bucket,source_key,destination_bucket,destination_key]=values;
        intent={id,owner_token_hash,username,kind,document_type,original_name,expected_size,expected_mime,source_bucket,source_key,destination_bucket,destination_key,status:'pending',expires_at:new Date(Date.now()+7200000),result:null};
        return {rows:[intent]};
      }
      if(sql.includes("SET status='rejected'"))intent={...intent,status:'rejected'};
      if(sql.includes("SET status='completed'"))intent={...intent,status:'completed',result:JSON.parse(values[1])};
      return {rows:[],rowCount:1};
    },
    release(){calls.released++;},
  };
  const client={storage:{
    async getBucket(bucket){return {data:{id:bucket,public:bucket===ENV.SUPABASE_UPLOAD_BUCKET ? options.publicQuarantine??false : true,file_size_limit:options.bucketLimit??null},error:null};},
    from(bucket){return {
      async createSignedUploadUrl(key,config){calls.signed.push({bucket,key,config});return {data:{token:'test-scoped-upload-capability'},error:null};},
      async info(key){calls.info.push({bucket,key});if(options.missingSource&&bucket===ENV.SUPABASE_UPLOAD_BUCKET)return {data:null,error:{status:404}};return {data:options.metadataByBucket?.[bucket]||options.objectMetadata||{size:Number(intent.expected_size),contentType:intent.expected_mime},error:null};},
      async createSignedUrl(key,expiry){assert.equal(expiry,60);return {data:{signedUrl:`${ENV.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${key}?token=test-read-token`},error:null};},
      async copy(source,destination,config){calls.copied.push({bucket,source,destination,config});return {data:{},error:options.copyError||null};},
    };},
  }};
  const api=loader({'server-only':{},'@/lib/storage-capacity':{storageCapacityAvailable:async bytes=>{calls.capacity.push(bytes);return options.capacityAvailable??true;},storageFullMessage:'Storage không đủ dung lượng.'},'@supabase/supabase-js':{createClient(url,secret){calls.sdk++;assert.equal(url,ENV.SUPABASE_URL);assert.equal(secret,ENV.SUPABASE_SECRET_KEY);return client;}},'@/lib/db':{ensureSchema:async()=>{},db:{connect:async()=>connection}}})('src/lib/direct-upload.ts');
  return {api,calls,getIntent:()=>intent};
}

test('insufficient project capacity refuses a new signed upload before intent or token creation',async()=>{
  await withEnvironment(async()=>{
    const {api,calls}=harness({capacityAvailable:false});
    await assert.rejects(api.signDirectUpload(METADATA,OWNER),error=>error.status===507&&error.message.includes('Storage'));
    assert.equal(calls.signed.length,0); assert.ok(!calls.sql.some(call=>call.sql.includes('INSERT INTO')));
    assert.deepEqual(calls.capacity,[METADATA.size*2]);
    assert.ok(calls.sql.some(call=>call.sql==='ROLLBACK')); assert.equal(calls.released,1);
  });
});

async function withSignature(bytes,run) {
  const previous=global.fetch;
  let cancelled=0;
  global.fetch=async(url,options)=>{
    assert.ok(url.startsWith(`${ENV.SUPABASE_URL}/storage/v1/object/sign/`));
    assert.equal(options.headers.Range,'bytes=0-63');
    assert.equal(options.redirect,'error');
    const prefix=Buffer.alloc(64);
    bytes.copy(prefix,0,0,64);
    return new Response(new ReadableStream({start(controller){controller.enqueue(prefix);},cancel(){cancelled++;}}),{status:206});
  };
  try{return await run(()=>cancelled);}
  finally{global.fetch=previous;}
}

test('direct signing and finalize require Admin and same origin before reading metadata or issuing capabilities',async()=>{
  let session=null;
  let processed=0;
  const load=loader({'@/lib/admin-auth':{getAdminSession:async()=>session},'@/lib/upload-storage':{storageDriver:()=> 'supabase',UploadValidationError:class extends Error{}},'@/lib/direct-upload':{directUploadJson:async()=>{processed++;return METADATA;},signDirectUpload:async()=>({token:'scoped'}),finalizeDirectUpload:async()=>({url:'/uploads/supabase/test.mp4'})},'server-only':{}});
  const routes=['src/app/api/admin/upload/sign/route.ts','src/app/api/admin/upload/finalize/route.ts'].map(file=>load(file));
  for(const route of routes){
    const request=origin=>new Request('http://localhost:3000/api/admin/upload/sign',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(METADATA)});
    assert.equal((await route.POST(request('http://localhost:3000'))).status,401);
    session=OWNER;
    assert.equal((await route.POST(request('https://foreign.example'))).status,403);
    assert.equal(processed,0);
    const approved=await route.POST(request('http://localhost:3000'));
    assert.ok([200,201].includes(approved.status));
    assert.equal(approved.headers.get('cache-control'),'no-store');
    processed=0;session=null;
  }
});

test('authenticated same-origin local provider returns an explicit fallback code without issuing a capability',async()=>{
  let session=null,processed=0;
  const route=loader({
    '@/lib/admin-auth':{getAdminSession:async()=>session},
    '@/lib/upload-storage':{storageDriver:()=> 'local',UploadValidationError:class extends Error{}},
    '@/lib/direct-upload':{directUploadJson:async()=>{processed++;return METADATA;},signDirectUpload:async()=>{throw new Error('A local provider must never issue a Storage capability');}},
  })('src/app/api/admin/upload/sign/route.ts');
  const request=origin=>new Request('http://localhost:3000/api/admin/upload/sign',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(METADATA)});
  assert.equal((await route.POST(request('http://localhost:3000'))).status,401);
  session=OWNER;
  assert.equal((await route.POST(request('https://foreign.example'))).status,403);
  const response=await route.POST(request('http://localhost:3000'));
  assert.equal(response.status,409);
  assert.equal((await response.json()).code,'DIRECT_UPLOAD_UNAVAILABLE_LOCAL');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(processed,0);
});

test('direct upload validates category, extension, MIME, size and unsafe filenames without trusting a supplied storage path',async()=>{
  await withEnvironment(async()=>{
    const {api,calls,getIntent}=harness();
    for(const invalid of [
      {kind:'__proto__'}, {documentType:'sach-noi'}, {fileName:'../video.mp4'}, {fileName:'folder\\video.mp4'}, {fileName:' video.mp4'}, {fileName:'bad\u0000.mp4'},
      {fileName:'image.jpg'}, {mime:'application/pdf'}, {size:0}, {size:Infinity}, {size:'32'}, {size:500*1024*1024+1}, {resumeId:'../foreign'},
    ])assert.throws(()=>api.validateDirectUpload({...METADATA,...invalid}));
    const signed=await api.signDirectUpload({...METADATA,path:'../../existing.mp4',bucket:'existing-bucket'},OWNER);
    assert.match(signed.path,/^pending\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/);
    assert.equal(signed.bucket,ENV.SUPABASE_UPLOAD_BUCKET);
    assert.equal(signed.token,'test-scoped-upload-capability');
    assert.ok(!JSON.stringify(signed).includes(ENV.SUPABASE_SECRET_KEY));
    assert.equal(calls.signed[0].config.upsert,false);
    assert.notEqual(getIntent().destination_key,signed.path);
    assert.match(getIntent().destination_key,/^videos\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.mp4$/);
    assert.ok(calls.sql.some(call=>call.sql.includes('pg_advisory_xact_lock')));
    assert.ok(calls.sql.every(call=>!call.sql.includes('library_items')));
  });
});

test('daily quota and a public quarantine bucket deny signed upload capability',async()=>{
  await withEnvironment(async()=>{
    for(const quota of [{active:'4',daily:'0',bytes:'0'},{active:'0',daily:'30',bytes:'0'},{active:'0',daily:'0',bytes:String(3*1024**3)}]){
      const {api,calls}=harness({quota});
      await assert.rejects(api.signDirectUpload(METADATA,OWNER),error=>error.status===429);
      assert.equal(calls.signed.length,0);
      assert.ok(calls.sql.some(call=>call.sql==='ROLLBACK'));
    }
    const {api,calls}=harness({publicQuarantine:true});
    await assert.rejects(api.signDirectUpload(METADATA,OWNER),error=>error.status===503);
    assert.equal(calls.signed.length,0);
  });
});

test('scoped upload tokens target the signed TUS route rather than the Auth JWT route',async()=>{
  await withEnvironment(async()=>{
    const {api}=harness();
    const signed=await api.signDirectUpload(METADATA,OWNER);
    assert.equal(signed.endpoint,'https://test-project.storage.supabase.co/storage/v1/upload/resumable/sign');
    assert.equal(new URL(signed.endpoint).pathname,'/storage/v1/upload/resumable/sign');
    assert.notEqual(new URL(signed.endpoint).pathname,'/storage/v1/upload/resumable');
  });
});

test('bucket size caps reject metadata before reserving an intent or issuing a capability',async()=>{
  await withEnvironment(async()=>{
    const {api,calls}=harness({bucketLimit:16*1024*1024});
    await assert.rejects(api.signDirectUpload(METADATA,OWNER),error=>error.status===413);
    assert.equal(calls.sql.length,0);
    assert.equal(calls.signed.length,0);
  });
});

test('Free-plan overflow is rejected before creating a privileged SDK client or querying the database',async()=>{
  await withEnvironment(async()=>{
    for(const size of [50*1024*1024+1,64*1024*1024,128*1024*1024]){
      const {api,calls}=harness();
      await assert.rejects(api.signDirectUpload({...METADATA,size},OWNER),error=>error.status===413);
      assert.equal(calls.sdk,0);
      assert.equal(calls.sql.length,0);
      assert.equal(calls.signed.length,0);
    }
    process.env.UPLOAD_MEDIA_MAX_MIB='80';
    const upgraded=harness();
    const signed=await upgraded.api.signDirectUpload({...METADATA,size:64*1024*1024},OWNER);
    assert.equal(signed.size,64*1024*1024);
    assert.equal(upgraded.calls.signed.length,1);
    const stillBucketCapped=harness({bucketLimit:50*1024*1024});
    await assert.rejects(stillBucketCapped.api.signDirectUpload({...METADATA,size:64*1024*1024},OWNER),error=>error.status===413);
    assert.equal(stillBucketCapped.calls.signed.length,0);
  });
});

test('upload limits require Admin and expose only public policy metadata, preserving explicit local-provider limits',async()=>{
  await withEnvironment(async()=>{
    const {api,calls}=harness({bucketLimit:48*1024*1024});
    let session=null;
    const route=loader({'server-only':{},'@/lib/admin-auth':{getAdminSession:async()=>session},'@/lib/direct-upload':api})('src/app/api/admin/upload/limits/route.ts');
    assert.equal((await route.GET()).status,401);
    assert.equal(calls.sdk,0);
    session=OWNER;
    const response=await route.GET();
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const limits=await response.json();
    assert.deepEqual(Object.keys(limits).sort(),['driver','maxBytes','thresholdBytes']);
    assert.equal(limits.driver,'supabase');
    assert.equal(limits.maxBytes.video,48*1024*1024);
    assert.equal(limits.maxBytes.audio,48*1024*1024);
    assert.equal(limits.maxBytes.document,48*1024*1024);
    assert.ok(!JSON.stringify(limits).includes(ENV.SUPABASE_SECRET_KEY));
    assert.ok(!JSON.stringify(limits).includes(OWNER.token_hash));
    process.env.STORAGE_DRIVER='local';
    const sdkBeforeLocal=calls.sdk;
    const local=await api.getAdminUploadLimits();
    assert.equal(local.driver,'local');
    assert.deepEqual([local.maxBytes.document,local.maxBytes.audio,local.maxBytes.video],[80,150,500].map(mib=>mib*1024*1024));
    assert.equal(calls.sdk,sdkBeforeLocal);
    assert.equal(calls.sql.length,0);
  });
});

test('pending finalize obeys current environment and bucket caps while completed legacy uploads remain readable',async()=>{
  await withEnvironment(async()=>{
    for(const options of [{intent:fixtureIntent({expected_size:String(64*1024*1024)})},{intent:fixtureIntent(),bucketLimit:16*1024*1024}]){
      const {api,calls,getIntent}=harness(options);
      await assert.rejects(api.finalizeDirectUpload(ID,OWNER),error=>error.status===413);
      assert.equal(calls.copied.length,0);
      assert.equal(calls.info.length,0);
      assert.equal(getIntent().status,'rejected');
    }
    const result={url:'/uploads/supabase/videos/legacy-64.mp4',fileName:'legacy-64.mp4',size:64*1024*1024,mime:'video/mp4',driver:'supabase'};
    const {api,calls}=harness({intent:fixtureIntent({status:'completed',expected_size:String(result.size),result})});
    assert.deepEqual(await api.finalizeDirectUpload(ID,OWNER),result);
    assert.equal(calls.copied.length,0);
    assert.equal(calls.info.length,0);
  });
});

test('resuming a capability is scoped to the original session and exact file metadata',async()=>{
  await withEnvironment(async()=>{
    for(const override of [{owner_token_hash:'foreign-session'},{expires_at:new Date(Date.now()-1)},{status:'rejected'},{expected_size:String(METADATA.size+1)},{source_key:'../unsafe'}]){
      const {api,calls}=harness({intent:fixtureIntent(override)});
      await assert.rejects(api.signDirectUpload({...METADATA,resumeId:ID},OWNER));
      assert.equal(calls.signed.length,0);
    }
    const {api,calls}=harness({intent:fixtureIntent(),missingSource:true});
    assert.equal((await api.signDirectUpload({...METADATA,resumeId:ID},OWNER)).id,ID);
    assert.equal(calls.signed.length,1);
    assert.ok(!calls.sql.some(call=>call.sql.includes('INSERT INTO storage_upload_intents')));
  });
});

test('owned resume detects an already uploaded private object without issuing another capability, then still validates finalize',async()=>{
  await withEnvironment(async()=>{
    const {api,calls,getIntent}=harness({intent:fixtureIntent(),objectMetadata:{size:METADATA.size+1,contentType:METADATA.mime}});
    const resumed=await api.signDirectUpload({...METADATA,resumeId:ID},OWNER);
    assert.equal(resumed.id,ID);
    assert.equal(resumed.uploaded,true);
    assert.equal(resumed.token,undefined);
    assert.equal(calls.signed.length,0);
    assert.equal(calls.copied.length,0);
    await assert.rejects(api.finalizeDirectUpload(ID,OWNER),error=>error.status===413);
    assert.equal(getIntent().status,'rejected');
    assert.equal(calls.copied.length,0);
  });
});

test('metadata-only endpoints cap actual chunked bytes and cancel oversized streams',async()=>{
  const {api}=harness();
  let cancelled=0;
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"padding":"'));controller.enqueue(new Uint8Array(9000));},cancel(){cancelled++;}});
  const request=new Request('http://localhost/api/admin/upload/sign',{method:'POST',headers:{'content-type':'application/json','content-length':'1'},body:stream,duplex:'half'});
  await assert.rejects(api.directUploadJson(request),error=>error.status===413);
  assert.equal(cancelled,1);
  for(const body of ['[]','null','invalid-json'])await assert.rejects(api.directUploadJson(new Request('http://localhost/api/admin/upload/sign',{method:'POST',headers:{'content-type':'application/json'},body})),error=>error.status===400);
  await assert.rejects(api.directUploadJson(new Request('http://localhost/api/admin/upload/sign',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'})),error=>error.status===415);
});

test('finalize refuses another session before contacting Storage and never publishes mismatched size, MIME or signature',async()=>{
  await withEnvironment(async()=>{
    const foreign=harness({intent:fixtureIntent({owner_token_hash:'another-session'})});
    await assert.rejects(foreign.api.finalizeDirectUpload(ID,OWNER),error=>error.status===404);
    assert.equal(foreign.calls.info.length,0);
    assert.equal(foreign.calls.copied.length,0);
    for(const objectMetadata of [{size:METADATA.size+1,contentType:METADATA.mime},{size:METADATA.size,contentType:'application/pdf'}]){
      const {api,calls,getIntent}=harness({intent:fixtureIntent(),objectMetadata});
      await assert.rejects(api.finalizeDirectUpload(ID,OWNER),error=>[413,415].includes(error.status));
      assert.equal(calls.copied.length,0);
      assert.equal(getIntent().status,'rejected');
      assert.ok(calls.sql.some(call=>call.sql==='COMMIT'));
    }
    await withSignature(Buffer.from('%PDF-1.7 invalid video fixture'),async()=>{
      const {api,calls,getIntent}=harness({intent:fixtureIntent()});
      await assert.rejects(api.finalizeDirectUpload(ID,OWNER),error=>error.status===415);
      assert.equal(calls.copied.length,0);
      assert.equal(getIntent().status,'rejected');
    });
  });
});

test('valid finalize copies across buckets, stores metadata only, and is idempotent after a lost response',async()=>{
  await withEnvironment(async()=>{
    await withSignature(Buffer.from('0000ftypisom-valid-video-signature'),async getCancelled=>{
      const {api,calls}=harness({intent:fixtureIntent()});
      const first=await api.finalizeDirectUpload(ID,OWNER);
      assert.equal(first.url,`/uploads/supabase/${fixtureIntent().destination_key}`);
      assert.equal(calls.copied.length,1);
      assert.deepEqual(calls.copied[0].config,{destinationBucket:ENV.SUPABASE_STORAGE_BUCKET});
      assert.equal(calls.copied[0].bucket,ENV.SUPABASE_UPLOAD_BUCKET);
      assert.ok(calls.sql.some(call=>call.sql.includes('FOR UPDATE')));
      const stored=calls.sql.find(call=>call.sql.includes("SET status='completed'"));
      assert.deepEqual(JSON.parse(stored.values[1]),first);
      assert.ok(!stored.values[1].includes('test-read-token'));
      assert.ok(!stored.values[1].includes(ENV.SUPABASE_SECRET_KEY));
      assert.equal(getCancelled(),1);
      assert.deepEqual(await api.finalizeDirectUpload(ID,OWNER),first);
      assert.equal(calls.copied.length,1);
      assert.equal(calls.sql.filter(call=>call.sql.includes('INSERT INTO audit_logs')).length,1);
      assert.ok(calls.sql.every(call=>!call.sql.includes('library_items')));
    });
  });
});

test('finalize can recover the immutable destination after copy succeeded but database commit was lost',async()=>{
  await withEnvironment(async()=>{
    await withSignature(Buffer.from('0000ftypisom-valid-video-signature'),async()=>{
      const {api,calls}=harness({intent:fixtureIntent(),copyError:{statusCode:'409'}});
      const result=await api.finalizeDirectUpload(ID,OWNER);
      assert.equal(result.size,METADATA.size);
      assert.equal(calls.info.length,2);
      assert.equal(calls.info[1].bucket,ENV.SUPABASE_STORAGE_BUCKET);
    });
  });
});

test('copy recovery accepts matching content when Storage changes multipart ETag during the server-side copy',async()=>{
  await withEnvironment(async()=>{
    await withSignature(Buffer.from('0000ftypisom-valid-video-signature'),async()=>{
      const metadata={size:METADATA.size,contentType:METADATA.mime};
      const {api,calls}=harness({intent:fixtureIntent(),copyError:{statusCode:'409'},metadataByBucket:{
        [ENV.SUPABASE_UPLOAD_BUCKET]:{...metadata,etag:'80e2b571c3aa9fe5479dcc7e1e4b67f1-6'},
        [ENV.SUPABASE_STORAGE_BUCKET]:{...metadata,etag:'f055606990943d214059018987a92283'},
      }});
      const result=await api.finalizeDirectUpload(ID,OWNER);
      assert.equal(result.size,METADATA.size);
      assert.equal(calls.copied.length,1);
      assert.equal(calls.info.length,2);
      assert.ok(calls.sql.some(call=>call.sql.includes("SET status='completed'")));
    });
  });
});

test('signature check retains only 64 bytes and cancels when Storage ignores the Range header',async()=>{
  const previous=global.fetch;
  let cancelled=false;
  global.fetch=async(_url,options)=>{
    assert.equal(options.headers.Range,'bytes=0-63');
    return new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.alloc(1024*1024,7));},cancel(){cancelled=true;}}),{status:200});
  };
  try{
    const {api}=harness();
    const prefix=await api.readSignaturePrefix('https://test-project.supabase.co/test-signed-path');
    assert.equal(prefix.byteLength,64);
    assert.equal(cancelled,true);
  }finally{global.fetch=previous;}
});

test('additive upload schema migration revokes browser roles and replay leaves existing data unchanged',async()=>{
  const {migrateSchema,SCHEMA_VERSION}=await import('../scripts/schema.mjs');
  assert.ok(SCHEMA_VERSION>=2);
  for(const complete of [false,true]){
    const queries=[];
    let released=0;
    const connection={query:async(sql)=>{queries.push(sql);if(sql.includes('WHERE version=$1'))return {rowCount:complete?1:0};if(sql.includes('WHERE version=1'))return {rowCount:1};if(sql.includes('WHERE version=2'))return {rowCount:0};if(sql.includes('FROM pg_roles'))return {rowCount:1};return {rowCount:1};},release(){released++;}};
    await migrateSchema({connect:async()=>connection});
    assert.equal(released,1);
    assert.equal(queries.at(-1),'COMMIT');
    // FK declarations may say ON DELETE; no destructive statement may execute.
    assert.ok(!queries.some(sql=>/(?:^|;)\s*(DROP|TRUNCATE|DELETE)\b/.test(sql)));
    if(complete)assert.ok(!queries.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS storage_upload_intents')));
    else{
      assert.ok(queries.some(sql=>sql.includes('ALTER TABLE storage_upload_intents ENABLE ROW LEVEL SECURITY')));
      for(const role of ['PUBLIC','anon','authenticated'])assert.ok(queries.some(sql=>sql.includes(`REVOKE ALL ON storage_upload_intents FROM ${role}`)));
      assert.ok(!queries.some(sql=>/\bUPDATE\s+(library_items|admin_sessions|news_posts)\b/.test(sql)));
    }
  }
});
