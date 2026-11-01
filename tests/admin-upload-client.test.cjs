const test = require('node:test');
const assert = require('node:assert/strict');
const loader = require('./load-project.cjs');

function browser(fetch, Upload) {
  const previous = {fetch:global.fetch,window:global.window};
  const stored = new Map();
  global.window = {sessionStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)}};
  global.fetch = withLimits(fetch);
  const helper = loader({'tus-js-client':{Upload,isSupported:true}})('src/lib/admin-upload-client.ts');
  return {helper,stored,restore(){global.fetch=previous.fetch;if(previous.window===undefined)delete global.window;else global.window=previous.window;}};
}
const reply = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const uploadLimits = (driver='supabase',video=50*1024*1024) => ({driver,thresholdBytes:6*1024*1024,maxBytes:{cover:10*1024*1024,gallery:15*1024*1024,banner:15*1024*1024,document:50*1024*1024,audio:50*1024*1024,video}});
const withLimits = (fetch,limits=uploadLimits()) => (url,options) => url==='/api/admin/upload/limits'?Promise.resolve(reply(limits)):fetch(url,options);
const intent = (id='intent-a',size=7*1024*1024) => ({id,token:'short-lived-test-signature',endpoint:'https://project.storage.supabase.co/storage/v1/upload/resumable/sign',bucket:'private-ingress',path:`ingress/${id}.mp4`,expiresAt:new Date(Date.now()+60*60*1000).toISOString(),size,mime:'video/mp4'});
const media = () => new File([new Uint8Array(7*1024*1024)],'movie.mp4',{type:'video/mp4',lastModified:1234});

test('small uploads and images keep multipart compatibility; large media never falls back to the app',async()=>{
  let requests=0;
  const fixture=browser(async(url,options)=>{
    requests++;assert.equal(url,'/api/admin/upload');assert.equal(options.method,'POST');assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('kind'),'document');return reply({url:'/uploads/legacy/test.pdf'},201);
  },class {constructor(){assert.fail('TUS should not be used');}});
  try {
    assert.equal(fixture.helper.usesDirectUpload({size:6*1024*1024},'video'),false);
    assert.equal(fixture.helper.usesDirectUpload({size:6*1024*1024+1},'video'),true);
    assert.equal(fixture.helper.usesDirectUpload({size:15*1024*1024},'gallery'),false);
    assert.equal(await fixture.helper.uploadAdminFile(new File(['%PDF-1.7'],'book.pdf'),'document'),'/uploads/legacy/test.pdf');
    assert.equal(requests,1);
    global.fetch=withLimits(async(url)=>{assert.equal(url,'/api/admin/upload/sign');return reply({message:'Storage size limit'},413);});
    await assert.rejects(fixture.helper.uploadAdminFile(media(),'video'),/Storage size limit/);
    global.fetch=withLimits(async(url)=>{assert.equal(url,'/api/admin/upload/sign');return reply({message:'Conflicting upload intent',code:'OTHER_CONFLICT'},409);});
    await assert.rejects(fixture.helper.uploadAdminFile(media(),'video'),/Conflicting upload intent/);
    global.fetch=withLimits(async(url)=>{assert.equal(url,'/api/admin/upload/sign');return reply({message:'Cloud unavailable',code:'DIRECT_UPLOAD_UNAVAILABLE_LOCAL'},503);});
    await assert.rejects(fixture.helper.uploadAdminFile(media(),'video'),/Cloud unavailable/);
    assert.equal(requests,1);
  } finally {fixture.restore();}
});

test('large uploads use scoped signatures and 6 MiB TUS chunks then finalize without sending bytes to app',async()=>{
  const calls=[],progress=[];
  class FakeUpload {
    constructor(file,options){this.options=options;this.file=file;assert.equal(options.chunkSize,6*1024*1024);assert.equal(options.headers['x-signature'],'short-lived-test-signature');assert.equal(options.headers['x-upsert'],'false');assert.deepEqual(Object.keys(options.headers).sort(),['x-signature','x-upsert']);assert.equal(options.metadata.bucketName,'private-ingress');assert.equal(options.metadata.objectName,'ingress/intent-a.mp4');assert.equal(options.uploadDataDuringCreation,true);assert.equal(options.removeFingerprintOnSuccess,true);}
    async findPreviousUploads(){return [];}
    start(){this.options.onProgress(1024,this.file.size);this.options.onSuccess({});}
    async abort(){}
  }
  const fixture=browser(async(url,options)=>{
    calls.push(url);assert.equal(options.headers['Content-Type'],'application/json');const body=JSON.parse(options.body);
    if(url.endsWith('/sign')){assert.deepEqual(body,{kind:'video',fileName:'movie.mp4',mime:'video/mp4',size:7*1024*1024,documentType:'video'});return reply(intent());}
    assert.equal(url,'/api/admin/upload/finalize');assert.deepEqual(body,{id:'intent-a'});return reply({url:'/uploads/supabase/videos/movie.mp4'});
  },FakeUpload);
  try {
    assert.equal(await fixture.helper.uploadAdminFile(media(),'video',{documentType:'video',onProgress:value=>progress.push(value.phase)}),'/uploads/supabase/videos/movie.mp4');
    assert.deepEqual(calls,['/api/admin/upload/sign','/api/admin/upload/finalize']);
    assert.deepEqual(progress,['signing','uploading','finalizing']);assert.equal(fixture.stored.size,0);
  } finally {fixture.restore();}
});

test('interrupted transfer resumes only the same owned intent and never persists its signed token',async()=>{
  let attempts=0,resumed=0,signs=0;
  class FakeUpload {
    constructor(file,options){this.options=options;this.file=file;}
    async findPreviousUploads(){return this.options.urlStorage.findUploadsByFingerprint(await this.options.fingerprint());}
    resumeFromPreviousUpload(previous){resumed++;assert.equal(previous.uploadUrl,`${intent().endpoint}/unique-tus-resource`);}
    start(){void(async()=>{
      attempts++;
      if(attempts===1){await this.options.urlStorage.addUpload(await this.options.fingerprint(),{size:this.file.size,metadata:this.options.metadata,creationTime:new Date().toISOString(),uploadUrl:`${intent().endpoint}/unique-tus-resource`,parallelUploadUrls:null});this.options.onError(new Error('signed-URL-must-not-appear-in-UI'));}
      else this.options.onSuccess({});
    })();}
    async abort(){}
  }
  const fixture=browser(async(url,options)=>{
    if(url.endsWith('/sign')){signs++;const body=JSON.parse(options.body);if(signs===2)assert.equal(body.resumeId,'intent-a');return reply(intent());}
    return reply({url:'/uploads/supabase/videos/resumed.mp4'});
  },FakeUpload);
  try {
    const file=media();await assert.rejects(fixture.helper.uploadAdminFile(file,'video'),/Chọn lại cùng file/);
    assert.ok(fixture.stored.size>0);assert.ok(!Array.from(fixture.stored.values()).join('').includes('short-lived-test-signature'));
    assert.equal(await fixture.helper.uploadAdminFile(file,'video'),'/uploads/supabase/videos/resumed.mp4');
    assert.equal(resumed,1);assert.equal(signs,2);assert.equal(fixture.stored.size,0);
  } finally {fixture.restore();}
});

test('a previous upload URL from another host never receives a new signed credential',async()=>{
  let second=false,resumed=false;
  class FakeUpload {
    constructor(file,options){this.options=options;this.file=file;}
    async findPreviousUploads(){return this.options.urlStorage.findUploadsByFingerprint(await this.options.fingerprint());}
    resumeFromPreviousUpload(){resumed=true;}
    start(){void(async()=>{
      if(!second){await this.options.urlStorage.addUpload(await this.options.fingerprint(),{size:this.file.size,metadata:this.options.metadata,creationTime:new Date().toISOString(),uploadUrl:'https://attacker.example/tus/resource',parallelUploadUrls:null});this.options.onError(new Error('network'));}
      else this.options.onSuccess({});
    })();}
    async abort(){}
  }
  const fixture=browser(async(url)=>url.endsWith('/sign')?reply(intent()):reply({url:'/uploads/supabase/videos/safe.mp4'}),FakeUpload);
  try {
    const file=media();await assert.rejects(fixture.helper.uploadAdminFile(file,'video'));second=true;
    assert.equal(await fixture.helper.uploadAdminFile(file,'video'),'/uploads/supabase/videos/safe.mp4');assert.equal(resumed,false);
  } finally {fixture.restore();}
});

test('retry after transfer success and failed finalize verifies existing private object instead of re-uploading',async()=>{
  let transfers=0,signs=0,finalizations=0;
  class FakeUpload {
    constructor(file,options){this.options=options;}
    async findPreviousUploads(){return [];}
    start(){transfers++;this.options.onSuccess({});}
    async abort(){}
  }
  const fixture=browser(async(url,options)=>{
    if(url.endsWith('/sign')){
      signs++;
      if(signs===2){assert.equal(JSON.parse(options.body).resumeId,'intent-a');return reply({...intent(),uploaded:true});}
      return reply(intent());
    }
    finalizations++;
    return finalizations===1?reply({message:'Temporary finalization failure'},503):reply({url:'/uploads/supabase/videos/finalized.mp4'});
  },FakeUpload);
  try {
    const file=media();
    await assert.rejects(fixture.helper.uploadAdminFile(file,'video'),/Temporary finalization failure/);
    assert.ok(fixture.stored.size>0);
    assert.equal(await fixture.helper.uploadAdminFile(file,'video'),'/uploads/supabase/videos/finalized.mp4');
    assert.equal(transfers,1);assert.equal(signs,2);assert.equal(finalizations,2);assert.equal(fixture.stored.size,0);
  } finally {fixture.restore();}
});

test('signed transfer rejects the ordinary JWT-authenticated TUS endpoint',async()=>{
  const fixture=browser(async(url)=>{
    assert.equal(url,'/api/admin/upload/sign');
    return reply({...intent(),endpoint:'https://project.storage.supabase.co/storage/v1/upload/resumable'});
  },class {constructor(){assert.fail('the ordinary authenticated TUS route must not receive signed uploads');}});
  try {await assert.rejects(fixture.helper.uploadAdminFile(media(),'video'),/Địa chỉ Storage không hợp lệ/);}
  finally {fixture.restore();}
});

test('explicit authenticated local-provider response keeps large legacy uploads working',async()=>{
  const calls=[],progress=[];
  const fixture=browser(async(url,options)=>{
    calls.push(url);
    if(url.endsWith('/sign'))return reply({message:'Local upload provider',code:'DIRECT_UPLOAD_UNAVAILABLE_LOCAL'},409);
    assert.equal(url,'/api/admin/upload');assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('kind'),'video');assert.equal(options.body.get('file').size,7*1024*1024);
    return reply({url:'/uploads/videos/local-only.mp4'},201);
  },class {constructor(){assert.fail('local provider must use its legacy uploader');}});
  try {
    assert.equal(await fixture.helper.uploadAdminFile(media(),'video',{onProgress:event=>progress.push(event)}),'/uploads/videos/local-only.mp4');
    assert.deepEqual(calls,['/api/admin/upload/sign','/api/admin/upload']);
    assert.deepEqual(progress,[{phase:'signing'},{phase:'uploading',direct:false}]);
  } finally {fixture.restore();}
});

test('50 MiB plus one byte is rejected before file sampling, signing, TUS, or multipart bytes',async()=>{
  const calls=[],seenLimits=[];
  const fixture=browser(()=>assert.fail('only the limits endpoint may be called'),class {constructor(){assert.fail('TUS must not start');}});
  global.fetch=async(url)=>{calls.push(url);assert.equal(url,'/api/admin/upload/limits');return reply(uploadLimits());};
  try {
    const file={name:'oversize.mp4',type:'video/mp4',size:50*1024*1024+1,lastModified:1,slice(){assert.fail('do not read oversize file bytes');}};
    await assert.rejects(fixture.helper.uploadAdminFile(file,'video',{onLimits:limits=>seenLimits.push(limits)}),/50 MiB.*nén video.*nâng cấp gói Supabase Storage/);
    assert.deepEqual(calls,['/api/admin/upload/limits']);assert.equal(seenLimits[0].maxBytes.video,50*1024*1024);
    assert.equal(fixture.stored.size,0);
  } finally {fixture.restore();}
});

test('exact API limit is allowed and future higher server limits require no frontend hardcoded cap',async()=>{
  let transfers=0,slices=0;
  class FakeUpload {
    constructor(file,options){this.options=options;}
    async findPreviousUploads(){return [];}
    start(){transfers++;this.options.onSuccess({});}
    async abort(){}
  }
  const fixture=browser(()=>assert.fail('test installs an exact policy fetch'),FakeUpload);
  try {
    for(const [size,cap] of [[50*1024*1024,50*1024*1024],[64*1024*1024,96*1024*1024]]){
      const calls=[];
      global.fetch=async(url,options)=>{
        calls.push(url);
        if(url.endsWith('/limits'))return reply(uploadLimits('supabase',cap));
        if(url.endsWith('/sign')){assert.equal(JSON.parse(options.body).size,size);return reply(intent('intent-boundary',size));}
        assert.equal(url,'/api/admin/upload/finalize');return reply({url:'/uploads/supabase/videos/allowed.mp4'});
      };
      const file={name:'boundary.mp4',type:'video/mp4',size,lastModified:1,slice(start,end){slices++;assert.ok(end-start<=64*1024 || end===undefined);return new Blob([new Uint8Array(64*1024)]);}};
      assert.equal(await fixture.helper.uploadAdminFile(file,'video'),'/uploads/supabase/videos/allowed.mp4');
      assert.deepEqual(calls,['/api/admin/upload/limits','/api/admin/upload/sign','/api/admin/upload/finalize']);
    }
    assert.equal(transfers,2);assert.equal(slices,4);
  } finally {fixture.restore();}
});

test('lower bucket or policy limits for PDF, audio and video are honored before any file bytes',async()=>{
  const fixture=browser(()=>assert.fail('only limits metadata may be fetched'),class {constructor(){assert.fail('TUS must not start');}});
  try {
    const caps=uploadLimits();Object.assign(caps.maxBytes,{document:20*1024*1024,audio:32*1024*1024,video:48*1024*1024});
    global.fetch=async(url)=>{assert.equal(url,'/api/admin/upload/limits');return reply(caps);};
    for(const [kind,expected] of [['document',20],['audio',32],['video',48]]){
      const file={size:expected*1024*1024+1,slice(){assert.fail('no bytes from an oversize file');}};
      await assert.rejects(fixture.helper.uploadAdminFile(file,kind),new RegExp(`${expected} MiB`));
    }
    assert.equal(fixture.stored.size,0);
  } finally {fixture.restore();}
});

test('tampered parallel TUS URLs cannot receive a signature through a valid primary resource',async()=>{
  let second=false,resumed=false;
  class FakeUpload {
    constructor(file,options){this.options=options;this.file=file;}
    async findPreviousUploads(){return this.options.urlStorage.findUploadsByFingerprint(await this.options.fingerprint());}
    resumeFromPreviousUpload(){resumed=true;assert.fail('parallel records are not part of this uploader');}
    start(){void(async()=>{
      if(!second){await this.options.urlStorage.addUpload(await this.options.fingerprint(),{size:this.file.size,metadata:this.options.metadata,creationTime:new Date().toISOString(),uploadUrl:`${intent().endpoint}/valid-primary`,parallelUploadUrls:['https://attacker.example/upload']});this.options.onError(new Error('network'));}
      else this.options.onSuccess({});
    })();}
    async abort(){}
  }
  const fixture=browser(async(url)=>url.endsWith('/sign')?reply(intent()):reply({url:'/uploads/supabase/videos/nonparallel.mp4'}),FakeUpload);
  try {
    const file=media();await assert.rejects(fixture.helper.uploadAdminFile(file,'video'));second=true;
    assert.equal(await fixture.helper.uploadAdminFile(file,'video'),'/uploads/supabase/videos/nonparallel.mp4');assert.equal(resumed,false);
  } finally {fixture.restore();}
});

test('local provider limits retain larger existing media sizes independently from cloud defaults',async()=>{
  const calls=[];
  const fixture=browser(()=>assert.fail('test installs a local policy fetch'),class {constructor(){assert.fail('local provider cannot invoke TUS');}});
  global.fetch=withLimits(async(url,options)=>{
    calls.push(url);
    if(url.endsWith('/sign'))return reply({message:'Local upload provider',code:'DIRECT_UPLOAD_UNAVAILABLE_LOCAL'},409);
    assert.equal(url,'/api/admin/upload');assert.ok(options.body instanceof FormData);
    return reply({url:'/uploads/videos/legacy-large.mp4'},201);
  },uploadLimits('local',500*1024*1024));
  try {
    // Only declared metadata is needed to exercise the provider choice; do not allocate 51 MiB fixture bytes.
    const file=new File([new Uint8Array(64*1024)],'legacy.mp4',{type:'video/mp4',lastModified:1});
    Object.defineProperty(file,'size',{value:51*1024*1024});
    assert.equal(await fixture.helper.uploadAdminFile(file,'video'),'/uploads/videos/legacy-large.mp4');
    assert.deepEqual(calls,['/api/admin/upload/sign','/api/admin/upload']);
  } finally {fixture.restore();}
});
