const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest, NextResponse } = require('next/server');

const loader = require('./load-project.cjs');

test('media seeking handles bounded and suffix ranges without reading outside the file',()=>{
  const {mediaRange} = loader()('src/lib/media-range.ts');
  assert.equal(mediaRange('bytes=0-9',100).end,9);
  assert.equal(mediaRange('bytes=-10',100).start,90);
  assert.equal(mediaRange('bytes=99-',100).end,99);
  assert.equal(mediaRange('bytes=10-999',100).end,99);
  assert.equal(mediaRange('bytes=-0',100),null);
  assert.equal(mediaRange('bytes=100-',100),null);
  assert.equal(mediaRange('bytes=0-1,5-8',100),null);
});

test('first request uses exactly the visitor ID returned in the cookie',()=>{
  const utils = loader()('src/lib/backend-utils.ts');
  const request = new NextRequest('http://localhost:3000/api/library/1/like');
  const seed = NextResponse.json({});
  const first = utils.ensureVisitorId(request,seed);
  const response = NextResponse.json({});
  const second = utils.ensureVisitorId(request,response);
  assert.equal(first,second);
  assert.equal(response.cookies.get(utils.VISITOR_COOKIE).value,first);
  const followup = new NextRequest(request.url,{headers:{cookie:`${utils.VISITOR_COOKIE}=${first}`}});
  assert.equal(utils.ensureVisitorId(followup,NextResponse.json({})),first);
});

test('unsafe IDs, URLs and pagination cannot reach PostgreSQL',()=>{
  const utils = loader()('src/lib/backend-utils.ts');
  assert.equal(utils.parsePositiveInt(Infinity),null);
  assert.equal(utils.parsePositiveInt(1.5),null);
  assert.equal(utils.boundedInt('Infinity',24),24);
  assert.equal(utils.boundedInt('1.5',24),24);
  assert.equal(utils.safeContentUrl('javascript:alert(1)'), '');
  assert.equal(utils.safeContentUrl('//evil.example'), '');
  assert.equal(utils.safeContentUrl('/\\evil.example'), '');
  assert.equal(utils.safeContentUrl('/uploads/a.pdf'),'/uploads/a.pdf');
  assert.equal(utils.sameOriginAllowed(new Request('http://localhost:3000/api/admin/documents',{method:'POST',headers:{origin:'https://evil.example'}})),false);
});

test('borrow lifecycle cannot double-decrement or return an unapproved request',()=>{
  const rules = loader()('src/lib/borrow-rules.ts');
  assert.equal(rules.canTransitionBorrow('approved','pending'),false);
  assert.equal(rules.canTransitionBorrow('pending','returned'),false);
  assert.equal(rules.canTransitionBorrow('returned','approved'),false);
  assert.equal(rules.borrowStockDelta('pending','approved'),-1);
  assert.equal(rules.borrowStockDelta('approved','approved'),0);
  assert.equal(rules.canTransitionBorrow('approved','returned'),false);
  assert.equal(rules.borrowStockDelta('approved','ready_for_pickup'),0);
  assert.equal(rules.borrowStockDelta('ready_for_pickup','borrowed'),0);
  assert.equal(rules.borrowStockDelta('borrowed','returned'),1);
  assert.equal(rules.borrowStockDelta('returned','returned'),0);
});

test('publishing validates media; albums ignore covers; video cannot be featured',()=>{
  const {documentInput} = loader()('src/lib/document-input.ts');
  const base = {title:'Nội dung trường',status:'published',class_level:'Khác'};
  assert.throws(()=>documentInput({...base,type:'album',gallery_urls:[]}),/ít nhất/);
  const album = documentInput({...base,type:'album',cover_url:'/cover.jpg',gallery_urls:['/gallery.jpg']});
  assert.equal(album.coverUrl,null);
  assert.equal(album.galleryUrls[0],'/gallery.jpg');
  const video = documentInput({...base,type:'video',file_url:'/video.mp4',is_featured:true});
  assert.equal(video.isFeatured,false);
  assert.throws(()=>documentInput({...base,type:'sach-giay',stock:'1.5'}),/số nguyên/);
  assert.throws(()=>documentInput({...base,type:'ky-nang-song',file_url:'/a.pdf'}),/chưa được/);
  assert.equal(documentInput({...base,type:'sach-dien-tu',status:'draft'}).fileUrl,null);
});

test('disguised executable is rejected regardless of claimed MIME',()=>{
  const {detectedFileMime} = loader()('src/lib/file-signature.ts');
  assert.equal(detectedFileMime(Buffer.from('MZ executable renamed as a pdf')),null);
  assert.equal(detectedFileMime(Buffer.from('%PDF-1.7\n123456789')), 'application/pdf');
  assert.equal(detectedFileMime(Buffer.from('RIFF1234WAVE123456')), 'audio/wav');
});

test('newest books and popular API exclude video/album; global search keeps media',async()=>{
  let captured = [];
  const database = {ensureSchema:async()=>{},db:{query:async(sql,values)=>{captured.push([sql,values]);return {rows:sql.includes('COUNT')?[{total:30}]:[]};}}};
  const repo = loader({'@/lib/db':database})('src/lib/library-repository.ts');
  await repo.searchItems({type:'moi-nhat',page:999,size:24});
  assert.match(captured[1][0],/type NOT IN \('video','album'\)/);
  assert.equal(captured[1][1].at(-1),24);
  captured=[];
  await repo.searchItems({q:'sách',sort:'popular'});
  assert.match(captured[1][0],/type NOT IN \('video','album'\)/);
  captured=[];
  await repo.searchItems({q:'video'});
  assert.doesNotMatch(captured[1][0],/type NOT IN \('video','album'\)/);
});

test('like endpoint stores the same first-time identity that it sends back',async()=>{
  let storedId;
  const client = {release(){},query:async(sql,values)=>{
    if (sql.startsWith('INSERT INTO library_likes')) storedId=values[1];
    if (sql.includes('SELECT likes')) return {rows:[{likes:1}],rowCount:1};
    return {rows:[],rowCount:0};
  }};
  const route = loader({'@/lib/db':{ensureSchema:async()=>{},db:{connect:async()=>client}}})('src/app/api/library/[id]/like/route.ts');
  const response = await route.POST(new NextRequest('http://localhost:3000/api/library/1/like',{method:'POST'}),{params:Promise.resolve({id:'1'})});
  assert.equal(response.status,200);
  assert.equal(response.cookies.get('thd_visitor_id').value,storedId);
});

test('repeating a return does not change stock or emit another audit',async()=>{
  const queries=[];
  const client={release(){},query:async(sql)=>{
    queries.push(sql);
    if (sql.includes('SELECT item_id')) return {rows:[{item_id:1}]};
    if (sql.includes('SELECT b.*')) return {rows:[{id:7,item_id:1,status:'returned',stock:5,type:'sach-giay'}]};
    return {rows:[]};
  }};
  const route=loader({'@/lib/db':{ensureSchema:async()=>{},db:{connect:async()=>client}},'@/lib/admin-auth':{isAdmin:async()=>true,getAdminSession:async()=>({username:'admin'})}})('src/app/api/admin/borrows/[id]/route.ts');
  const response=await route.PATCH(new Request('http://localhost:3000/api/admin/borrows/7',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'returned'})}),{params:Promise.resolve({id:'7'})});
  assert.equal(response.status,200);
  assert.equal(queries.some(sql=>sql.includes('UPDATE library_items')),false);
  assert.equal(queries.some(sql=>sql.includes('INSERT INTO audit_logs')),false);
});
