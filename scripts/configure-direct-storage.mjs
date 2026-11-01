import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { getConfiguredMediaLimit, MIB } from './upload-policy.mjs';

dotenv.config({path:'.env.local',quiet:true});
const secret=process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!process.env.SUPABASE_URL || !secret || !process.env.SUPABASE_STORAGE_BUCKET) throw new Error('Missing server Storage configuration.');
const client=createClient(process.env.SUPABASE_URL,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const apply=process.argv.includes('--apply');
const quarantine=process.env.SUPABASE_UPLOAD_BUCKET || 'thd-library-quarantine';
const limitArg=process.argv.find(value=>value.startsWith('--limit-bytes='));
const max=limitArg ? Number(limitArg.slice('--limit-bytes='.length)) : getConfiguredMediaLimit(process.env);
if(!Number.isSafeInteger(max) || max<1 || max>500*MIB) throw new Error('Invalid upload bucket limit.');
const allowed=['application/pdf','audio/mpeg','audio/wav','audio/ogg','audio/mp4','video/mp4','video/webm'];
const report={createdAt:new Date().toISOString(),apply,buckets:[],managementTokenConfigured:Boolean(process.env.SUPABASE_ACCESS_TOKEN),requestedLimitBytes:max};
function summary(data){return data ? {id:data.id,public:data.public,fileSizeLimit:data.file_size_limit,allowedMimeTypes:data.allowed_mime_types} : null;}
function failure(error){return {status:error?.status,statusCode:error?.statusCode,category:'Storage bucket configuration refused; no credentials logged'};}
for(const bucket of [process.env.SUPABASE_STORAGE_BUCKET,quarantine]){
 const current=await client.storage.getBucket(bucket);
 const record={bucket,before:summary(current.data)};
 if(apply){
  const privateBucket=bucket===quarantine;
  if(current.error && current.error.statusCode!=='404' && current.error.status!==404){record.error=failure(current.error);}
  else{
   const options=privateBucket ? {public:false,fileSizeLimit:max,allowedMimeTypes:allowed} : {public:true,fileSizeLimit:max,allowedMimeTypes:current.data?.allowed_mime_types || undefined};
   const changed=current.data ? await client.storage.updateBucket(bucket,options) : await client.storage.createBucket(bucket,options);
   if(changed.error)record.error=failure(changed.error);
   else record.after=summary((await client.storage.getBucket(bucket)).data);
  }
 }
 report.buckets.push(record);
}
if(process.env.SUPABASE_ACCESS_TOKEN){
 const ref=new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/config/storage`,{headers:{authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`}});
 if(response.ok){const body=await response.json();report.globalFileSizeLimit=body.fileSizeLimit;}
 else report.globalLimitStatus='Management API unavailable';
}else report.globalLimitStatus='No Management API credential; verify global limit in Dashboard or by actual TUS requests.';
await mkdir('test-results',{recursive:true});
const file=`test-results/direct-storage-config-${Date.now()}.json`;
await writeFile(file,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));console.log(`Report: ${file}`);
if(report.buckets.some(b=>b.error))process.exitCode=1;
