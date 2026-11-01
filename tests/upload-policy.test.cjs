const test = require('node:test');
const assert = require('node:assert/strict');

test('Free Storage policy defaults to exactly 50 MiB and rejects ambiguous environment values',async()=>{
  const {getConfiguredMediaLimit,MIB}=await import('../scripts/upload-policy.mjs');
  assert.equal(getConfiguredMediaLimit(),52428800);
  assert.equal(getConfiguredMediaLimit({UPLOAD_MEDIA_MAX_MIB:''}),50*MIB);
  assert.equal(getConfiguredMediaLimit({UPLOAD_MEDIA_MAX_MIB:'32'}),32*MIB);
  assert.equal(getConfiguredMediaLimit({UPLOAD_MEDIA_MAX_MIB:'500'}),500*MIB);
  for(const raw of ['0','501','50.5','NaN','Infinity',' 50','50MiB','-1']) assert.throws(()=>getConfiguredMediaLimit({UPLOAD_MEDIA_MAX_MIB:raw}),/UPLOAD_MEDIA_MAX_MIB/);
});

test('effective limits take the lowest policy, file-type and bucket cap while preserving local coexistence',async()=>{
  const {getUploadMaxBytes,MIB}=await import('../scripts/upload-policy.mjs');
  for(const kind of ['document','audio','video']) assert.equal(getUploadMaxBytes(kind),50*MIB);
  assert.equal(getUploadMaxBytes('video',{bucketLimits:[50*MIB,32*MIB]}),32*MIB);
  assert.equal(getUploadMaxBytes('video',{env:{UPLOAD_MEDIA_MAX_MIB:'16'},bucketLimits:[50*MIB]}),16*MIB);
  assert.equal(getUploadMaxBytes('document',{env:{UPLOAD_MEDIA_MAX_MIB:'500'},bucketLimits:[500*MIB]}),80*MIB);
  assert.equal(getUploadMaxBytes('audio',{env:{UPLOAD_MEDIA_MAX_MIB:'500'},bucketLimits:[500*MIB]}),150*MIB);
  assert.equal(getUploadMaxBytes('video',{driver:'local',env:{UPLOAD_MEDIA_MAX_MIB:'50'},bucketLimits:[50*MIB]}),500*MIB);
  assert.equal(getUploadMaxBytes('document',{driver:'local'}),80*MIB);
  assert.equal(getUploadMaxBytes('gallery'),15*MIB);
  assert.equal(getUploadMaxBytes('cover',{bucketLimits:[8*MIB]}),8*MIB);
  assert.equal(getUploadMaxBytes('video',{bucketLimits:[null,undefined,'',0,-1,NaN]}),50*MIB);
  assert.throws(()=>getUploadMaxBytes('__proto__'));
  assert.throws(()=>getUploadMaxBytes('video',{driver:'invalid'}));
});

test('production preflight requires configured capacity in both public and private buckets',async()=>{
  const {validateProductionUploadBuckets}=await import('../scripts/production-config.mjs');
  const limit=52428800;
  const destination={public:true,file_size_limit:limit};
  const quarantine={public:false,file_size_limit:limit};
  assert.doesNotThrow(()=>validateProductionUploadBuckets({},destination,quarantine));
  for(const invalid of [null,undefined,0,limit-1,'invalid']) assert.throws(()=>validateProductionUploadBuckets({},destination,{...quarantine,file_size_limit:invalid}));
  assert.throws(()=>validateProductionUploadBuckets({}, {...destination,public:false},quarantine));
  assert.throws(()=>validateProductionUploadBuckets({},destination,{...quarantine,public:true}));
  assert.throws(()=>validateProductionUploadBuckets({UPLOAD_MEDIA_MAX_MIB:'64'},destination,quarantine));
  assert.doesNotThrow(()=>validateProductionUploadBuckets({UPLOAD_MEDIA_MAX_MIB:'32'},destination,quarantine));
});
