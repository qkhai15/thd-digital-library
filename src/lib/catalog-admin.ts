import {NextResponse} from 'next/server';
import {auditLog,isAdmin} from '@/lib/admin-auth';
import {cleanText,jsonBody,parsePositiveInt,safeContentUrl,sameOriginAllowed,logBackendError} from '@/lib/backend-utils';
import {db,ensureSchema} from '@/lib/db';
import {getCollections,getSubjects} from '@/lib/catalog';
import {slugify} from '@/lib/library-url';
import {publicationTransition} from '@/lib/publication-policy';
import {invalidateSearchSuggestions} from '@/lib/search-suggestions-cache';

type Kind='subjects'|'collections';
class CatalogInputError extends Error {}
const tables={subjects:'library_subjects',collections:'library_collections'} as const;
export async function catalogGet(kind:Kind) {
  if(!await isAdmin())return NextResponse.json({message:'Chưa đăng nhập.'},{status:401});
  return NextResponse.json(kind==='subjects'?await getSubjects(true):await getCollections({admin:true,limit:500}));
}
export async function catalogMutation(request:Request,kind:Kind,idRaw?:string) {
  if(!await isAdmin())return NextResponse.json({message:'Chưa đăng nhập.'},{status:401});
  if(!sameOriginAllowed(request))return NextResponse.json({message:'Yêu cầu không hợp lệ.'},{status:403});
  const id=idRaw===undefined?null:parsePositiveInt(idRaw);
  if(idRaw!==undefined&&!id)return NextResponse.json({message:'ID không hợp lệ.'},{status:400});
  const body=await jsonBody(request);if(body instanceof NextResponse)return body;
  await ensureSchema();const client=await db.connect();
  try{
    await client.query('BEGIN');
    const current=id?(await client.query(`SELECT * FROM ${tables[kind]} WHERE id=$1 FOR UPDATE`,[id])).rows[0]:null;
    if(id&&!current){await client.query('ROLLBACK');return NextResponse.json({message:'Không tìm thấy.'},{status:404});}
    if(request.method==='DELETE'){
      if(!id)throw new CatalogInputError('ID bắt buộc.');
      await client.query(kind==='subjects'?'UPDATE library_subjects SET is_active=false,updated_at=NOW() WHERE id=$1':"UPDATE library_collections SET status='archived',updated_at=NOW() WHERE id=$1",[id]);
      await client.query('COMMIT');if(kind==='subjects')invalidateSearchSuggestions();await auditLog('archive',kind,String(id),{});return NextResponse.json({ok:true});
    }
    const data={...current,...body};const title=cleanText(kind==='subjects'?data.name:data.title,kind==='subjects'?150:255);
    const slug=cleanText(data.slug||slugify(title),281);
    const order=Number(data.sort_order??0);
    if(!title||slug.length>(kind==='subjects'?180:280)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||!Number.isSafeInteger(order)||order<0||order>100000)throw new CatalogInputError('Tên, slug hoặc thứ tự không hợp lệ.');
    if(current&&slug!==current.slug)throw new CatalogInputError('Giữ nguyên slug đã lưu để bảo toàn URL.');
    let row;
    if(kind==='subjects'){
      if(data.is_active!==undefined&&typeof data.is_active!=='boolean')throw new CatalogInputError('Trạng thái không hợp lệ.');
      const values=[title,slug,data.is_active!==false,order];
      row=(await client.query(id?'UPDATE library_subjects SET name=$1,slug=$2,is_active=$3,sort_order=$4,updated_at=NOW() WHERE id=$5 RETURNING *':'INSERT INTO library_subjects(name,slug,is_active,sort_order) VALUES($1,$2,$3,$4) RETURNING *',id?[...values,id]:values)).rows[0];
    }else{
      let publication;
      try { publication=publicationTransition(current?.status,data.status===undefined?'draft':data.status); }
      catch { throw new CatalogInputError('Trạng thái không hợp lệ.'); }
      const status=publication.status;
      const cover=data.cover_url?safeContentUrl(cleanText(data.cover_url,2000)):null;if(data.cover_url&&!cover)throw new CatalogInputError('URL ảnh không hợp lệ.');
      if(data.is_featured!==undefined&&typeof data.is_featured!=='boolean')throw new CatalogInputError('Nổi bật không hợp lệ.');
      const ids=body.item_ids===undefined?null:body.item_ids;
      if(ids!==null&&(!Array.isArray(ids)||ids.length>500||ids.some(value=>!Number.isSafeInteger(value)||!parsePositiveInt(value))||new Set(ids).size!==ids.length))throw new CatalogInputError('Danh sách tài liệu không hợp lệ.');
      const values=[title,slug,cleanText(data.description,10000),cover,status,order,data.is_featured===true];
      row=(await client.query(id?'UPDATE library_collections SET title=$1,slug=$2,description=$3,cover_url=$4,status=$5,sort_order=$6,is_featured=$7,updated_at=NOW() WHERE id=$8 RETURNING *':'INSERT INTO library_collections(title,slug,description,cover_url,status,sort_order,is_featured) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',id?[...values,id]:values)).rows[0];
      if(ids!==null){
        const found=await client.query('SELECT id FROM library_items WHERE id=ANY($1::integer[])',[ids]);
        if(found.rowCount!==ids.length)throw new CatalogInputError('Một tài liệu không còn tồn tại.');
        await client.query('DELETE FROM library_collection_items WHERE collection_id=$1',[row.id]);
        if(ids.length)await client.query('INSERT INTO library_collection_items(collection_id,item_id,sort_order) SELECT $1,item_id,ordinality-1 FROM unnest($2::integer[]) WITH ORDINALITY AS entries(item_id,ordinality)',[row.id,ids]);
      }
    }
    await client.query('COMMIT');if(kind==='subjects')invalidateSearchSuggestions();await auditLog(id?'update':'create',kind,String(row.id),{title,status:row.status});
    return NextResponse.json(row,{status:id?200:201});
  }catch(error){
    await client.query('ROLLBACK');
    const unique=error&&typeof error==='object'&&'code'in error&&error.code==='23505';
    if(unique)return NextResponse.json({message:'Slug đã được sử dụng.'},{status:409});
    if(error instanceof CatalogInputError)return NextResponse.json({message:error.message},{status:400});
    logBackendError('CATALOG MUTATION',error);return NextResponse.json({message:'Không thể lưu phân loại.'},{status:503});
  }finally{client.release();}
}
