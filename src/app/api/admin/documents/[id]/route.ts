import { retainedMedia } from "@/lib/upload-references";
import { jsonBody } from "@/lib/backend-utils";
import { NextResponse } from "next/server";
import { auditLog, isAdmin } from "@/lib/admin-auth";
import { parsePositiveInt, sameOriginAllowed, logBackendError } from "@/lib/backend-utils";
import { db, ensureSchema } from "@/lib/db";
import { documentInput } from "@/lib/document-input";
import { publicationTransition } from "@/lib/publication-policy";
import { invalidateSearchSuggestions } from "@/lib/search-suggestions-cache";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  if (!(await isAdmin())) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  await ensureSchema();
  const { id } = await context.params;
  const itemId = parsePositiveInt(id);
  if (!itemId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });
  const result = await db.query(`SELECT * FROM library_items WHERE id=$1 LIMIT 1`, [itemId]);
  if (!result.rows[0]) return NextResponse.json({ message: "Không tìm thấy tài liệu." }, { status: 404 });
  return NextResponse.json(result.rows[0]);
}

export async function PUT(request: Request, context: Context) {
  if (!(await isAdmin())) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  if (!sameOriginAllowed(request)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  await ensureSchema();

  const { id } = await context.params;
  const itemId = parsePositiveInt(id);
  if (!itemId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });

  const current = await db.query(`SELECT * FROM library_items WHERE id=$1 LIMIT 1`, [itemId]);
  if (!current.rows[0]) return NextResponse.json({ message: "Không tìm thấy tài liệu." }, { status: 404 });

  const body = await jsonBody(request);
  if (body instanceof NextResponse) return body;
  let input;
  try {
    input = documentInput({...current.rows[0],...body}, current.rows[0].type);
    publicationTransition(current.rows[0].status, input.status);
  } catch (error) {
    return NextResponse.json({message: error instanceof Error ? error.message : "Dữ liệu không hợp lệ."}, {status:400});
  }
  const {title,author,type,category,classLevel,format,coverUrl,fileUrl,description,isFeatured,galleryUrls,status,stock} = input;
  const expectedStock = body.expected_stock === undefined ? current.rows[0].stock : body.expected_stock;
  if (expectedStock !== null && (!Number.isSafeInteger(expectedStock) || expectedStock < 0 || expectedStock > 2147483647)) return NextResponse.json({message:"Tồn kho ban đầu không hợp lệ."},{status:400});

  const result = await db.query(
    `UPDATE library_items SET
       title=$1,author=$2,type=$3,category=$4,class_level=$5,format=$6,
       cover_url=$7,file_url=$8,gallery_urls=$9::jsonb,description=$10,
       stock=CASE WHEN $11::integer IS NOT DISTINCT FROM $15::integer THEN stock ELSE $11::integer END,
       is_featured=$12,status=$13,
       published_at=CASE WHEN $13::varchar='published' THEN COALESCE(published_at,NOW()) ELSE published_at END,
       updated_at=NOW(),publisher=$16,publication_year=$17,isbn=$18,language=$19,page_count=$20,
       subject_id=$21,topics=$22::text[],tags=$23::text[],source=$24,rights=$25
     WHERE id=$14
       AND ($11::integer IS NOT DISTINCT FROM $15::integer OR stock IS NOT DISTINCT FROM $15::integer)
       AND (type=$3 OR NOT EXISTS (SELECT 1 FROM borrow_requests WHERE item_id=$14 AND status IN ('pending','approved','ready_for_pickup','borrowed')))
       AND ($21::integer IS NULL OR $21::integer IS NOT DISTINCT FROM subject_id OR EXISTS(SELECT 1 FROM library_subjects WHERE id=$21 AND is_active))
       AND status IS NOT DISTINCT FROM $26::varchar
     RETURNING *`,
    [title, author, type, category, classLevel, format, coverUrl, fileUrl, JSON.stringify(galleryUrls), description, stock, isFeatured, status, itemId, expectedStock,
     input.metadata.publisher,input.metadata.publication_year,input.metadata.isbn,input.metadata.language,input.metadata.page_count,input.metadata.subject_id,input.metadata.topics,input.metadata.tags,input.metadata.source,input.metadata.rights,current.rows[0].status]
  );

  if (!result.rows[0]) return NextResponse.json({message:"Tồn kho, trạng thái hoặc môn học đã thay đổi; sách cũng có thể có yêu cầu mượn đang xử lý. Hãy tải lại trước khi sửa."},{status:409});

  invalidateSearchSuggestions();
  await auditLog("update", "library_item", String(itemId), { title, type, fromStatus:current.rows[0].status,status, publicationAction: publicationTransition(current.rows[0].status, status).action, ...retainedMedia(current.rows[0], result.rows[0]) });
  return NextResponse.json(result.rows[0]);
}

export async function DELETE(request: Request, context: Context) {
  if (!(await isAdmin())) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  if (!sameOriginAllowed(request)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  await ensureSchema();

  const { id } = await context.params;
  const itemId = parsePositiveInt(id);
  if (!itemId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });

  const client = await db.connect();
  let transactionOpen = true;
  try {
    await client.query("BEGIN");
    const item = await client.query(`SELECT * FROM library_items WHERE id=$1 FOR UPDATE`,[itemId]);
    if (!item.rows[0]) return NextResponse.json({message:"Không tìm thấy tài liệu."},{status:404});
    const history = await client.query(`SELECT 1 FROM borrow_requests WHERE item_id=$1 LIMIT 1`,[itemId]);
    if (history.rowCount) return NextResponse.json({message:"Tài liệu có lịch sử mượn. Hãy chuyển sang Lưu trữ thay vì xóa."},{status:409});
    await client.query(`DELETE FROM library_items WHERE id=$1`,[itemId]);
    await client.query("COMMIT");
    transactionOpen = false;
    invalidateSearchSuggestions();
    await auditLog("delete","library_item",String(itemId),{title:item.rows[0].title, ...retainedMedia(item.rows[0])});
    return NextResponse.json({ok:true});
  } catch (error) {
    logBackendError("DELETE DOCUMENT",error);
    return NextResponse.json({message:"Không thể xóa tài liệu."},{status:500});
  } finally {
    try { if (transactionOpen) await client.query("ROLLBACK"); }
    finally { client.release(); }
  }
}
