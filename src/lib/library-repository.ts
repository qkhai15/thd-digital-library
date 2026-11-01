import { db, ensureSchema } from "@/lib/db";
import type { CommentItem, DashboardStats, LibraryItem, NewsPost } from "@/lib/library-types";
import { boundedInt } from "@/lib/backend-utils";
import { sanitizeSearchInput, searchLikePattern, type SearchInput } from "@/lib/search-policy";

type ItemRow = Omit<LibraryItem,"created_at"|"updated_at"|"published_at"> & {created_at:Date|string;updated_at:Date|string;published_at?:Date|string|null;search_text?:string};
export function normalizeItem(row: ItemRow): LibraryItem {
  const safe = {...row};
  delete safe.search_text;
  return {
    ...safe,
    gallery_urls: Array.isArray(row.gallery_urls) ? row.gallery_urls : [],
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export async function getAllItems() {
  await ensureSchema();
  const r = await db.query(`SELECT * FROM library_items ORDER BY created_at DESC, id DESC`);
  return r.rows.map(normalizeItem);
}

export async function getPopularItems(limit = 8) {
  await ensureSchema();
  const r = await db.query(
    `SELECT *
     FROM library_items
     WHERE status='published'
       AND type NOT IN ('video','album','bai-giang-dien-tu','ky-nang-song')
     ORDER BY is_featured DESC, views DESC, created_at DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows.map(normalizeItem);
}

export async function getLatestItems(limit = 10) {
  await ensureSchema();
  const r = await db.query(
    `SELECT *
     FROM library_items
     WHERE status='published'
       AND type NOT IN ('video','album','bai-giang-dien-tu','ky-nang-song')
     ORDER BY COALESCE(published_at, created_at) DESC, id DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows.map(normalizeItem);
}

export async function getItemsByType(type: string, limit = 10) {
  await ensureSchema();
  const r = await db.query(
    `SELECT * FROM library_items
     WHERE type=$1 AND status='published'
     ORDER BY COALESCE(published_at, created_at) DESC, id DESC
     LIMIT $2`,
    [type, limit]
  );
  return r.rows.map(normalizeItem);
}

export async function getItemById(id: number) {
  await ensureSchema();
  const r = await db.query(
    `SELECT i.*,s.name subject_name,CASE WHEN s.is_active THEN s.slug ELSE NULL END subject_slug FROM library_items i LEFT JOIN library_subjects s ON s.id=i.subject_id WHERE i.id=$1 AND i.status='published' LIMIT 1`,
    [id]
  );
  return r.rows[0] ? normalizeItem(r.rows[0]) : null;
}

export async function getComments(itemId: number): Promise<CommentItem[]> {
  await ensureSchema();
  const r = await db.query(
    `SELECT id,item_id,name,content,status,created_at
     FROM library_comments
     WHERE item_id=$1 AND status='approved'
     ORDER BY created_at DESC
     LIMIT 100`,
    [itemId]
  );
  return r.rows.map((row) => ({ ...row, created_at: new Date(row.created_at).toISOString() }));
}

export function buildSearchQuery(raw: SearchInput) {
  const input = sanitizeSearchInput(raw);
  const { type, grade, subject, topic, tag, q = "" } = input;
  const where: string[] = [`i.status='published'`, `i.type NOT IN ('bai-giang-dien-tu','ky-nang-song')`];
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (type === "moi-nhat" || type === "thinh-hanh" || input.sort === "popular") where.push(`i.type NOT IN ('video','album')`);
  if (type && !["moi-nhat", "thinh-hanh"].includes(type)) where.push(`i.type=${bind(type)}`);
  if (grade) where.push(`i.class_level=${bind(grade)}`);
  if (subject) where.push(`s.slug=${bind(subject)}`);
  if (topic) where.push(`${bind(topic)}=ANY(i.topics)`);
  if (tag) where.push(`${bind(tag)}=ANY(i.tags)`);
  let relevance = "";
  if (q) {
    const pattern = bind(searchLikePattern(q));
    where.push(`(i.search_text LIKE ${pattern} ESCAPE '\\' OR public.thd_search_normalize(s.name) LIKE ${pattern} ESCAPE '\\')`);
    relevance = `CASE WHEN public.thd_search_normalize(i.title) LIKE ${pattern} ESCAPE '\\' THEN 8 ELSE 0 END + CASE WHEN public.thd_search_normalize(i.author) LIKE ${pattern} ESCAPE '\\' THEN 4 ELSE 0 END + CASE WHEN public.thd_search_normalize(s.name) LIKE ${pattern} ESCAPE '\\' THEN 3 ELSE 0 END`;
  }
  const orders: Record<string, string> = {
    relevance: relevance ? `(${relevance}) DESC, i.views DESC, i.id DESC` : "COALESCE(i.published_at,i.created_at) DESC,i.id DESC",
    newest: "COALESCE(i.published_at,i.created_at) DESC,i.id DESC",
    popular: "i.is_featured DESC,i.views DESC,COALESCE(i.published_at,i.created_at) DESC,i.id DESC",
    views: "i.views DESC,i.id DESC", likes: "i.likes DESC,i.views DESC,i.id DESC",
    az: "public.thd_search_normalize(i.title) ASC,i.id ASC",
  };
  return {input,values,whereSql:`WHERE ${where.join(" AND ")}`, orderSql:orders[type === "thinh-hanh" ? "popular" : input.sort || "newest"], fromSql:"FROM library_items i LEFT JOIN library_subjects s ON s.id=i.subject_id"};
}

export async function searchItems(raw: SearchInput) {
  await ensureSchema();
  const { input, whereSql, fromSql, orderSql, values } = buildSearchQuery(raw);
  const size = boundedInt(input.size, 24, 100);
  const requestedPage = boundedInt(input.page, 1, 1000000);
  const count = await db.query(`SELECT COUNT(*)::int AS total ${fromSql} ${whereSql}`, values);
  const total = count.rows[0].total as number;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / size)));

  const listValues = [...values, size, (page - 1) * size];
  const limitIndex = listValues.length - 1;
  const offsetIndex = listValues.length;
  const list = await db.query(
    `SELECT i.*,s.name AS subject_name,CASE WHEN s.is_active THEN s.slug ELSE NULL END AS subject_slug ${fromSql} ${whereSql}
     ORDER BY ${orderSql}
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    listValues
  );

  return { items: list.rows.map(normalizeItem), total, page, size, totalPages: Math.max(1, Math.ceil(total / size)) };
}

export async function getSearchSuggestions(query: string) {
  const q = sanitizeSearchInput({q:query}).q || "";
  if(q.length<2)return [];
  await ensureSchema();
  const {values,whereSql,fromSql,orderSql}=buildSearchQuery({q,sort:"relevance"});
  const result=await db.query(`SELECT i.id,i.title,i.author,i.type ${fromSql} ${whereSql} ORDER BY ${orderSql} LIMIT 6`,values);
  return result.rows as Pick<LibraryItem,"id"|"title"|"author"|"type">[];
}

export async function getSearchFacets() {
  await ensureSchema();
  const [subjects,topics]=await Promise.all([
    db.query(`SELECT id,name,slug FROM library_subjects WHERE is_active ORDER BY sort_order,name,id LIMIT 200`),
    db.query(`SELECT DISTINCT unnest(topics) AS topic FROM library_items WHERE status='published' AND type NOT IN ('bai-giang-dien-tu','ky-nang-song') ORDER BY topic LIMIT 100`),
  ]);
  return {subjects:subjects.rows as {id:number;name:string;slug:string}[],topics:topics.rows.map(row=>String(row.topic))};
}

export async function getWallBanners() {
  await ensureSchema();
  const r = await db.query(
    `SELECT id,title,image_url,link_url,is_active,sort_order
     FROM wall_banners
     WHERE is_active=TRUE
     ORDER BY sort_order ASC, id ASC`
  );
  return r.rows;
}


type NewsRow = Omit<NewsPost,"created_at"|"updated_at"|"published_at"> & {created_at:Date|string;updated_at:Date|string;published_at:Date|string|null};
function normalizeNews(row: NewsRow): NewsPost {
  return {
    ...row,
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export async function getNewsPosts(limit = 50) {
  await ensureSchema();
  const safeLimit = boundedInt(limit, 50, 100);
  const r = await db.query(
    `SELECT id,title,slug,excerpt,content,cover_url,status,is_featured,published_at,created_at,updated_at
     FROM news_posts
     WHERE status='published'
     ORDER BY is_featured DESC, COALESCE(published_at, created_at) DESC, id DESC
     LIMIT $1`,
    [safeLimit]
  );
  return r.rows.map(normalizeNews);
}

export async function getNewsBySlug(slug: string) {
  await ensureSchema();
  const r = await db.query(
    `SELECT id,title,slug,excerpt,content,cover_url,status,is_featured,published_at,created_at,updated_at
     FROM news_posts
     WHERE slug=$1 AND status='published'
     LIMIT 1`,
    [slug]
  );
  return r.rows[0] ? normalizeNews(r.rows[0]) : null;
}

export async function searchNews(pageInput = 1, sizeInput = 12) {
  await ensureSchema();
  const size = boundedInt(sizeInput,12,100);
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM news_posts WHERE status='published'`);
  const total = Number(count.rows[0].total);
  const totalPages = Math.max(1,Math.ceil(total/size));
  const page = Math.min(boundedInt(pageInput,1,1000000),totalPages);
  const result = await db.query(`SELECT * FROM news_posts WHERE status='published'
    ORDER BY is_featured DESC,COALESCE(published_at,created_at) DESC,id DESC LIMIT $1 OFFSET $2`,[size,(page-1)*size]);
  return {items:result.rows.map(normalizeNews),page,total,totalPages};
}

export async function getDashboardStats(): Promise<DashboardStats> {
  await ensureSchema();
  const [items, comments, borrows, views, news, banners] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status='published')::int AS published FROM library_items`),
    db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status='pending')::int AS pending FROM library_comments`),
    db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status='pending')::int AS pending FROM borrow_requests`),
    db.query(`SELECT COALESCE(SUM(views),0)::int AS total FROM library_items`),
    db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE status='published')::int AS published FROM news_posts`),
    db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE is_active=TRUE)::int AS active FROM wall_banners`),
  ]);

  return {
    items: items.rows[0],
    comments: comments.rows[0],
    borrows: borrows.rows[0],
    views: Number(views.rows[0]?.total ?? 0),
    news: news.rows[0],
    banners: banners.rows[0],
  };
}
