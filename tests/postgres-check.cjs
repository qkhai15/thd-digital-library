const assert = require('node:assert/strict');
const {Client} = require('pg');
const {NextRequest} = require('next/server');
const loader = require('./load-project.cjs');

function connection() {
  let connectionString=process.env.TEST_DATABASE_URL;
  const isolated=Boolean(connectionString||process.env.FEATURE_TEST_ENV_FILE);
  if(process.env.FEATURE_TEST_ENV_FILE) {
    connectionString=require('dotenv').parse(require('node:fs').readFileSync(process.env.FEATURE_TEST_ENV_FILE)).DATABASE_URL;
  }
  if(isolated) {
    if(!connectionString) throw new Error('Missing isolated database configuration.');
    const url=new URL(connectionString);
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^\/thd_feature_[a-z0-9]+$/.test(url.pathname)) {
      throw new Error('Refusing isolated test mode outside a local thd_feature_ database.');
    }
  } else {
    // Legacy command remains compatible. All writes below are pg_temp only.
    // Prefer FEATURE_TEST_ENV_FILE or TEST_DATABASE_URL for isolated execution.
    require('dotenv').config({path:'.env.local',quiet:true});
    connectionString=process.env.DATABASE_URL;
    if(!connectionString) throw new Error('Missing database configuration.');
  }
  return {connectionString,isolated};
}

async function main() {
  const config=connection();
  const client = new Client({connectionString:config.connectionString,connectionTimeoutMillis:10000});
  await client.connect();
  try {
    if(config.isolated) assert.match((await client.query('SELECT current_database() AS name')).rows[0].name,/^thd_feature_[a-z0-9]+$/);
    // No fallback to public: all tested writes can only reach temporary tables.
    await client.query('SET search_path TO pg_temp');
    await client.query(`CREATE TEMP TABLE library_subjects(id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,name TEXT,slug TEXT,is_active BOOLEAN DEFAULT TRUE,sort_order INTEGER DEFAULT 0);
    CREATE TEMP TABLE library_items (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, title TEXT NOT NULL,
      author TEXT DEFAULT '',type TEXT NOT NULL,category TEXT DEFAULT '',class_level TEXT DEFAULT 'Khác',format TEXT DEFAULT '',
      cover_url TEXT,file_url TEXT,gallery_urls JSONB DEFAULT '[]',description TEXT DEFAULT '',stock INTEGER,
      views INTEGER DEFAULT 0,likes INTEGER DEFAULT 0,is_featured BOOLEAN DEFAULT FALSE,status VARCHAR(30) DEFAULT 'published',
      published_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW(),
      publisher TEXT,publication_year INTEGER,isbn TEXT,language TEXT,page_count INTEGER,
      subject_id INTEGER REFERENCES library_subjects(id),topics TEXT[] NOT NULL DEFAULT '{}',tags TEXT[] NOT NULL DEFAULT '{}',source TEXT,rights TEXT
    );
    CREATE TEMP TABLE borrow_requests (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,item_id INTEGER REFERENCES library_items(id),visitor_id TEXT,
      borrower_name TEXT,class_name TEXT,phone TEXT,email TEXT,note TEXT,status VARCHAR(30),
      request_code VARCHAR(24) UNIQUE,requested_at TIMESTAMPTZ DEFAULT NOW(),
      approved_at TIMESTAMPTZ,ready_at TIMESTAMPTZ,borrowed_at TIMESTAMPTZ,due_at TIMESTAMPTZ,
      returned_at TIMESTAMPTZ,rejected_at TIMESTAMPTZ,cancelled_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TEMP TABLE borrow_events(id BIGSERIAL PRIMARY KEY,request_id INTEGER REFERENCES borrow_requests(id),from_status TEXT,to_status TEXT,actor TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TEMP TABLE library_likes(item_id INTEGER,visitor_id TEXT,PRIMARY KEY(item_id,visitor_id));
    CREATE TEMP TABLE library_views(item_id INTEGER,visitor_id TEXT,view_day DATE,PRIMARY KEY(item_id,visitor_id,view_day));
    CREATE TEMP TABLE library_comments(id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,item_id INTEGER,name TEXT,content TEXT,visitor_id TEXT,status VARCHAR(30),created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TEMP TABLE audit_logs(username TEXT,action TEXT,entity_type TEXT,entity_id TEXT,details JSONB);
    CREATE TEMP TABLE news_posts(id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,title VARCHAR(500),slug VARCHAR(500) UNIQUE,excerpt TEXT,content TEXT,cover_url TEXT,status VARCHAR(30),is_featured BOOLEAN,published_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());`);
    const db={query:(...args)=>client.query(...args),connect:async()=>({query:(...args)=>client.query(...args),release(){}})};
    const load=loader({'@/lib/db':{db,ensureSchema:async()=>{}},'@/lib/admin-auth':{isAdmin:async()=>true,getAdminSession:async()=>({username:'test'}),auditLog:async()=>{}},'@/lib/site-settings':{commentsRequireApproval:async()=>true}});
    const borrow=load('src/app/api/library/[id]/borrow/route.ts');
    const status=load('src/app/api/admin/borrows/[id]/route.ts');
    const like=load('src/app/api/library/[id]/like/route.ts');
    const view=load('src/app/api/library/[id]/view/route.ts');
    const docs=load('src/app/api/admin/documents/route.ts');
    const edit=load('src/app/api/admin/documents/[id]/route.ts');
    const comments=load('src/app/api/library/[id]/comments/route.ts');
    const cookie='thd_visitor_id=visitor_test_123456789';
    const context=id=>({params:Promise.resolve({id:String(id)})});
    const request=(url,body,method='POST')=>new NextRequest(`http://localhost:3100${url}`,{method,headers:{cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const subject=(await client.query("INSERT INTO library_subjects(name,slug) VALUES('Môn thử nghiệm','mon-thu-nghiem') RETURNING id")).rows[0];
    const hiddenSubject=(await client.query("INSERT INTO library_subjects(name,slug,is_active) VALUES('Môn đã ẩn','mon-da-an',false) RETURNING id")).rows[0];
    const payload={title:'Kiểm thử trong bảng tạm',type:'sach-giay',status:'published',stock:2,publisher:'Nhà xuất bản thử nghiệm',publication_year:2026,isbn:'9780000000000',language:'Tiếng Việt',page_count:128,subject_id:subject.id,topics:['Văn học'],tags:['Ôn tập'],source:'Nguồn trong bảng tạm',rights:'Nội dung kiểm thử'};
    assert.equal((await docs.POST(request('/api/admin/documents',{...payload,subject_id:hiddenSubject.id}))).status,400);
    const newsCreate=load('src/app/api/admin/news/route.ts');
    const newsEdit=load('src/app/api/admin/news/[id]/route.ts');
    const newsPayload={title:'Tin bảng tạm',slug:'tin-bang-tam',content:'Nội dung',status:'published'};
    const newsResponse=await newsCreate.POST(request('/api/admin/news',newsPayload));
    assert.equal(newsResponse.status,201);
    const newsItem=await newsResponse.json();
    const newsSaved=await newsEdit.PUT(request(`/api/admin/news/${newsItem.id}`,{...newsPayload,content:'Đã sửa'},'PUT'),context(newsItem.id));
    assert.equal(newsSaved.status,200);
    assert.equal((await newsSaved.json()).content,'Đã sửa');
    const created=await docs.POST(request('/api/admin/documents',payload));
    assert.equal(created.status,201);
    const item=await created.json();
    assert.equal(item.publisher,payload.publisher);assert.equal(item.subject_id,subject.id);
    assert.deepEqual(item.topics,payload.topics);assert.deepEqual(item.tags,payload.tags);
    assert.equal(item.publication_year,2026);assert.equal(item.page_count,128);
    const registration={borrower_name:'Người kiểm thử',phone:'0000000000'};
    const first=await borrow.POST(request(`/api/library/${item.id}/borrow`,registration),context(item.id));
    assert.equal(first.status,201);
    const record=await first.json();
    assert.match(record.request_code,/^BR-[A-F0-9]{18}$/);
    assert.equal((await borrow.POST(request(`/api/library/${item.id}/borrow`,registration),context(item.id))).status,409);
    async function transition(value,expected=200) {
      assert.equal((await status.PATCH(request(`/api/admin/borrows/${record.id}`,{status:value},'PATCH'),context(record.id))).status,expected);
    }
    async function stock() { return (await client.query('SELECT stock FROM library_items WHERE id=$1',[item.id])).rows[0].stock; }
    await transition('approved'); assert.equal(await stock(),1);
    await transition('approved'); assert.equal(await stock(),1);
    await transition('pending',409); assert.equal(await stock(),1);
    // Editing metadata from a stale form must preserve the current circulation stock.
    const saved=await edit.PUT(request(`/api/admin/documents/${item.id}`,{...payload,title:'Sửa mô tả',expected_stock:2},'PUT'),context(item.id));
    assert.equal(saved.status,200); assert.equal(await stock(),1);
    const savedItem=await saved.json();assert.equal(savedItem.publisher,payload.publisher);assert.equal(savedItem.subject_id,subject.id);assert.deepEqual(savedItem.tags,payload.tags);
    assert.equal((await edit.PUT(request(`/api/admin/documents/${item.id}`,{...payload,stock:8,expected_stock:2},'PUT'),context(item.id))).status,409);
    assert.equal((await edit.DELETE(request(`/api/admin/documents/${item.id}`,null,'DELETE'),context(item.id))).status,409);
    await transition('returned',409); assert.equal(await stock(),1);
    await transition('ready_for_pickup'); assert.equal(await stock(),1);
    const changeType=()=>edit.PUT(request(`/api/admin/documents/${item.id}`,{...payload,type:'sach-dien-tu',file_url:'/uploads/test-only.pdf',stock:null,expected_stock:1},'PUT'),context(item.id));
    assert.equal((await changeType()).status,409);
    await transition('borrowed'); assert.equal(await stock(),1);
    assert.equal((await changeType()).status,409);
    await transition('returned'); assert.equal(await stock(),2);
    await transition('returned'); assert.equal(await stock(),2);
    await transition('approved',409);
    assert.equal((await edit.DELETE(request(`/api/admin/documents/${item.id}`,null,'DELETE'),context(item.id))).status,409);
    const likeResponse=await like.POST(request(`/api/library/${item.id}/like`),context(item.id));
    assert.equal((await likeResponse.json()).likes,1);
    assert.equal((await (await like.POST(request(`/api/library/${item.id}/like`),context(item.id))).json()).likes,0);
    assert.equal((await (await view.POST(request(`/api/library/${item.id}/view`),context(item.id))).json()).counted,true);
    assert.equal((await (await view.POST(request(`/api/library/${item.id}/view`),context(item.id))).json()).counted,false);
    assert.equal((await client.query('SELECT views FROM library_items WHERE id=$1',[item.id])).rows[0].views,1);
    for (let i=0;i<5;i++) {
      const response=await comments.POST(request(`/api/library/${item.id}/comments`,{name:'Người kiểm thử',content:`Bình luận thử ${i}`}),context(item.id));
      assert.equal(response.status,201);
      assert.equal((await response.json()).status,'pending');
    }
    assert.equal((await comments.POST(request(`/api/library/${item.id}/comments`,{name:'Người kiểm thử',content:'Giới hạn spam'}),context(item.id))).status,429);
    const visible=await comments.GET(new NextRequest(`http://localhost:3100/api/library/${item.id}/comments`),context(item.id));
    assert.equal((await visible.json()).length,0);
    console.log('PASS: SQL thật trên pg_temp: metadata/môn học, tạo/sửa tài liệu, mượn trùng, duyệt/sẵn sàng/giao/trả idempotent, tồn kho stale, giữ lịch sử, chặn đổi loại khi đang mượn, like, lượt xem, bình luận chờ duyệt và giới hạn spam.');
    console.log('Không ghi/xóa dữ liệu trong schema public của trường.');
  } finally { await client.end(); }
}
main().catch(error=>{console.error(JSON.stringify({result:'FAIL',code:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:undefined,message:error instanceof assert.AssertionError?error.message:'Temporary-table PostgreSQL verification failed; no connection details logged.'}));process.exitCode=1;});
