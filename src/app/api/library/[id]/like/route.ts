import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { ensureVisitorId, parsePositiveInt, visitorIdFromRequest, sameOriginAllowed, logBackendError } from "@/lib/backend-utils";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const itemId = parsePositiveInt(id);
  if (!itemId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });

  const response = NextResponse.json({});
  const visitorId = ensureVisitorId(request, response);

  const [item, liked] = await Promise.all([
    db.query(`SELECT likes FROM library_items WHERE id=$1 AND status='published'`, [itemId]),
    db.query(`SELECT 1 FROM library_likes WHERE item_id=$1 AND visitor_id=$2`, [itemId, visitorId]),
  ]);

  if (!item.rows[0]) return NextResponse.json({ message: "Không tìm thấy tài liệu." }, { status: 404 });

  const out = NextResponse.json({ likes: item.rows[0].likes, liked: liked.rowCount === 1 });
  ensureVisitorId(request, out);
  return out;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  await ensureSchema();
  const { id } = await params;
  const itemId = parsePositiveInt(id);
  if (!itemId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });

  const seedResponse = NextResponse.json({});
  const visitorId = visitorIdFromRequest(request) || ensureVisitorId(request, seedResponse);
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const item = await client.query(`SELECT likes FROM library_items WHERE id=$1 AND status='published' FOR UPDATE`, [itemId]);
    if (!item.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ message: "Không tìm thấy tài liệu." }, { status: 404 });
    }

    const existing = await client.query(`SELECT 1 FROM library_likes WHERE item_id=$1 AND visitor_id=$2`, [itemId, visitorId]);
    let liked = false;

    if (existing.rowCount) {
      await client.query(`DELETE FROM library_likes WHERE item_id=$1 AND visitor_id=$2`, [itemId, visitorId]);
      await client.query(`UPDATE library_items SET likes=GREATEST(likes-1,0), updated_at=NOW() WHERE id=$1`, [itemId]);
    } else {
      await client.query(`INSERT INTO library_likes(item_id,visitor_id) VALUES($1,$2)`, [itemId, visitorId]);
      await client.query(`UPDATE library_items SET likes=likes+1, updated_at=NOW() WHERE id=$1`, [itemId]);
      liked = true;
    }

    const updated = await client.query(`SELECT likes FROM library_items WHERE id=$1`, [itemId]);
    await client.query("COMMIT");

    const response = NextResponse.json({ liked, likes: updated.rows[0].likes });
    ensureVisitorId(request, response);
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    logBackendError("LIKE ERROR", error);
    return NextResponse.json({ message: "Không thể cập nhật yêu thích." }, { status: 500 });
  } finally {
    client.release();
  }
}
