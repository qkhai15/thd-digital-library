import { jsonBody } from "@/lib/backend-utils";
import { NextResponse } from "next/server";
import { auditLog, isAdmin } from "@/lib/admin-auth";
import { sameOriginAllowed } from "@/lib/backend-utils";
import { db, ensureSchema } from "@/lib/db";
import { documentInput } from "@/lib/document-input";
import { publicationTransition } from "@/lib/publication-policy";
import { invalidateSearchSuggestions } from "@/lib/search-suggestions-cache";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  await ensureSchema();

  const result = await db.query(`SELECT * FROM library_items ORDER BY created_at DESC, id DESC`);
  return NextResponse.json(result.rows);
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  if (!sameOriginAllowed(request)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  await ensureSchema();

  const body = await jsonBody(request);
  if (body instanceof NextResponse) return body;
  let input;
  try {
    input = documentInput(body);
  } catch (error) {
    return NextResponse.json({message: error instanceof Error ? error.message : "Dữ liệu không hợp lệ."}, {status:400});
  }
  const {title,author,type,category,classLevel,format,coverUrl,fileUrl,description,isFeatured,galleryUrls,status,stock} = input;

  const result = await db.query(
    `INSERT INTO library_items
     (title,author,type,category,class_level,format,cover_url,file_url,gallery_urls,description,stock,is_featured,status,published_at,
      publisher,publication_year,isbn,language,page_count,subject_id,topics,tags,source,rights)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,CASE WHEN $13::varchar='published' THEN NOW() ELSE NULL END,
      $14,$15,$16,$17,$18,$19,$20::text[],$21::text[],$22,$23
     WHERE $19::integer IS NULL OR EXISTS(SELECT 1 FROM library_subjects WHERE id=$19 AND is_active)
     RETURNING *`,
    [title, author, type, category, classLevel, format, coverUrl, fileUrl, JSON.stringify(galleryUrls), description, stock, isFeatured, status,
     input.metadata.publisher,input.metadata.publication_year,input.metadata.isbn,input.metadata.language,input.metadata.page_count,input.metadata.subject_id,input.metadata.topics,input.metadata.tags,input.metadata.source,input.metadata.rights]
  );

  if(!result.rows[0]) return NextResponse.json({message:'Môn học không tồn tại hoặc đã ẩn.'},{status:400});
  invalidateSearchSuggestions();
  await auditLog("create", "library_item", String(result.rows[0].id), { title, type, status, publicationAction: publicationTransition(undefined, status).action });
  return NextResponse.json(result.rows[0], { status: 201 });
}
