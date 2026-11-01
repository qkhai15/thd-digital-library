const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const loader = require('./load-project.cjs');

test('borrow transitions reserve once, handover does not reserve again, and terminals cannot reopen', () => {
  const { canTransitionBorrow, borrowStockDelta } = loader()('src/lib/borrow-rules.ts');
  for (const [from,to,delta] of [['pending','approved',-1],['approved','ready_for_pickup',0],['ready_for_pickup','borrowed',0],['borrowed','returned',1],['approved','cancelled',1],['ready_for_pickup','cancelled',1],['pending','cancelled',0],['pending','rejected',0]]) {
    assert.equal(canTransitionBorrow(from,to),true,`${from}→${to}`);
    assert.equal(borrowStockDelta(from,to),delta);
  }
  for (const [from,to] of [['pending','borrowed'],['approved','returned'],['ready_for_pickup','returned'],['borrowed','cancelled'],['returned','approved'],['rejected','pending'],['cancelled','approved']]) {
    assert.equal(canTransitionBorrow(from,to),false,`${from}→${to}`);
    assert.equal(borrowStockDelta(from,to),0);
  }
});

test('pickup codes are opaque unique and due dates are explicit school-day boundaries', () => {
  const { createBorrowCode,parseBorrowDueDate,borrowIsOverdue } = loader()('src/lib/borrow-workflow.ts');
  const codes = new Set(Array.from({length:1000},createBorrowCode));
  assert.equal(codes.size,1000);
  for(const code of codes) assert.match(code,/^BR-[0-9A-F]{18}$/);
  const now=Date.parse('2026-10-20T00:00:00Z');
  assert.equal(parseBorrowDueDate('2026-10-30',now),'2026-10-30T16:59:59.999Z');
  assert.equal(parseBorrowDueDate(undefined,now),'2026-11-03T00:00:00.000Z');
  for(const value of ['invalid','2026-02-30','2026-10-19','2099-01-01',true]) assert.throws(()=>parseBorrowDueDate(value,now));
  assert.equal(borrowIsOverdue('borrowed','2026-10-19T00:00:00Z',now),true);
  assert.equal(borrowIsOverdue('approved','2026-10-19T00:00:00Z',now),false);
  assert.equal(borrowIsOverdue('returned','2026-10-19T00:00:00Z',now),false);
  assert.equal(borrowIsOverdue('borrowed',null,now),false);
});

test('borrow registration returns code without echoing borrower PII and blocks every active duplicate', async () => {
  const queries=[];
  const client={release(){},async query(sql,values){
    queries.push([sql,values]);
    if(sql.includes('SELECT id,title,type,stock'))return {rows:[{id:3,type:'sach-giay',stock:2}]};
    if(sql.includes('INSERT INTO borrow_requests'))return {rows:[{id:8,item_id:3,request_code:values[7],status:'pending',requested_at:'2026-10-20T00:00:00Z'}]};
    return {rows:[],rowCount:0};
  }};
  const route=loader({'@/lib/db':{db:{connect:async()=>client},ensureSchema:async()=>{}}})('src/app/api/library/[id]/borrow/route.ts');
  const response=await route.POST(new NextRequest('http://localhost:3000/api/library/3/borrow',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({borrower_name:'PRIVATE_NAME',phone:'PRIVATE_PHONE',email:'PRIVATE_EMAIL'})}),{params:Promise.resolve({id:'3'})});
  assert.equal(response.status,201);
  const body=await response.json();assert.match(body.request_code,/^BR-[0-9A-F]{18}$/);
  assert.doesNotMatch(JSON.stringify(body),/PRIVATE_/);
  assert.ok(queries.some(([sql])=>sql.includes("'ready_for_pickup','borrowed'")));
  assert.ok(queries.some(([sql])=>sql.includes('INSERT INTO borrow_events')));
  assert.equal(queries.some(([sql])=>sql.includes('UPDATE library_items')),false);
});

test('borrow administration requires auth and same-origin before database work', async () => {
  let connects=0;
  const base={'@/lib/db':{ensureSchema:async()=>{},db:{connect:async()=>{connects++;throw new Error('Unexpected connection');}}}};
  const request=origin=>new Request('http://localhost:3000/api/admin/borrows/1',{method:'PATCH',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({status:'approved'})});
  const ctx={params:Promise.resolve({id:'1'})};
  const anonymous=loader({...base,'@/lib/admin-auth':{isAdmin:async()=>false}})('src/app/api/admin/borrows/[id]/route.ts');
  assert.equal((await anonymous.PATCH(request('http://localhost:3000'),ctx)).status,401);
  const admin=loader({...base,'@/lib/admin-auth':{isAdmin:async()=>true}})('src/app/api/admin/borrows/[id]/route.ts');
  assert.equal((await admin.PATCH(request('https://evil.example'),ctx)).status,403);
  assert.equal(connects,0);
});
