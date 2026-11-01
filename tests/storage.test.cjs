const test = require('node:test');
const assert = require('node:assert/strict');
const samples = { 'test-1.jpg':Buffer.from([255,216,255,...Array(20).fill(0)]), 'test-2.jpg':Buffer.from([255,216,255,...Array(20).fill(1)]), 'test.pdf':Buffer.from('%PDF-1.7\nfixture'), 'test.wav':Buffer.from('RIFF0000WAVEfixture'), 'test.mp4':Buffer.from('0000ftypisomfixture') };
const loader = require('./load-project.cjs');

test('server Storage validates all media, streams with no overwrite, and never leaks secrets', async () => {
  const names = ['STORAGE_DRIVER','SUPABASE_URL','SUPABASE_STORAGE_BUCKET','SUPABASE_SERVICE_ROLE_KEY'];
  const previous = Object.fromEntries(names.map(name => [name,process.env[name]]));
  Object.assign(process.env,{STORAGE_DRIVER:'supabase',SUPABASE_URL:'https://project.supabase.co',SUPABASE_STORAGE_BUCKET:'library-media',SUPABASE_SERVICE_ROLE_KEY:'secret-only-server'});
  let calls = 0;
  const storage = loader({'server-only':{},'@supabase/supabase-js':{createClient(url,secret,options) {
    assert.equal(url,'https://project.supabase.co'); assert.equal(secret,'secret-only-server'); assert.equal(options.auth.persistSession,false);
    return {storage:{from(bucket) { assert.equal(bucket,'library-media'); return {async upload(key,stream,opts) {
      calls++; assert.match(key,/^[a-z]+\/\d{4}\/\d{2}\/[a-f0-9-]{36}\.[a-z0-9]+$/);
      assert.equal(opts.upsert,false); assert.equal(opts.duplex,'half'); assert.ok(opts.contentType);
      assert.ok((await new Response(stream).arrayBuffer()).byteLength > 0); return {error:null};
    } }; } } };
  }}})('src/lib/upload-storage.ts');
  try {
    const inputs = [['cover','test-1.jpg'],['gallery','test-2.jpg'],['banner','test-1.jpg'],['document','test.pdf'],['audio','test.wav'],['video','test.mp4']];
    const urls = new Set();
    for (const [kind,name] of inputs) {
      const result = await storage.storeUpload(new File([samples[name]],name,{type:'application/octet-stream'}),kind);
      assert.ok(result.url.startsWith('/uploads/supabase/')); assert.ok(!JSON.stringify(result).includes('secret-only-server'));
      urls.add(result.url);
    }
    assert.equal(urls.size,6); assert.equal(calls,6);
    await assert.rejects(storage.storeUpload(new File([samples['test.pdf']],'disguised.jpg',{type:'image/jpeg'}),'document'),e=>e.status===415);
    await assert.rejects(storage.storeUpload(new File([samples['test.pdf']],'document.pdf',{type:'image/jpeg'}),'document'),e=>e.status===415);
    await assert.rejects(storage.storeUpload(new File(['not a PDF'],'a.pdf',{type:'application/pdf'}),'document'),e=>e.status===415);
    await assert.rejects(storage.storeUpload(new File([''],'a.pdf'),'document'));
    await assert.rejects(storage.storeUpload(new File(['anything'],'a.pdf'),'__proto__'));
    await assert.rejects(storage.storeUpload({size:80*1024*1024+1},'document'));
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await assert.rejects(storage.storeUpload(new File([samples['test.pdf']],'a.pdf'),'document'));
    assert.equal(calls,6);
    assert.throws(()=>storage.storagePublicUrl('../secret'));
    assert.throws(()=>storage.storagePublicUrl('covers//x.jpg'));
    assert.equal(storage.storagePublicUrl('covers/a.jpg'),'https://project.supabase.co/storage/v1/object/public/library-media/covers/a.jpg');
  } finally { for (const name of names) { if (previous[name]===undefined) delete process.env[name]; else process.env[name]=previous[name]; } }
});

test('replace/delete retention handles shared gallery references without deleting files', () => {
  const {retainedMedia} = loader()('src/lib/upload-references.ts');
  const before = {cover_url:'/uploads/a.jpg',file_url:'/uploads/b.pdf',gallery_urls:['/uploads/a.jpg','/uploads/c.jpg']};
  assert.deepEqual(retainedMedia(before,{gallery_urls:['/uploads/a.jpg']}),{retained_media:['/uploads/b.pdf','/uploads/c.jpg'],storage_policy:'retain-during-migration'});
  assert.equal(retainedMedia(before).retained_media.length,3);
});

test('local provider preserves legacy URLs and writes only a new UUID file', async () => {
  const previous = process.env.STORAGE_DRIVER;
  process.env.STORAGE_DRIVER='local';
  const {Writable} = require('node:stream');
  let written = 0;
  let removed = 0;
  const storage = loader({'server-only':{},'node:fs/promises':{async mkdir(){},async unlink(){removed++;}},'node:fs':{createWriteStream(target,options){
    assert.ok(target.includes('public')); assert.ok(target.includes('uploads'));
    assert.match(target,/[a-f0-9-]{36}\.pdf$/); assert.equal(options.flags,'wx');
    return new Writable({write(bytes,_encoding,done){written+=bytes.length;done();}});
  }}})('src/lib/upload-storage.ts');
  try {
    const result = await storage.storeUpload(new File([samples['test.pdf']],'bad/filename.pdf'),'document');
    assert.ok(result.url.startsWith('/uploads/documents/')); assert.equal(written,samples['test.pdf'].length); assert.equal(removed,0);
  } finally { if (previous===undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER=previous; }
});

test('new Storage URLs and absent legacy URLs redirect safely without credentials', async () => {
  const previous = process.env.STORAGE_LEGACY_REMOTE;
  const route = loader({'fs/promises':{async realpath(){throw Object.assign(new Error('missing fixture'),{code:'ENOENT'});}},'@/lib/upload-storage':{validStorageKey:key=>!key.includes('..'),storagePublicUrl:key=>`https://project.supabase.co/storage/v1/object/public/library-media/${key}`}})('src/app/uploads/[...path]/route.ts');
  const context = segments=>({params:Promise.resolve({path:segments})});
  try {
    const request = new Request('http://localhost/uploads/supabase/documents/a.pdf');
    for (const method of ['GET','HEAD']) {
      const result = await route[method](request,context(['supabase','documents','a.pdf']));
      assert.equal(result.status,307); assert.equal(result.headers.get('cache-control'),'no-store');
      assert.ok(result.headers.get('location').endsWith('/documents/a.pdf'));
    }
    assert.equal((await route.GET(request,context(['..','secret']))).status,404);
    process.env.STORAGE_LEGACY_REMOTE='false';
    assert.equal((await route.GET(request,context(['missing-migration-fixture.pdf']))).status,404);
    process.env.STORAGE_LEGACY_REMOTE='true';
    assert.equal((await route.GET(request,context(['missing-migration-fixture.pdf']))).status,307);
  } finally { if (previous===undefined) delete process.env.STORAGE_LEGACY_REMOTE; else process.env.STORAGE_LEGACY_REMOTE=previous; }
});
