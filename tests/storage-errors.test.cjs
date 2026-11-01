const test=require('node:test');
const assert=require('node:assert/strict');
const loader=require('./load-project.cjs');

test('Supabase upstream size limit returns safe 413 rather than generic outage',async()=>{
 const keys=['STORAGE_DRIVER','SUPABASE_URL','SUPABASE_STORAGE_BUCKET','SUPABASE_SECRET_KEY'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{STORAGE_DRIVER:'supabase',SUPABASE_URL:'https://project.supabase.co',SUPABASE_STORAGE_BUCKET:'thd-library',SUPABASE_SECRET_KEY:'private-test-key'});
 const storage=loader({'server-only':{},'@supabase/supabase-js':{createClient:()=>({storage:{from:()=>({upload:async()=>({error:{status:400,statusCode:'413',message:'do not expose upstream request secrets'}})})}})}})('src/lib/upload-storage.ts');
 try{
  await assert.rejects(storage.storeUpload(new File([Buffer.from('0000ftypisomfixture')],'video.mp4',{type:'video/mp4'}),'video'),error=>error.status===413&&!error.message.includes('private-test-key')&&!error.message.includes('upstream request'));
 }finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
