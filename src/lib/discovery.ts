import {db,ensureSchema} from '@/lib/db';
import {ACTIVE_LIBRARY_TYPES,type LibraryItem} from '@/lib/library-types';
export async function getRecommendedItems():Promise<LibraryItem[]>{
  await ensureSchema();
  return (await db.query(`SELECT * FROM library_items WHERE status='published' AND is_featured
    AND type=ANY($1::text[]) ORDER BY updated_at DESC,id DESC LIMIT 6`,[ACTIVE_LIBRARY_TYPES])).rows;
}
export async function getTaxonomyItems(kind:'subject'|'grade',value:string):Promise<LibraryItem[]>{
  await ensureSchema();
  return (await db.query(`SELECT i.*,s.name subject_name,s.slug subject_slug FROM library_items i
    LEFT JOIN library_subjects s ON s.id=i.subject_id WHERE i.status='published' AND i.type=ANY($1::text[])
    AND ${kind==='subject'?'s.slug=$2 AND s.is_active':'i.class_level=$2'}
    ORDER BY i.updated_at DESC,i.id DESC LIMIT 60`,[ACTIVE_LIBRARY_TYPES,value])).rows;
}
