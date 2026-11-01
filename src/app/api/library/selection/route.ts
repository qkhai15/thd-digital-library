import {NextResponse} from 'next/server';
import {db,ensureSchema} from '@/lib/db';
import {ACTIVE_LIBRARY_TYPES} from '@/lib/library-types';
export async function GET(request:Request){
  const raw=new URL(request.url).searchParams.get('ids')||'';
  if(raw.length>1100||!/^\d+(,\d+)*$/.test(raw))return NextResponse.json({message:'Danh sách tài liệu không hợp lệ.'},{status:400});
  const ids=[...new Set(raw.split(',').map(Number))];
  if(ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<=0||id>2147483647))return NextResponse.json({message:'Danh sách tài liệu không hợp lệ.'},{status:400});
  await ensureSchema();
  const result=await db.query(`SELECT id,title,author,type,cover_url,file_url,gallery_urls,format FROM library_items
    WHERE id=ANY($1::int[]) AND status='published' AND type=ANY($2::text[])
    ORDER BY array_position($1::int[],id)`,[ids,ACTIVE_LIBRARY_TYPES]);
  return NextResponse.json(result.rows,{headers:{'Cache-Control':'no-store'}});
}
