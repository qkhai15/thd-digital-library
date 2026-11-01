import { db, ensureSchema } from "@/lib/db";
import { ACTIVE_LIBRARY_TYPES } from "@/lib/library-types";
import { getItemHref } from "@/lib/library-url";
import { publicUrl } from "@/lib/public-metadata";

const BATCH_SIZE = 1000;
const MAX_URLS = 50_000;

type SitemapEntry = { path: string; lastModified?: Date | string };

function xmlEscape(value: string) {
  return value.replace(/[<>&"']/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);
}

export function serializeSitemap(entries: SitemapEntry[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(entry => {
    const lastModified = entry.lastModified ? new Date(entry.lastModified) : null;
    return `<url><loc>${xmlEscape(publicUrl(entry.path))}</loc>${lastModified && Number.isFinite(lastModified.getTime()) ? `<lastmod>${lastModified.toISOString()}</lastmod>` : ""}</url>`;
  }).join("\n")}\n</urlset>`;
}

export async function getPublicSitemap() {
  await ensureSchema();
  const entries: SitemapEntry[] = [
    { path: "/" }, { path: "/gioi-thieu" }, { path: "/tin-tuc" }, {path:'/bo-suu-tap'}, {path:'/kham-pha'},
    ...['10','11','12','Khác'].map(grade=>({path:`/khoi-lop/${encodeURIComponent(grade)}`})),
    { path: "/tai-lieu/moi-nhat" }, { path: "/tai-lieu/thinh-hanh" },
    ...ACTIVE_LIBRARY_TYPES.map(type => ({ path: `/tai-lieu/${type}` })),
  ];
  // Only fetch URL fields and use keyset batches: large media/content never enters memory.
  let lastId = 0;
  for (;;) {
    const result = await db.query<{ id: number; type: string; title: string; updated_at: Date }>(
      `SELECT id,type,title,updated_at FROM library_items
       WHERE status='published' AND type=ANY($1::text[]) AND id > $2
       ORDER BY id ASC LIMIT $3`, [ACTIVE_LIBRARY_TYPES, lastId, BATCH_SIZE]
    );
    for (const item of result.rows) entries.push({ path: getItemHref(item), lastModified: item.updated_at });
    if (entries.length > MAX_URLS) throw new Error("Sitemap cần được chia thành nhiều phần.");
    if (result.rows.length < BATCH_SIZE) break;
    lastId = result.rows.at(-1)!.id;
  }
  lastId = 0;
  for (;;) {
    const result = await db.query<{ id: number; slug: string; updated_at: Date }>(
      `SELECT id,slug,updated_at FROM news_posts
       WHERE status='published' AND id > $1 ORDER BY id ASC LIMIT $2`, [lastId, BATCH_SIZE]
    );
    for (const news of result.rows) entries.push({ path: `/tin-tuc/${encodeURIComponent(news.slug)}`, lastModified: news.updated_at });
    if (entries.length > MAX_URLS) throw new Error("Sitemap cần được chia thành nhiều phần.");
    if (result.rows.length < BATCH_SIZE) break;
    lastId = result.rows.at(-1)!.id;
  }
  for(const kind of ['collections','subjects'] as const){
    lastId=0;
    for(;;){
      const result=await db.query<{id:number;slug:string;updated_at:Date}>(
        `SELECT id,slug,updated_at FROM ${kind==='collections'?'library_collections':'library_subjects'}
         WHERE ${kind==='collections'?"status='published'":'is_active'} AND id > $1 ORDER BY id ASC LIMIT $2`,[lastId,BATCH_SIZE]);
      for(const row of result.rows)entries.push({path:`/${kind==='collections'?'bo-suu-tap':'mon-hoc'}/${encodeURIComponent(row.slug)}`,lastModified:row.updated_at});
      if(entries.length>MAX_URLS)throw new Error('Sitemap cần được chia thành nhiều phần.');
      if(result.rows.length<BATCH_SIZE)break;
      lastId=result.rows.at(-1)!.id;
    }
  }
  return serializeSitemap(entries);
}
