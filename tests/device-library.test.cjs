const test=require('node:test');const assert=require('node:assert/strict');const loader=require('./load-project.cjs');
test('device library retains public IDs only, bounds recent history, deduplicates and tolerates invalid/blocked storage',()=>{
 const previous=global.window;const values=new Map();const listeners=new Map();
 global.window={localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},dispatchEvent:event=>listeners.get(event.type)?.(),addEventListener:(type,listener)=>listeners.set(type,listener),removeEventListener:type=>listeners.delete(type)};
 try{
 const api=loader()('src/lib/browser-library.ts');assert.deepEqual(api.validDocumentIds([1,'2',1,-4,null,3,2147483647,2147483648,Number.MAX_SAFE_INTEGER]),[1,3,2147483647]);assert.equal(api.toggleSaved(2147483648),false);assert.equal(api.rememberDocument(Number.MAX_SAFE_INTEGER),false);let updates=0;const unsub=api.subscribeShelf(()=>updates++);
 for(let id=1;id<=25;id++)assert.equal(api.rememberDocument(id),true);
 assert.deepEqual([...api.shelfSnapshot('recent')],Array.from({length:20},(_,i)=>25-i));api.rememberDocument(10);assert.equal(api.shelfSnapshot('recent')[0],10);assert.equal(api.shelfSnapshot('recent').length,20);
 api.toggleSaved(12);assert.deepEqual([...api.shelfSnapshot('saved')],[12]);assert.equal(api.shelfSnapshot('saved'),api.shelfSnapshot('saved'));api.toggleSaved(12);assert.deepEqual([...api.shelfSnapshot('saved')],[]);
 api.clearRecent();assert.deepEqual([...api.shelfSnapshot('recent')],[]);assert.ok(updates>0);unsub();
 values.set('thd-library:saved:v1','{"name":"private"}');assert.deepEqual([...api.shelfSnapshot('saved')],[]);values.set('thd-library:saved:v1','not-json');assert.deepEqual([...api.shelfSnapshot('saved')],[]);
 values.set('thd-library:saved:v1','['+' '.repeat(4097)+'1]');assert.deepEqual([...api.shelfSnapshot('saved')],[]);
 values.set('thd-library:saved:v1','[3,2147483648,5]');assert.deepEqual([...api.shelfSnapshot('saved')],[3,5]);
 global.window.localStorage.setItem=()=>{throw new Error('blocked');};assert.equal(api.toggleSaved(9),false);
 }finally{if(previous===undefined)delete global.window;else global.window=previous;}
});
test('saved list API bounds inputs and returns only published active documents in device order with one query',async()=>{
 const calls=[];const route=loader({'@/lib/db':{ensureSchema:async()=>{},db:{query:async(sql,values)=>{calls.push({sql,values});return {rows:[{id:4,title:'Public'}]};}}}})('src/app/api/library/selection/route.ts');
 for(const ids of ['','1,-2','1,foo','99999999999999999999',Array.from({length:101},(_,i)=>i+1).join(',')])assert.equal((await route.GET(new Request(`http://localhost/api/library/selection?ids=${ids}`))).status,400);
 assert.equal(calls.length,0);const result=await route.GET(new Request('http://localhost/api/library/selection?ids=4,2,4'));assert.equal(result.status,200);assert.deepEqual(await result.json(),[{id:4,title:'Public'}]);assert.deepEqual(calls[0].values[0],[4,2]);assert.match(calls[0].sql,/status='published'/);assert.match(calls[0].sql,/array_position/);
});
test('document QR uses only published item canonical, generates PNG/SVG server-side and refuses arbitrary format/id',async()=>{
 let item={id:9,title:'Ngữ văn',type:'sach-dien-tu'};const encoded=[];
 const route=loader({'@/lib/library-repository':{getItemById:async()=>item},qrcode:{toString:async(value,options)=>{encoded.push(value);assert.equal(options.type,'svg');return '<svg></svg>';},toBuffer:async value=>{encoded.push(value);return Buffer.from([137,80,78,71]);}}})('src/app/api/library/[id]/qr/route.ts');
 const get=(id,query='')=>route.GET(new Request('http://localhost/api/library/'+id+'/qr'+query),{params:Promise.resolve({id})});
 assert.equal((await get('../evil')).status,404);assert.equal((await get('9','?format=html')).status,400);
 const svg=await get('9','?url=https://evil.invalid');assert.equal(svg.headers.get('content-type'),'image/svg+xml');assert.equal(svg.headers.get('Cache-Control'),'private, no-store');assert.equal(await svg.text(),'<svg></svg>');assert.match(encoded[0],/^https:\/\/thuvien\.tranhungdaothanhxuan-hanoi\.edu\.vn\/tai-lieu\/sach-dien-tu\/ngu-van-9$/);
 assert.equal((await get('9','?format=png')).headers.get('content-type'),'image/png');item=null;assert.equal((await get('9')).status,404);
});
test('discovery settings preserve safe defaults and strictly bound public section configuration',()=>{
 const {discoverySettings,DEFAULT_DISCOVERY}=loader()('src/lib/discovery-policy.ts');assert.deepEqual(discoverySettings(null),DEFAULT_DISCOVERY);
 assert.deepEqual(discoverySettings({subjects:false,featured_collection_ids:[2,3]},true).featured_collection_ids,[2,3]);
 for(const input of [{subjects:'false'},{featured_collection_ids:[1,1]},{featured_collection_ids:[-1]},{featured_collection_ids:Array.from({length:7},(_,i)=>i+1)}])assert.throws(()=>discoverySettings(input,true));
});
