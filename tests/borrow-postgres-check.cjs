// Explicit isolated local feature DB only. Never reads the application's .env.local.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { NextRequest } = require('next/server');
const loader = require('./load-project.cjs');

async function main() {
  let connectionString=process.env.TEST_DATABASE_URL;
  if(process.env.FEATURE_TEST_ENV_FILE) {
    const env=require('dotenv').parse(require('node:fs').readFileSync(process.env.FEATURE_TEST_ENV_FILE));
    connectionString=env.DATABASE_URL;
  }
  if(!connectionString) throw new Error('Provide TEST_DATABASE_URL or FEATURE_TEST_ENV_FILE for an isolated feature database.');
  const url=new URL(connectionString);
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^\/thd_feature_[a-z0-9]+$/.test(url.pathname)) {
    throw new Error('Refusing writes outside an explicitly isolated local thd_feature_ database.');
  }
  const schema=`borrow_qa_${crypto.randomBytes(6).toString('hex')}`;
  const control=new Pool({connectionString,max:1});
  const pool=new Pool({connectionString,max:6,options:`-csearch_path=${schema},pg_catalog`,connectionTimeoutMillis:10000});
  try {
    const actual=await control.query('SELECT current_database() AS name');
    assert.match(actual.rows[0].name,/^thd_feature_[a-z0-9]+$/);
    await control.query(`CREATE SCHEMA ${schema}`);
    const client=await pool.connect();
    let legacy;
    try {
      await client.query(`CREATE TABLE library_items(id SERIAL PRIMARY KEY,title TEXT,type TEXT,stock INTEGER,status TEXT DEFAULT 'published',updated_at timestamptz DEFAULT NOW());
        CREATE TABLE borrow_requests(id SERIAL PRIMARY KEY,item_id integer REFERENCES library_items(id),visitor_id text,borrower_name text,class_name text,phone text,email text,note text,status varchar(30),approved_at timestamptz,returned_at timestamptz,created_at timestamptz NOT NULL DEFAULT NOW(),updated_at timestamptz DEFAULT NOW());
        CREATE TABLE audit_logs(username text,action text,entity_type text,entity_id text,details jsonb);`);
      const oldBook=await client.query("INSERT INTO library_items(title,type,stock) VALUES('Legacy reservation','sach-giay',0) RETURNING id");
      legacy=(await client.query("INSERT INTO borrow_requests(item_id,status,borrower_name,created_at,approved_at) VALUES($1,'approved','Kept private','2020-01-02T00:00:00Z','2020-01-03T00:00:00Z') RETURNING id",[oldBook.rows[0].id])).rows[0];
      const {migrateBorrowFeatures}=await import('../scripts/borrow-feature-schema.mjs');
      await client.query('BEGIN');await migrateBorrowFeatures(client);await client.query('COMMIT');
      const first=(await client.query('SELECT * FROM borrow_requests WHERE id=$1',[legacy.id])).rows[0];
      assert.match(first.request_code,/^BR-[A-F0-9]{18}$/);
      assert.equal(first.status,'approved');assert.equal(first.borrowed_at,null);assert.equal(first.due_at,null);
      assert.equal(first.requested_at.toISOString(),'2020-01-02T00:00:00.000Z');
      assert.equal(first.approved_at.toISOString(),'2020-01-03T00:00:00.000Z');
      await client.query('BEGIN');await migrateBorrowFeatures(client);await client.query('COMMIT');
      const second=(await client.query('SELECT * FROM borrow_requests WHERE id=$1',[legacy.id])).rows[0];
      assert.equal(second.request_code,first.request_code);
      assert.equal(Number((await client.query('SELECT count(*) FROM borrow_events WHERE request_id=$1',[legacy.id])).rows[0].count),1);
      assert.equal((await client.query('SELECT stock FROM library_items WHERE id=$1',[first.item_id])).rows[0].stock,0);
    } finally {client.release();}
    const db={connect:()=>pool.connect(),query:(...args)=>pool.query(...args)};
    const load=loader({'@/lib/db':{db,ensureSchema:async()=>{}},'@/lib/admin-auth':{isAdmin:async()=>true,getAdminSession:async()=>({username:'isolated-tester'})}});
    const create=load('src/app/api/library/[id]/borrow/route.ts');
    const transition=load('src/app/api/admin/borrows/[id]/route.ts');
    const list=load('src/app/api/admin/borrows/route.ts');
    const ctx=id=>({params:Promise.resolve({id:String(id)})});
    const request=(path,body,method='POST',visitor='reader_isolated_test_123')=>new NextRequest(`http://localhost:3100${path}`,{method,headers:{'Content-Type':'application/json',cookie:`thd_visitor_id=${visitor}`},body:JSON.stringify(body)});
    const book=(await pool.query("INSERT INTO library_items(title,type,stock) VALUES('Isolated concurrent stock','sach-giay',1) RETURNING id")).rows[0];
    const register=visitor=>create.POST(request(`/api/library/${book.id}/borrow`,{borrower_name:'Isolated tester',phone:'not-real'},'POST',visitor),ctx(book.id));
    const one=await register('reader_isolated_test_111');const two=await register('reader_isolated_test_222');
    assert.equal(one.status,201);assert.equal(two.status,201);
    const records=[await one.json(),await two.json()];
    const change=(id,status,extra={})=>transition.PATCH(request(`/api/admin/borrows/${id}`,{status,...extra},'PATCH'),ctx(id));
    const stock=async()=>Number((await pool.query('SELECT stock FROM library_items WHERE id=$1',[book.id])).rows[0].stock);
    const approved=await Promise.all(records.map(row=>change(row.id,'approved')));
    assert.deepEqual(approved.map(r=>r.status).sort(),[200,409]);assert.equal(await stock(),0);
    const winner=records[approved.findIndex(r=>r.status===200)];
    const loser=records[approved.findIndex(r=>r.status===409)];
    const repeatApproval=await Promise.all([change(winner.id,'approved'),change(winner.id,'approved')]);
    assert.ok(repeatApproval.every(r=>r.status===200));assert.equal(await stock(),0);
    assert.equal(Number((await pool.query("SELECT count(*) FROM audit_logs WHERE entity_id=$1 AND action='borrow_status'",[String(winner.id)])).rows[0].count),1);
    assert.equal((await change(winner.id,'returned')).status,409);
    const ready=await Promise.all([change(winner.id,'ready_for_pickup'),change(winner.id,'ready_for_pickup')]);
    assert.ok(ready.every(r=>r.status===200));assert.equal(await stock(),0);
    assert.equal((await change(winner.id,'borrowed',{due_at:'not-a-date'})).status,400);
    const handed=await Promise.all([change(winner.id,'borrowed'),change(winner.id,'borrowed')]);
    assert.ok(handed.every(r=>r.status===200));
    const handedRows=await Promise.all(handed.map(r=>r.json()));
    assert.ok(handedRows[0].due_at);assert.equal(handedRows[0].due_at,handedRows[1].due_at);assert.equal(await stock(),0);
    // Duplicate reader requests are blocked through ready/borrowed states too.
    const originalVisitor=winner.id===records[0].id?'reader_isolated_test_111':'reader_isolated_test_222';
    await pool.query('UPDATE library_items SET stock=1 WHERE id=$1',[book.id]);
    assert.equal((await register(originalVisitor)).status,409);
    await pool.query('UPDATE library_items SET stock=0 WHERE id=$1',[book.id]);
    await pool.query("UPDATE borrow_requests SET due_at=NOW()-INTERVAL '1 day' WHERE id=$1",[winner.id]);
    const overdue=await list.GET(new Request('http://localhost:3100/api/admin/borrows?status=overdue'));
    const dueRows=await overdue.json();assert.equal(dueRows.length,1);assert.equal(dueRows[0].is_overdue,true);
    const returned=await Promise.all([change(winner.id,'returned'),change(winner.id,'returned')]);
    assert.ok(returned.every(r=>r.status===200));assert.equal(await stock(),1);
    assert.equal((await change(winner.id,'approved')).status,409);
    const timeline=(await pool.query('SELECT to_status,actor FROM borrow_events WHERE request_id=$1 ORDER BY created_at,id',[winner.id])).rows;
    assert.deepEqual(timeline.map(r=>r.to_status),['pending','approved','ready_for_pickup','borrowed','returned']);
    assert.equal(Number((await pool.query("SELECT count(*) FROM audit_logs WHERE entity_id=$1 AND action='borrow_status'",[String(winner.id)])).rows[0].count),4);
    assert.ok(timeline.every(row=>!Object.keys(row).some(k=>/name|phone|email|note/.test(k))));
    assert.equal((await change(loser.id,'approved')).status,200);assert.equal(await stock(),0);
    assert.equal((await change(loser.id,'ready_for_pickup')).status,200);
    const cancellations=await Promise.all([change(loser.id,'cancelled'),change(loser.id,'cancelled')]);
    assert.ok(cancellations.every(r=>r.status===200));assert.equal(await stock(),1);
    const coded=await list.GET(new Request(`http://localhost:3100/api/admin/borrows?code=${winner.request_code}`));
    const codedRows=await coded.json();assert.equal(codedRows.length,1);assert.equal(codedRows[0].id,winner.id);
    const skipLegacy=await change(legacy.id,'returned');assert.equal(skipLegacy.status,409);
    // All public creates for the same visitor serialize on the item lock.
    const duplicateCreates=await Promise.all([register('reader_isolated_race_333'),register('reader_isolated_race_333')]);
    assert.deepEqual(duplicateCreates.map(r=>r.status).sort(),[201,409]);assert.equal(await stock(),1);
    assert.equal(Number((await pool.query('SELECT count(*) FROM borrow_requests WHERE item_id=$1 AND visitor_id=$2',[book.id,'reader_isolated_race_333'])).rows[0].count),1);
    const rejectedRecord=await (duplicateCreates.find(r=>r.status===201)).json();
    assert.equal((await change(rejectedRecord.id,'rejected')).status,200);assert.equal(await stock(),1);
    assert.equal((await change(rejectedRecord.id,'approved')).status,409);
    // A lock held by another transaction returns a bounded, recoverable 409.
    const blocked=await pool.connect();
    try {
      await blocked.query('BEGIN');await blocked.query('SELECT id FROM library_items WHERE id=$1 FOR UPDATE',[book.id]);
      assert.equal((await change(rejectedRecord.id,'rejected')).status,409);
    } finally {await blocked.query('ROLLBACK');blocked.release();}
    assert.equal((await change(rejectedRecord.id,'rejected')).status,200);
    // An old application writer during migration omits both new columns and
    // cannot insert events. The DB default keeps its INSERT compatible, and
    // the first new-admin action bootstraps its snapshot under the same lock.
    const oldWriter=(await pool.query(`INSERT INTO borrow_requests
      (item_id,visitor_id,borrower_name,class_name,phone,email,note,status)
      VALUES($1,'old_writer_during_deploy','Legacy writer','','not-real','','','pending')
      RETURNING id,request_code,requested_at`,[book.id])).rows[0];
    assert.match(oldWriter.request_code,/^BR-[A-F0-9]{18}$/);assert.ok(oldWriter.requested_at);
    assert.equal(Number((await pool.query('SELECT count(*) FROM borrow_events WHERE request_id=$1',[oldWriter.id])).rows[0].count),0);
    const oldWriterSnapshot=await Promise.all([change(oldWriter.id,'pending'),change(oldWriter.id,'pending')]);
    assert.ok(oldWriterSnapshot.every(r=>r.status===200));assert.equal(await stock(),1);
    assert.equal(Number((await pool.query('SELECT count(*) FROM borrow_events WHERE request_id=$1',[oldWriter.id])).rows[0].count),1);
    assert.equal((await change(oldWriter.id,'approved')).status,200);assert.equal(await stock(),0);
    assert.equal((await change(oldWriter.id,'cancelled')).status,200);assert.equal(await stock(),1);
    const oldWriterEvents=(await pool.query('SELECT to_status,actor FROM borrow_events WHERE request_id=$1 ORDER BY created_at,id',[oldWriter.id])).rows;
    assert.deepEqual(oldWriterEvents.map(e=>e.to_status),['pending','approved','cancelled']);assert.equal(oldWriterEvents[0].actor,'migration');
    assert.equal(Number((await pool.query("SELECT count(*) FROM audit_logs WHERE entity_id=$1 AND action='borrow_status'",[String(oldWriter.id)])).rows[0].count),2);
    console.log(JSON.stringify({result:'PASS',isolated:true,productionConnection:false,migrationReplay:true,legacyReservationPreserved:true,concurrentApproval:true,concurrentRegistration:true,doubleHandover:true,doubleReturn:true,doubleCancellation:true,idempotentAudit:true,strictTransitions:true,dueDate:true,derivedOverdue:true,codeSearch:true,timeline:true,lockTimeoutRecovery:true,oldWriterDatabaseDefaults:true,oldWriterTimelineBootstrap:true}));
  } finally {
    await pool.end();
    // Only a generated test schema inside a verified isolated local DB is removed.
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await control.end();
  }
}
main().catch(error=>{console.error(JSON.stringify({result:'FAIL',name:error.name,code:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:undefined,message:error instanceof assert.AssertionError?error.message:'Isolated borrow verification failed; no production database accessed.'}));process.exitCode=1;});
