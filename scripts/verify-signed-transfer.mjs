import { Upload } from 'tus-js-client';

// QA client runs outside the app container, just like a browser. Never print TUS
// errors/URLs because they can contain short-lived scoped capabilities.
export function signedTransfer(bytes,intent,{pauseAfterChunk=false,resumeUrl,onRequest}={}){
 return new Promise((resolve,reject)=>{
  let upload,pausing=false;
  upload=new Upload(bytes,{
   endpoint:intent.endpoint,uploadUrl:resumeUrl,chunkSize:6*1024*1024,
   retryDelays:[0,1000,3000,5000],uploadDataDuringCreation:true,
   headers:{'x-signature':intent.token,'x-upsert':'false'},
   metadata:{bucketName:intent.bucket,objectName:intent.path,contentType:intent.mime,cacheControl:'31536000'},
   storeFingerprintForResuming:false,
   onBeforeRequest(request){onRequest?.({method:request.getMethod(),host:new URL(request.getURL()).host});},
   onChunkComplete(chunk,sent,total){
    if(pauseAfterChunk&&!pausing&&sent>=6*1024*1024&&sent<total){
     pausing=true;void upload.abort(false).then(()=>resolve({paused:true,url:upload.url,offset:sent})).catch(()=>reject(new Error('Direct TUS pause failed')));
    }
   },
   onError(error){
    const status=error.originalResponse?.getStatus() || 0;
    let code=error.originalCause?.code || '';
    try{code=JSON.parse(error.originalResponse?.getBody() || '{}').code || code;}catch{}
    const safeCode=typeof code==='string'&&/^[a-z0-9_-]{1,60}$/i.test(code)?code:'unclassified';
    reject(new Error(`Direct signed TUS failed (HTTP ${status}, ${safeCode}); credential details suppressed`));
   },
   onSuccess(){resolve({paused:false,url:upload.url});},
  });
  upload.start();
 });
}
