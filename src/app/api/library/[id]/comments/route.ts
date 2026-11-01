import { jsonBody } from "@/lib/backend-utils";
import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { cleanText, ensureVisitorId, parsePositiveInt, visitorIdFromRequest, sameOriginAllowed, logBackendError } from "@/lib/backend-utils";
import { commentsRequireApproval } from "@/lib/site-settings";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const itemId = parsePositiveInt(id);
  if (!itemId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });

  const result = await db.query(
    `SELECT id,item_id,name,content,status,created_at
     FROM library_comments
     WHERE item_id=$1 AND status='approved'
       AND EXISTS (SELECT 1 FROM library_items WHERE id=$1 AND status='published')
     ORDER BY created_at DESC
     LIMIT 100`,
    [itemId]
  );
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  await ensureSchema();
  const { id } = await params;
  const itemId = parsePositiveInt(id);
  if (!itemId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });

  const body = await jsonBody(request);
  if (body instanceof NextResponse) return body;
  const name = cleanText(body.name, 120);
  const content = cleanText(body.content, 2000);
  if (name.length < 2 || content.length < 2) {
    return NextResponse.json({ message: "Vui lòng nhập tên và nội dung bình luận." }, { status: 400 });
  }

  const seedResponse = NextResponse.json({});
  const visitorId = visitorIdFromRequest(request) || ensureVisitorId(request, seedResponse);
  const status = await commentsRequireApproval() ? "pending" : "approved";
  const client = await db.connect();
  let transactionOpen = true;
  try {
  await client.query("BEGIN");
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[visitorId]);

  const item = await client.query(`SELECT 1 FROM library_items WHERE id=$1 AND status='published'`, [itemId]);
  if (!item.rowCount) return NextResponse.json({ message: "Không tìm thấy tài liệu." }, { status: 404 });

  const recent = await client.query(
    `SELECT COUNT(*)::int AS count FROM library_comments
     WHERE visitor_id=$1 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [visitorId]
  );
  if (recent.rows[0].count >= 5) {
    return NextResponse.json({ message: "Bạn gửi bình luận quá nhanh. Vui lòng thử lại sau." }, { status: 429 });
  }

  const result = await client.query(
    `INSERT INTO library_comments(item_id,visitor_id,name,content,status)
     VALUES($1,$2,$3,$4,$5)
     RETURNING id,item_id,name,content,status,created_at`,
    [itemId, visitorId, name, content, status]
  );
  await client.query("COMMIT");
  transactionOpen = false;

  const response = NextResponse.json({
    ...result.rows[0],
    message: status === "pending" ? "Bình luận đã gửi và đang chờ duyệt." : "Đã gửi bình luận.",
  }, { status: 201 });
  ensureVisitorId(request, response);
  return response;
  } catch (error) {
    logBackendError("POST COMMENT",error);
    return NextResponse.json({message:"Không thể gửi bình luận."},{status:500});
  } finally {
    try { if (transactionOpen) await client.query("ROLLBACK"); }
    finally { client.release(); }
  }
}
