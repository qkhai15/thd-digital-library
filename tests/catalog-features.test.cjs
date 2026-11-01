const test=require('node:test');
const assert=require('node:assert/strict');
const loader=require('./load-project.cjs');
const {renderToStaticMarkup}=require('react-dom/server');
const React=require('react');

test('optional bibliographic metadata stays nullable and rejects invalid numbers/term lists',()=>{
 const {documentMetadata}=loader()('src/lib/document-metadata.ts');
 const empty=documentMetadata({});assert.equal(empty.publisher,null);assert.equal(empty.subject_id,null);assert.deepEqual(empty.tags,[]);
 const filled=documentMetadata({publisher:'NXB Giáo dục',publication_year:'2025',page_count:'120',subject_id:'3',tags:['STEM','stem',''],topics:['Ôn thi'],language:'Tiếng Việt'});
 assert.equal(filled.publication_year,2025);assert.equal(filled.page_count,120);assert.deepEqual(filled.tags,['stem']);assert.deepEqual(filled.topics,['Ôn thi']);
 for(const input of [{page_count:0},{publication_year:10000},{subject_id:-1},{tags:Array(31).fill('x')},{topics:['x'.repeat(101)]},{tags:'not-an-array'}])assert.throws(()=>documentMetadata(input));
});

test('metadata public rendering shows supplied values only and escapes source text',()=>{
 const Component=loader()('src/components/DocumentMetadata.tsx').default;
 const html=renderToStaticMarkup(React.createElement(Component,{item:{type:'sach-dien-tu',class_level:'12',category:'',format:'PDF',publisher:'NXB Giáo dục',source:'<script>private</script>',tags:['Ôn thi']}}));
 assert.match(html,/NXB Giáo dục/);assert.match(html,/Ôn thi/);assert.doesNotMatch(html,/Số trang|Ngôn ngữ|<script>/);assert.match(html,/&lt;script&gt;/);
});

test('hidden subject labels remain readable without generating public taxonomy links to inactive pages',async()=>{
 const queries=[];
 const database={ensureSchema:async()=>{},db:{query:async(sql,values)=>{
  queries.push({sql,values});
  if(sql.includes('COUNT(*)::int AS total'))return {rows:[{total:1}]};
  if(sql.startsWith('SELECT * FROM library_collections'))return {rows:[{id:2,created_at:'2026-01-01',updated_at:'2026-01-01'}]};
  return {rows:[{id:1,title:'Ngữ văn',type:'sach-dien-tu',subject_name:'Môn đã ẩn',subject_slug:null,created_at:'2026-01-01',updated_at:'2026-01-01'}]};
 }}};
 const load=loader({'@/lib/db':database});const repo=load('src/lib/library-repository.ts');const catalog=load('src/lib/catalog.ts');
 await repo.getItemById(1);await repo.searchItems({q:'Ngữ văn'});await catalog.getCollection('on-thi');
 for(const query of queries.filter(entry=>entry.sql.includes('subject_slug')))assert.match(query.sql,/CASE WHEN s\.is_active THEN s\.slug ELSE NULL END(?: AS)? subject_slug/);
 const Component=load('src/components/DocumentMetadata.tsx').default;
 const html=renderToStaticMarkup(React.createElement(Component,{item:{class_level:'12',subject_name:'Môn đã ẩn',subject_slug:null}}));
 assert.match(html,/Môn đã ẩn/);assert.doesNotMatch(html,/href="\/mon-hoc\//);
});

test('catalog mutations require Admin and same origin before parsing or touching the database',async()=>{
 let authorized=false,queries=0;
 const api=loader({'@/lib/admin-auth':{isAdmin:async()=>authorized,auditLog:async()=>{}},'@/lib/db':{ensureSchema:async()=>{queries++;},db:{connect:async()=>{queries++;throw new Error();}}}})('src/lib/catalog-admin.ts');
 const request=origin=>new Request('http://localhost:3000/api/admin/subjects',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Toán'})});
 assert.equal((await api.catalogMutation(request('http://localhost:3000'),'subjects')).status,401);assert.equal(queries,0);
 authorized=true;assert.equal((await api.catalogMutation(request('https://untrusted.invalid'),'subjects')).status,403);assert.equal(queries,0);
});

test('catalog rejects duplicate memberships and slug changes transactionally; archive preserves data',async()=>{
 const queries=[];let current={id:3,title:'Ôn thi',name:'Ngữ văn',slug:'on-thi',status:'published'};
 const connection={query:async(sql,values)=>{queries.push({sql,values});if(sql.startsWith('SELECT *'))return {rows:[current]};if(sql.includes('RETURNING *'))return {rows:[current]};return {rows:[],rowCount:0};},release(){}};
 const api=loader({'@/lib/admin-auth':{isAdmin:async()=>true,auditLog:async()=>{}},'@/lib/db':{ensureSchema:async()=>{},db:{connect:async()=>connection}}})('src/lib/catalog-admin.ts');
 const request=(method,body)=>new Request('http://localhost:3000/api/admin/collections/3',{method,headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await api.catalogMutation(request('PUT',{slug:'changed'}),'collections','3')).status,400);assert.equal(queries.at(-1).sql,'ROLLBACK');
 queries.length=0;assert.equal((await api.catalogMutation(request('PUT',{item_ids:[1,1]}),'collections','3')).status,400);assert.ok(!queries.some(x=>x.sql.startsWith('DELETE')));
 queries.length=0;assert.equal((await api.catalogMutation(request('DELETE',{}),'collections','3')).status,200);assert.ok(queries.some(x=>x.sql.includes("status='archived'")));assert.ok(!queries.some(x=>/DELETE FROM library_(collections|items)\b/.test(x.sql)));
 current={...current,slug:'mon'};queries.length=0;assert.equal((await api.catalogMutation(request('DELETE',{}),'subjects','3')).status,200);assert.ok(queries.some(x=>x.sql.includes('is_active=false')));
});
