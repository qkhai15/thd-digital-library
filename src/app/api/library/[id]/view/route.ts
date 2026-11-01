import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { ensureVisitorId, parsePositiveInt, visitorIdFromRequest, sameOriginAllowed } from "@/lib/backend-utils";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  await ensureSchema();
  const { id } = await params;
  const itemId = parsePositiveInt(id);
  if (!itemId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });

  const seedResponse = NextResponse.json({});
  const visitorId = visitorIdFromRequest(request) || ensureVisitorId(request, seedResponse);

  const inserted = await db.query(
    `WITH counted AS (INSERT INTO library_views(item_id,visitor_id,view_day)
     SELECT $1,$2,CURRENT_DATE
     WHERE EXISTS (SELECT 1 FROM library_items WHERE id=$1 AND status='published')
     ON CONFLICT DO NOTHING
     RETURNING item_id)
     UPDATE library_items SET views=views+1,updated_at=NOW()
     WHERE id IN (SELECT item_id FROM counted) RETURNING id`,
    [itemId, visitorId]
  );

  const result = await db.query(`SELECT views FROM library_items WHERE id=$1 AND status='published'`, [itemId]);
  if (!result.rows[0]) return NextResponse.json({ message: "Không tìm thấy tài liệu." }, { status: 404 });

  const response = NextResponse.json({ views: result.rows[0].views, counted: Boolean(inserted.rowCount) });
  ensureVisitorId(request, response);
  return response;
}
