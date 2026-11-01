import pg from "pg";
import dotenv from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
dotenv.config({path:process.env.DB_TARGET_ENV_FILE || ".env.local",quiet:true});
const directory=path.resolve(process.argv[2]);
const manifest=JSON.parse(await readFile(path.join(directory,"manifest.json"),"utf8"));
const url=new URL(process.env.SUPABASE_DATABASE_URL);
url.searchParams.set("sslmode","verify-full");
url.searchParams.set("sslrootcert",path.resolve(process.env.DB_SSL_CA_FILE));
const pool=new pg.Pool({connectionString:url.toString(),max:1});
const quote=value=>`"${value.replaceAll('"','""')}"`;
const client=await pool.connect();
try {
  await client.query("BEGIN READ ONLY");await client.query("SET LOCAL TIME ZONE 'UTC'");
  const tables=[];
  for(const table of manifest.tables){
    const identifier=`${quote(table.schema)}.${quote(table.table)}`;
    const row=(await client.query(`SELECT count(*)::text count, md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) digest FROM ${identifier} t`)).rows[0];
    assert.equal(row.count,table.count,`${table.table} count`);assert.equal(row.digest,table.digest,`${table.table} content`);
    tables.push({table:table.table,count:row.count,result:"PASS"});
  }
  const indexes=(await client.query("SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2,3")).rows;
  assert.deepEqual(indexes,manifest.indexes);
  const cols=(await client.query("SELECT table_schema,table_name,column_name,data_type,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2,ordinal_position")).rows;
  assert.deepEqual(cols,manifest.columns);
  const constraints=(await client.query("SELECT n.nspname schema,c.relname table_name,con.conname name,con.contype type,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1,2,3")).rows;
  // PG18 stores NOT NULL constraints in pg_constraint; PG17 represents them in columns.
  assert.deepEqual(constraints,manifest.constraints.filter(c=>c.type!=="n"));
  for(const seq of manifest.sequences){
    const value=(await client.query(`SELECT last_value::text value FROM ${quote(seq.schemaname)}.${quote(seq.sequencename)}`)).rows[0].value;
    if(seq.last_value!==null) assert.equal(value,String(seq.last_value),seq.sequencename);
  }
  const rls=(await client.query("SELECT bool_and(relrowsecurity) enabled FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'")).rows[0].enabled;
  assert.equal(rls,true);
  const report={tables,indexes:indexes.length,constraints:constraints.length,notNull:"verified via columns",sequences:manifest.sequences.length,tls:"verify-full",result:"PASS"};
  await writeFile(path.join(directory,"supabase-verification.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await client.query("ROLLBACK").catch(()=>undefined);client.release();await pool.end();}
