import {db,ensureSchema} from '@/lib/db';
import {ACTIVE_LIBRARY_TYPES,type LibraryCollection,type LibraryItem,type LibrarySubject} from '@/lib/library-types';

export async function getSubjects(admin=false):Promise<LibrarySubject[]> {
  await ensureSchema();return (await db.query(`SELECT id,name,slug,is_active,sort_order FROM library_subjects ${admin?'':'WHERE is_active'} ORDER BY sort_order,name,id`)).rows;
}
export async function getCollections({featured=false,limit=100,admin=false}={}):Promise<LibraryCollection[]> {
  await ensureSchema();
  const result=await db.query(`SELECT c.*,COUNT(i.id)::int item_count,
    COALESCE(array_agg(ci.item_id ORDER BY ci.sort_order,ci.item_id) FILTER(WHERE ci.item_id IS NOT NULL AND ($2::boolean OR i.id IS NOT NULL)),'{}') item_ids
    FROM library_collections c LEFT JOIN library_collection_items ci ON ci.collection_id=c.id
    LEFT JOIN library_items i ON i.id=ci.item_id AND i.status='published' AND i.type=ANY($1::text[])
    WHERE ($2::boolean OR c.status='published') AND (NOT $3::boolean OR c.is_featured)
    GROUP BY c.id ORDER BY c.sort_order,c.id DESC LIMIT $4`,[ACTIVE_LIBRARY_TYPES,admin,featured,Math.min(500,Math.max(1,limit))]);
  return result.rows.map(row=>({...row,created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString()}));
}
export async function getCollection(slug:string):Promise<(LibraryCollection&{items:LibraryItem[]})|null> {
  await ensureSchema();
  const collection=(await db.query(`SELECT * FROM library_collections WHERE slug=$1 AND status='published'`,[slug])).rows[0];
  if(!collection)return null;
  const items=(await db.query(`SELECT i.*,s.name subject_name,CASE WHEN s.is_active THEN s.slug ELSE NULL END subject_slug FROM library_collection_items ci
    JOIN library_items i ON i.id=ci.item_id LEFT JOIN library_subjects s ON s.id=i.subject_id
    WHERE ci.collection_id=$1 AND i.status='published' AND i.type=ANY($2::text[])
    ORDER BY ci.sort_order,ci.item_id LIMIT 500`,[collection.id,ACTIVE_LIBRARY_TYPES])).rows;
  return {...collection,created_at:new Date(collection.created_at).toISOString(),updated_at:new Date(collection.updated_at).toISOString(),items:items.map(row=>({...row,created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString()}))};
}
export async function getRelatedItems(id:number,limit=6):Promise<LibraryItem[]> {
  await ensureSchema();
  const result=await db.query(`WITH current AS (SELECT * FROM library_items WHERE id=$1 AND status='published'),
    candidates AS(SELECT i.*,
      (CASE WHEN i.subject_id=c.subject_id THEN 4 ELSE 0 END +
       CASE WHEN c.class_level<>'Khác' AND i.class_level=c.class_level THEN 2 ELSE 0 END +
       CASE WHEN i.topics && c.topics THEN 3 ELSE 0 END + CASE WHEN i.tags && c.tags THEN 2 ELSE 0 END +
       CASE WHEN i.type=c.type THEN 1 ELSE 0 END) score
    FROM library_items i CROSS JOIN current c WHERE i.id<>$1 AND i.status='published' AND i.type=ANY($2::text[]))
    SELECT * FROM candidates WHERE score>0 ORDER BY score DESC,views DESC,id DESC LIMIT $3`,[id,ACTIVE_LIBRARY_TYPES,Math.min(6,Math.max(1,limit))]);
  return result.rows.map(row=>({...row,created_at:new Date(row.created_at).toISOString(),updated_at:new Date(row.updated_at).toISOString()}));
}
