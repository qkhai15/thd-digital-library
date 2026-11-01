import { db, ensureSchema } from "@/lib/db";
import { cleanSearchText, normalizeSearchQuery } from "@/lib/search-policy";

// Aggregate counters only: no cookies, IP addresses, fingerprints or raw events.
// Keep obviously personal queries out of analytics (search itself still works).
export function analyticsQuery(value: unknown) {
  const query = cleanSearchText(value);
  if(query.length<2 || /@|(?:\+?\d[\s().-]*){8,}/.test(query))return null;
  return {query,normalized:normalizeSearchQuery(query)};
}

const buckets = new Map<string,{tokens:number;at:number}>();
export function allowSearchRequest(kind:"suggest"|"analytics",now=Date.now()) {
  const capacity=kind==="suggest"?60:30;
  const refill=kind==="suggest"?2:0.5;
  const prior=buckets.get(kind)||{tokens:capacity,at:now};
  const tokens=Math.min(capacity,prior.tokens+Math.max(0,now-prior.at)/1000*refill);
  buckets.set(kind,{tokens:Math.max(0,tokens-1),at:now});
  return tokens>=1;
}

let nextPrune=0;
export async function recordSearchAnalytics(query:string,resultCount:number) {
  const safe=analyticsQuery(query);
  if(!safe)return false;
  if(!Number.isSafeInteger(resultCount)||resultCount<0)throw new Error("Invalid search count");
  await ensureSchema();
  // Serialize just these small counter writes so concurrent new queries cannot
  // race beyond the daily ceiling. Never lock or mutate document rows.
  const client=await db.connect();
  try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(74201834)');
  const result=await client.query(`INSERT INTO library_search_daily(search_day,normalized_query,query,search_count,zero_result_count,last_result_count)
    SELECT CURRENT_DATE,$1::text,$2::text,1,$3::bigint,$4::integer
    WHERE EXISTS(SELECT 1 FROM library_search_daily WHERE search_day=CURRENT_DATE AND normalized_query=$1::text)
      OR (SELECT COUNT(*) FROM library_search_daily WHERE search_day=CURRENT_DATE)<1000
    ON CONFLICT(search_day,normalized_query) DO UPDATE SET
      search_count=LEAST(library_search_daily.search_count+1,1000000000),
      zero_result_count=LEAST(library_search_daily.zero_result_count+EXCLUDED.zero_result_count,1000000000),
      last_result_count=EXCLUDED.last_result_count,last_searched_at=NOW()`,[safe.normalized,safe.query,resultCount===0?1:0,resultCount]);
  const shouldPrune=Date.now()>=nextPrune;
  if(shouldPrune){
    // Bounded maintenance at most hourly, only on explicit searches.
    await client.query(`DELETE FROM library_search_daily WHERE (search_day,normalized_query) IN
      (SELECT search_day,normalized_query FROM library_search_daily WHERE search_day<=CURRENT_DATE-90 ORDER BY search_day LIMIT 5000)`);
  }
  await client.query('COMMIT');
  if(shouldPrune)nextPrune=Date.now()+60*60*1000;
  return Boolean(result.rowCount);
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}

export async function getSearchAnalytics(days=30) {
  await ensureSchema();
  const windowDays=Number.isSafeInteger(days)?Math.min(90,Math.max(1,days)):30;
  const [top,zero,trend]=await Promise.all([
    db.query(`SELECT normalized_query,MIN(query) query,SUM(search_count)::float8 count FROM library_search_daily
      WHERE search_day>=CURRENT_DATE-$1::int+1 GROUP BY normalized_query ORDER BY count DESC,normalized_query LIMIT 10`,[windowDays]),
    db.query(`SELECT normalized_query,MIN(query) query,SUM(zero_result_count)::float8 count FROM library_search_daily
      WHERE search_day>=CURRENT_DATE-$1::int+1 GROUP BY normalized_query HAVING SUM(zero_result_count)>0 ORDER BY count DESC,normalized_query LIMIT 10`,[windowDays]),
    db.query(`SELECT search_day::text AS "day",SUM(search_count)::float8 count,SUM(zero_result_count)::float8 zero_results FROM library_search_daily
      WHERE search_day>=CURRENT_DATE-$1::int+1 GROUP BY search_day ORDER BY search_day`,[windowDays]),
  ]);
  return {days:windowDays,topQueries:top.rows as {normalized_query:string;query:string;count:number}[],zeroResults:zero.rows as {normalized_query:string;query:string;count:number}[],trend:trend.rows as {day:string;count:number;zero_results:number}[]};
}
