const test=require('node:test');
const assert=require('node:assert/strict');
const {NextRequest}=require('next/server');
const loader=require('./load-project.cjs');

test('Vietnamese search normalization bounds text and treats SQL wildcards as literal characters',()=>{
  const policy=loader()('src/lib/search-policy.ts');
  assert.equal(policy.normalizeSearchQuery('  NGỮ\n VĂN Đường  '),'ngu van duong');
  assert.equal(policy.normalizeSearchQuery('Ngu\u031b\u0303 va\u0306n'),'ngu van');
  assert.equal(policy.cleanSearchText('x'.repeat(121)).length,120);
  assert.equal(policy.searchLikePattern('50%_\\'),' %50\\%\\_\\\\%'.trim());
});

test('shareable URL preserves subject/grade/topic/tag/sort and legacy class_level without allowing sort SQL',()=>{
  const p=loader()('src/lib/search-policy.ts');
  const input=p.searchInputFromParams(new URLSearchParams('q=ngu+van&class_level=12&subject=ngu-van&topic=Ôn+thi&tag=stem&type=video&sort=likes&page=3&limit=10'));
  assert.equal(input.grade,'12');assert.equal(input.type,'video');assert.equal(input.page,3);assert.equal(input.size,10);
  const shared=new URL(p.searchHref(input,2),'http://localhost');
  for(const field of ['q','subject','grade','topic','tag','sort','type'])assert.equal(shared.searchParams.get(field),input[field]);
  assert.equal(shared.searchParams.get('page'),'2');assert.equal(p.sanitizeSearchInput({sort:'views; DROP TABLE library_items'}).sort,'newest');
  assert.equal(p.searchInputFromParams(new URLSearchParams('page=-2&limit=999&grade=123')).page,1);
  assert.equal(p.searchInputFromParams(new URLSearchParams('page=-2&limit=999&grade=123')).size,100);
});

test('all search filters bind parameters and published/media restrictions stay scoped to book sections',()=>{
  const repo=loader({'@/lib/db':{}})('src/lib/library-repository.ts');
  const attack="x' OR TRUE--";
  const query=repo.buildSearchQuery({q:attack,subject:attack,topic:attack,tag:attack,grade:'12',type:'video',sort:'views'});
  assert.ok(query.values.some(value=>String(value).includes(attack)));
  assert.doesNotMatch(query.whereSql,/' OR TRUE/);assert.match(query.whereSql,/i\.status='published'/);
  assert.match(query.whereSql,/s\.slug=\$/);assert.match(query.whereSql,/ANY\(i\.topics\)/);assert.match(query.whereSql,/ANY\(i\.tags\)/);
  assert.equal(query.orderSql,'i.views DESC,i.id DESC');assert.doesNotMatch(query.whereSql,/type NOT IN \('video','album'\)/);
  for(const input of [{type:'moi-nhat'},{type:'thinh-hanh'},{sort:'popular'}])assert.match(repo.buildSearchQuery(input).whereSql,/type NOT IN \('video','album'\)/);
  assert.match(repo.buildSearchQuery({sort:'az'}).orderSql,/thd_search_normalize\(i.title\) ASC/);
  assert.match(repo.buildSearchQuery({q:'ngu van',sort:'relevance'}).orderSql,/CASE WHEN.*title/);
});

test('public search API preserves URL filters and returns sanitized retryable errors when the database fails',async()=>{
  let captured,failed=false;const logged=[];const original=console.error;
  const privateError=Object.assign(new Error('postgresql://fixture-credential@database.invalid/PRIVATE_INTERNAL'),{code:'ECONNREFUSED',detail:'PRIVATE_INTERNAL',stack:'PRIVATE_INTERNAL'});
  console.error=(...args)=>logged.push(args);
  try{
    const api=loader({'@/lib/library-repository':{searchItems:async input=>{captured=input;if(failed)throw privateError;return {items:[],total:0,page:1,size:12,totalPages:1};}}})('src/app/api/library/route.ts');
    const request=new NextRequest('http://localhost:3000/api/library?q=ngu+van&subject=ngu-van&grade=12&sort=views&limit=12');
    const response=await api.GET(request);assert.equal(response.status,200);assert.equal((await response.json()).limit,12);
    assert.equal(captured.grade,'12');assert.equal(captured.subject,'ngu-van');assert.equal(captured.q,'ngu van');assert.equal(captured.sort,'views');
    failed=true;const failure=await api.GET(request);assert.equal(failure.status,503);assert.equal(failure.headers.get('Cache-Control'),'no-store');assert.equal(failure.headers.get('Retry-After'),'5');
    assert.doesNotMatch(await failure.text(),/postgres|PRIVATE_INTERNAL|fixture-credential|database.invalid/);
    assert.deepEqual(logged,[['PUBLIC_SEARCH_FAILED',{code:'ECONNREFUSED'}]]);
  }finally{console.error=original;}
});

test('search loading and retry boundary provide accessible static states without rendering exceptions',()=>{
  const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
  const load=loader({'@/components/LibraryShell':({children})=>React.createElement(React.Fragment,null,children)});
  const Loading=load('src/app/tim-kiem/loading.tsx').default;const ErrorState=load('src/app/tim-kiem/error.tsx').default;
  const loading=renderToStaticMarkup(React.createElement(Loading));assert.match(loading,/aria-busy="true"/);assert.match(loading,/role="status"/);assert.match(loading,/Đang tải kết quả/);
  const retry=()=>{};const error=renderToStaticMarkup(React.createElement(ErrorState,{retry,error:new Error('PRIVATE_INTERNAL_EXCEPTION')}));
  assert.match(error,/role="alert"/);assert.match(error,/Thử lại tìm kiếm/);assert.match(error,/href="\/"/);assert.doesNotMatch(error,/PRIVATE_INTERNAL_EXCEPTION|stack|digest/);
  const buttons=[];const walk=node=>{if(!node||typeof node!=='object')return;if(node.type==='button')buttons.push(node);React.Children.forEach(node.props?.children,walk);};
  walk(ErrorState({retry}));assert.equal(buttons.length,1);assert.equal(buttons[0].props.onClick,retry);
});

test('search uses two bounded queries, clamps last page and excludes the internal search document from JSON',async()=>{
  const calls=[];const row={id:1,title:'Ngữ văn',type:'sach-dien-tu',gallery_urls:[],created_at:new Date(),updated_at:new Date(),search_text:'large internal copy'};
  const repo=loader({'@/lib/db':{ensureSchema:async()=>{},db:{query:async(sql,values)=>{calls.push({sql,values});return {rows:sql.includes('COUNT')?[{total:3}]:[row]};}}}})('src/lib/library-repository.ts');
  const result=await repo.searchItems({q:'ngu van',page:999,size:2,grade:'12'});
  assert.equal(calls.length,2);assert.equal(result.page,2);assert.equal(result.totalPages,2);
  assert.deepEqual(calls[1].values.slice(-2),[2,2]);assert.equal(result.items[0].search_text,undefined);assert.equal(result.items[0].created_at,row.created_at.toISOString());
});

test('autocomplete bounds query and response and never performs analytics writes or per-item queries',async()=>{
  const calls=[];const repo=loader({'@/lib/db':{ensureSchema:async()=>{},db:{query:async(sql,values)=>{calls.push({sql,values});return {rows:[]};}}}})('src/lib/library-repository.ts');
  assert.deepEqual(await repo.getSearchSuggestions('a'),[]);assert.equal(calls.length,0);
  await repo.getSearchSuggestions('Ngữ văn');assert.equal(calls.length,1);assert.match(calls[0].sql,/LIMIT 6/);assert.match(calls[0].sql,/status='published'/);
  assert.doesNotMatch(calls[0].sql,/INSERT|UPDATE|DELETE/);assert.deepEqual(calls[0].values,['%ngu van%']);
});

test('analytics rejects personal-looking queries and budgets requests without storing visitor identity',()=>{
  const analytics=loader({'@/lib/db':{}})('src/lib/search-analytics.ts');
  assert.equal(analytics.analyticsQuery('student@example.edu.vn'),null);
  assert.equal(analytics.analyticsQuery('Liên hệ 0912 345 678'),null);
  assert.equal(analytics.analyticsQuery('x'),null);
  assert.deepEqual(analytics.analyticsQuery('Ngữ văn 12'),{query:'Ngữ văn 12',normalized:'ngu van 12'});
  for(let i=0;i<30;i++)assert.equal(analytics.allowSearchRequest('analytics',10000),true);
  assert.equal(analytics.allowSearchRequest('analytics',10000),false);
  assert.equal(analytics.allowSearchRequest('analytics',12000),true);
  for(let i=0;i<60;i++)assert.equal(analytics.allowSearchRequest('suggest',10000),true);
  assert.equal(analytics.allowSearchRequest('suggest',10000),false);
});

test('analytics serializes daily aggregation, prunes at most hourly and always releases its transaction',async()=>{
  const calls=[];let released=0;
  const client={query:async(sql,values)=>{calls.push({sql,values});return {rows:[],rowCount:1};},release(){released++;}};
  const analytics=loader({'@/lib/db':{ensureSchema:async()=>{},db:{connect:async()=>client}}})('src/lib/search-analytics.ts');
  assert.equal(await analytics.recordSearchAnalytics('Ngữ văn',0),true);
  assert.equal(calls[0].sql,'BEGIN');assert.match(calls[1].sql,/pg_advisory_xact_lock/);
  const insert=calls.find(call=>call.sql.startsWith('INSERT'));assert.deepEqual(insert.values,['ngu van','Ngữ văn',1,0]);
  assert.match(insert.sql,/ON CONFLICT\(search_day,normalized_query\)/);assert.match(insert.sql,/<1000/);
  assert.equal(calls.at(-1).sql,'COMMIT');assert.equal(released,1);
  const retention=calls.filter(call=>call.sql.startsWith('DELETE'));assert.equal(retention.length,1);assert.match(retention[0].sql,/CURRENT_DATE-90/);assert.match(retention[0].sql,/LIMIT 5000/);
  await analytics.recordSearchAnalytics('Ngữ văn',2);assert.equal(calls.filter(call=>call.sql.startsWith('DELETE')).length,1);
  await assert.rejects(()=>analytics.recordSearchAnalytics('Ngữ văn',-1),/Invalid/);
});

test('failed analytics writes roll back without retaining a connection',async()=>{
  const calls=[];let released=false;
  const analytics=loader({'@/lib/db':{ensureSchema:async()=>{},db:{connect:async()=>({query:async sql=>{calls.push(sql);if(sql.startsWith('INSERT'))throw new Error('unavailable');return {rows:[]};},release(){released=true;}})}}})('src/lib/search-analytics.ts');
  await assert.rejects(()=>analytics.recordSearchAnalytics('Ngữ văn',2),/unavailable/);assert.equal(calls.at(-1),'ROLLBACK');assert.equal(released,true);
});

test('Admin search trends clamp the retention window and return only bounded aggregates',async()=>{
  const calls=[];const analytics=loader({'@/lib/db':{ensureSchema:async()=>{},db:{query:async(sql,values)=>{calls.push({sql,values});return {rows:[]};}}}})('src/lib/search-analytics.ts');
  const result=await analytics.getSearchAnalytics(1000);assert.equal(result.days,90);assert.equal(calls.length,3);
  for(const call of calls){assert.deepEqual(call.values,[90]);assert.doesNotMatch(call.sql,/visitor|ip_address|cookie|fingerprint/);assert.doesNotMatch(call.sql,/SUM\([^)]*\)::int/);}
  assert.match(calls[0].sql,/LIMIT 10/);assert.match(calls[1].sql,/HAVING SUM\(zero_result_count\)>0/);
});

test('analytics endpoint rejects cross-origin, oversized and invalid submissions before writing',async()=>{
  let queries=0;
  const api=loader({'@/lib/db':{ensureSchema:async()=>{},db:{query:async()=>{queries++;return {rows:[{total:1}]};}}},'@/lib/search-analytics':{analyticsQuery:query=>query.includes('@')?null:{query},allowSearchRequest:()=>true,recordSearchAnalytics:async()=>{queries++;}}})('src/app/api/search/analytics/route.ts');
  const request=(body,origin='http://localhost:3000',type='application/json')=>new NextRequest('http://localhost:3000/api/search/analytics',{method:'POST',headers:{origin,'Content-Type':type},body});
  assert.equal((await api.POST(request('{"q":"Ngữ văn"}','https://untrusted.invalid'))).status,403);
  assert.equal((await api.POST(request('q=Ngữ văn',undefined,'text/plain'))).status,415);
  assert.equal((await api.POST(request('{"q":"Ngữ văn"}',undefined,'application/json-invalid'))).status,415);
  assert.equal((await api.POST(request('not json'))).status,400);
  assert.equal((await api.POST(request(JSON.stringify({q:'x'.repeat(121)})))).status,400);
  assert.equal((await api.POST(request(JSON.stringify({q:'student@example.edu.vn'})))).status,204);
  assert.equal((await api.POST(request(JSON.stringify({q:'Ngữ văn',noise:'x'.repeat(3000)})))).status,413);
  assert.equal(queries,0);
});

test('explicit analytics recomputes result count and ignores forged counts, identity and cookies',async()=>{
  let recorded;const queries=[];
  const api=loader({'@/lib/db':{ensureSchema:async()=>{},db:{query:async(sql,values)=>{queries.push({sql,values});return {rows:[{total:0}]};}}},'@/lib/search-analytics':{analyticsQuery:query=>({query}),allowSearchRequest:()=>true,recordSearchAnalytics:async(...args)=>{recorded=args;}}})('src/app/api/search/analytics/route.ts');
  const response=await api.POST(new NextRequest('http://localhost:3000/api/search/analytics',{method:'POST',headers:{origin:'http://localhost:3000','Content-Type':'application/json',cookie:'secret=private','x-forwarded-for':'192.0.2.1'},body:JSON.stringify({q:'Ngữ văn',grade:'12',resultCount:999,visitor:'private'})}));
  assert.equal(response.status,204);assert.deepEqual(recorded,['Ngữ văn',0]);assert.equal(queries.length,1);
  assert.deepEqual(queries[0].values,['12','%ngu van%']);assert.doesNotMatch(JSON.stringify(queries),/private|192\.0\.2/);
  assert.equal(response.headers.get('set-cookie'),null);
});

test('search analytics Admin API authorizes before database access and marks data no-store',async()=>{
  let authorized=false,calls=0;
  const api=loader({'@/lib/admin-auth':{isAdmin:async()=>authorized},'@/lib/search-analytics':{getSearchAnalytics:async()=>{calls++;return {days:30,topQueries:[],zeroResults:[],trend:[]};}}})('src/app/api/admin/search-analytics/route.ts');
  assert.equal((await api.GET()).status,401);assert.equal(calls,0);authorized=true;
  const response=await api.GET();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(calls,1);
});

test('suggestions API validates minimum/maximum, reuses its bounded cache and has no analytics mutation',async()=>{
  let calls=0,allowed=true;
  loader()('src/lib/search-suggestions-cache.ts').invalidateSearchSuggestions();
  const api=loader({'@/lib/library-repository':{getSearchSuggestions:async()=>{calls++;return [{id:1,title:'Ngữ văn',type:'sach-dien-tu'}];}},'@/lib/search-analytics':{allowSearchRequest:()=>allowed}})('src/app/api/search/suggestions/route.ts');
  const request=q=>new NextRequest(`http://localhost:3000/api/search/suggestions?q=${encodeURIComponent(q)}`);
  assert.equal((await api.GET(request('x'))).status,200);assert.equal(calls,0);
  assert.equal((await api.GET(request('x'.repeat(121)))).status,400);assert.equal(calls,0);
  assert.equal((await api.GET(request('Ngữ văn'))).status,200);assert.equal((await api.GET(request('Ngữ văn'))).status,200);assert.equal(calls,1);
  allowed=false;assert.equal((await api.GET(request('Ngữ văn'))).status,429);assert.equal(calls,1);
});

test('suggestions cache expires, bounds entries and rejects an in-flight stale result after invalidation',()=>{
  const cache=loader()('src/lib/search-suggestions-cache.ts');cache.invalidateSearchSuggestions();
  const item={id:1,title:'Ngữ văn',author:'',type:'sach-dien-tu'};
  const revision=cache.searchSuggestionsRevision();
  cache.cacheSearchSuggestions('old',[item],revision,1000);assert.equal(cache.cachedSearchSuggestions('old',1001)[0].id,1);
  assert.equal(cache.cachedSearchSuggestions('old',31000),null);
  cache.invalidateSearchSuggestions();cache.cacheSearchSuggestions('stale',[item],revision,1000);assert.equal(cache.cachedSearchSuggestions('stale',1001),null);
  const current=cache.searchSuggestionsRevision();
  for(let i=0;i<257;i++)cache.cacheSearchSuggestions(`key-${i}`,[item],current,1000);
  assert.equal(cache.cachedSearchSuggestions('key-0',1001),null);assert.equal(cache.cachedSearchSuggestions('key-256',1001).length,1);
  cache.invalidateSearchSuggestions();
});

test('Admin archive invalidates a previously cached title immediately and responses never use browser cache',async()=>{
  const load=loader();const cache=load('src/lib/search-suggestions-cache.ts');cache.invalidateSearchSuggestions();
  let row={id:1,title:'Ngữ văn',author:'Nguyễn Du',type:'sach-dien-tu',status:'published',class_level:'12',file_url:'/manual.pdf',gallery_urls:[],stock:null};let reads=0;
  const api=loader({'@/lib/library-repository':{getSearchSuggestions:async()=>{reads++;return row.status==='published'?[{id:row.id,title:row.title,author:row.author,type:row.type}]:[];}},'@/lib/search-analytics':{allowSearchRequest:()=>true}})('src/app/api/search/suggestions/route.ts');
  const request=()=>new NextRequest('http://localhost:3000/api/search/suggestions?q=Ngữ%20văn');
  const initial=await api.GET(request());assert.equal((await initial.json()).items.length,1);assert.equal(initial.headers.get('Cache-Control'),'private, no-store');
  await api.GET(request());assert.equal(reads,1);
  const documents=loader({'@/lib/admin-auth':{isAdmin:async()=>true,auditLog:async()=>{}},'@/lib/db':{ensureSchema:async()=>{},db:{query:async sql=>{
    if(sql.startsWith('UPDATE'))row={...row,status:'archived'};
    return {rows:[row],rowCount:1};
  }}}})('src/app/api/admin/documents/[id]/route.ts');
  const response=await documents.PUT(new Request('http://localhost:3000/api/admin/documents/1',{method:'PUT',headers:{origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({status:'archived'})}),{params:Promise.resolve({id:'1'})});
  assert.equal(response.status,200);assert.deepEqual((await (await api.GET(request())).json()).items,[]);assert.equal(reads,2);
});

test('document create/delete invalidate only after successful writes and subject edits invalidate after commit',async()=>{
  const cache=loader()('src/lib/search-suggestions-cache.ts');cache.invalidateSearchSuggestions();
  const item={id:1,title:'Bản mới',type:'sach-dien-tu',status:'published',stock:null,file_url:'/manual.pdf'};
  let rowCount=1,history=false,authorized=true;const events=[];
  const client={query:async sql=>{events.push(sql);if(sql.startsWith('SELECT *'))return {rows:[item]};if(sql.startsWith('SELECT 1 FROM borrow_requests'))return {rows:[],rowCount:history?1:0};if(sql.includes('RETURNING *'))return {rows:[{id:3,name:'Ngữ văn',slug:'ngu-van'}],rowCount:1};return {rows:[],rowCount:0};},release(){}};
  const db={ensureSchema:async()=>{},db:{query:async()=>({rows:rowCount?[item]:[],rowCount}),connect:async()=>client}};
  const admin={'@/lib/admin-auth':{isAdmin:async()=>authorized,auditLog:async()=>{}},'@/lib/db':db};
  const create=loader(admin)('src/app/api/admin/documents/route.ts');
  const request=(method,body={})=>new Request('http://localhost:3000/api/admin/documents/1',{method,headers:{origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify(body)});
  let revision=cache.searchSuggestionsRevision();rowCount=0;
  assert.equal((await create.POST(request('POST',{...item,class_level:'12'}))).status,400);assert.equal(cache.searchSuggestionsRevision(),revision);
  rowCount=1;assert.equal((await create.POST(request('POST',{...item,class_level:'12'}))).status,201);assert.ok(cache.searchSuggestionsRevision()>revision);
  const remove=loader(admin)('src/app/api/admin/documents/[id]/route.ts');
  revision=cache.searchSuggestionsRevision();history=true;
  assert.equal((await remove.DELETE(request('DELETE'),{params:Promise.resolve({id:'1'})})).status,409);assert.equal(cache.searchSuggestionsRevision(),revision);
  history=false;assert.equal((await remove.DELETE(request('DELETE'),{params:Promise.resolve({id:'1'})})).status,200);assert.ok(cache.searchSuggestionsRevision()>revision);
  revision=cache.searchSuggestionsRevision();const catalog=loader(admin)('src/lib/catalog-admin.ts');events.length=0;
  assert.equal((await catalog.catalogMutation(request('POST',{name:'Ngữ văn',slug:'ngu-van'}),'subjects')).status,201);
  assert.ok(cache.searchSuggestionsRevision()>revision);assert.ok(events.includes('COMMIT'));
  revision=cache.searchSuggestionsRevision();authorized=false;
  assert.equal((await create.POST(request('POST',item))).status,401);assert.equal(cache.searchSuggestionsRevision(),revision);
});

test('catalog search migration is additive and pg_trgm operator class uses its real extension schema',async()=>{
  const {migrateSearchFeatures}=await import('../scripts/search-feature-schema.mjs');const calls=[];
  await migrateSearchFeatures({query:async(sql)=>{calls.push(sql);return {rows:sql.includes('n.nspname')?[{nspname:'extensions'}]:[],rowCount:0};}});
  assert.ok(calls.some(sql=>sql.includes('search_text "extensions".gin_trgm_ops')));
  assert.ok(calls.some(sql=>sql.includes('ENABLE ROW LEVEL SECURITY')));
  assert.ok(calls.some(sql=>sql.includes('pg_trigger')&&sql.includes('IF NOT EXISTS')));
  assert.ok(!calls.some(sql=>/^\s*(DROP|TRUNCATE|DELETE)/i.test(sql)));
  assert.ok(!calls.some(sql=>/^\s*UPDATE library_items SET (?!search_text)/i.test(sql)));
});

// Optional real-PostgreSQL exercise. Root prepares/migrates only an isolated
// database; this test never migrates, touches production or leaves fixture rows.
test('isolated PostgreSQL: accented metadata matching, filter combinations, sort, analytics and retention',
 {skip:!process.env.TEST_SEARCH_DATABASE_ENV},async()=>{
  const fs=require('node:fs');const path=require('node:path');const {Pool}=require('pg');const {randomUUID}=require('node:crypto');
  const envPath=path.resolve(process.env.TEST_SEARCH_DATABASE_ENV);const workspace=path.resolve('.');
  assert.ok(envPath.startsWith(workspace+path.sep),'Fixture env must stay inside workspace');
  const env=require('dotenv').parse(fs.readFileSync(envPath));const url=new URL(env.DATABASE_URL);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Only isolated loopback PostgreSQL is allowed');
  assert.match(url.pathname,/^\/thd_feature_[a-z0-9]+$/);
  const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});const client=await pool.connect();
  try{
   await client.query('BEGIN');assert.equal((await client.query('SELECT 1 FROM thd_schema_migrations WHERE version=4')).rowCount,1);
   // Analytics are bounded top-ten lists. Isolate counters from previous browser
   // fixtures without deleting or modifying their public aggregates.
   await client.query('CREATE TEMP TABLE library_search_daily (LIKE public.library_search_daily INCLUDING ALL) ON COMMIT DROP');
   const marker=`search-${randomUUID().replace(/[0-9]/g,'a')}`;const subject=(await client.query('INSERT INTO library_subjects(name,slug) VALUES($1,$2) RETURNING id',['Ngữ văn',marker])).rows[0].id;
   const insert=async(title,description,type,status,views,likes)=>Number((await client.query(`INSERT INTO library_items(title,description,type,status,class_level,subject_id,topics,tags,publisher,author,views,likes)
     VALUES($1,$2,$3,$4,'12',$5,ARRAY['Ôn thi'],ARRAY['stem'],'Giáo dục','Nguyễn Du',$6,$7) RETURNING id`,[title,description,type,status,subject,views,likes])).rows[0].id);
   const a=await insert('Ngữ văn '+marker,'Tư liệu văn học','sach-dien-tu','published',10,1);
   const b=await insert('Bài học '+marker,'Ngữ văn trong mô tả','sach-giay','published',50,5);
   const video=await insert('Video '+marker,'Bài giảng','video','published',100,10);
   const draft=await insert('Bản nháp '+marker,'Ngữ văn','sach-dien-tu','draft',1000,100);
   const source={ensureSchema:async()=>{},db:{query:(...args)=>client.query(...args)}};
   const repo=loader({'@/lib/db':source})('src/lib/library-repository.ts');
   const search=async extra=>repo.searchItems({subject:marker,...extra});
   assert.deepEqual((await search({q:'ngu van',sort:'relevance'})).items.map(item=>item.id),[a,video,b]);
   assert.equal((await search({q:'giao duc',type:'sach-dien-tu',grade:'12',topic:'Ôn thi',tag:'stem'})).items[0].id,a);
   assert.equal((await search({q:'nguyen du'})).total,3);assert.equal((await search({grade:'11'})).total,0);
   assert.equal((await search({topic:'không tồn tại'})).total,0);assert.equal((await search({q:'%'})).total,0);
   assert.deepEqual((await search({sort:'views'})).items.map(item=>item.id),[video,b,a]);
   assert.deepEqual((await search({sort:'likes'})).items.map(item=>item.id),[video,b,a]);
   assert.deepEqual((await search({sort:'az'})).items.map(item=>item.id),[b,a,video]);
   assert.ok(!(await search({q:'ngu van'})).items.some(item=>item.id===draft));
   const suggestions=await repo.getSearchSuggestions(marker);assert.ok(suggestions.some(item=>item.id===a));assert.ok(!suggestions.some(item=>item.id===draft));
   await client.query('UPDATE library_items SET publisher=$1 WHERE id=$2',['Tri thức đặc biệt',a]);
   assert.equal((await search({q:'tri thuc dac biet'})).items[0].id,a);
   const normalize=await client.query('SELECT public.thd_search_normalize($1) value',['ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ']);
   assert.equal(normalize.rows[0].value,'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd');
   // Counter writer has its own transaction: exercise it through savepoints,
   // preserving this outer transaction so every fixture is rolled back.
   const writer={query:async(sql,values)=>{
    if(sql==='BEGIN')return client.query('SAVEPOINT analytics_counter');
    if(sql==='COMMIT')return client.query('RELEASE SAVEPOINT analytics_counter');
    if(sql==='ROLLBACK')return client.query('ROLLBACK TO SAVEPOINT analytics_counter');
    return client.query(sql,values);
   },release(){}};
   let queue=Promise.resolve();
   const serialQuery=(...args)=>{const result=queue.then(()=>client.query(...args));queue=result.catch(()=>{});return result;};
   const analytics=loader({'@/lib/db':{ensureSchema:async()=>{},db:{query:serialQuery,connect:async()=>writer}}})('src/lib/search-analytics.ts');
   const query='Kiểm thử '+marker;
   await client.query(`INSERT INTO library_search_daily(search_day,normalized_query,query) VALUES(CURRENT_DATE-100,$1,$1)`,[marker]);
   await analytics.recordSearchAnalytics(query,0);await analytics.recordSearchAnalytics(query,3);
   const stored=(await client.query('SELECT * FROM library_search_daily WHERE normalized_query=$1',['kiem thu '+marker])).rows[0];
   assert.equal(Number(stored.search_count),2);assert.equal(Number(stored.zero_result_count),1);assert.equal(stored.last_result_count,3);
   assert.equal((await client.query('SELECT 1 FROM library_search_daily WHERE normalized_query=$1',[marker])).rowCount,0);
   assert.equal(await analytics.recordSearchAnalytics('private@example.edu.vn',0),false);
   const summary=await analytics.getSearchAnalytics(30);assert.ok(summary.topQueries.some(row=>row.normalized_query==='kiem thu '+marker));
   assert.ok(summary.zeroResults.some(row=>row.normalized_query==='kiem thu '+marker));
   await client.query(`INSERT INTO library_search_daily(search_day,normalized_query,query)
     SELECT CURRENT_DATE,$1||g::text,$1||g::text FROM generate_series(1,1000) g`,[marker+'-budget-']);
   assert.equal(await analytics.recordSearchAnalytics('Hết hạn mức '+marker,0),false);
   assert.equal(await analytics.recordSearchAnalytics(query,3),true,'existing aggregate remains writable after distinct-query limit');
  }finally{await client.query('ROLLBACK');client.release();await pool.end();}
 });
