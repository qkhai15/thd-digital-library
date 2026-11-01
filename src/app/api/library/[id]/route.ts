import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { parsePositiveInt } from "@/lib/backend-utils";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();
  const { id } = await params;
  const itemId = parsePositiveInt(id);
  if (!itemId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });

  const result = await db.query(
    `SELECT * FROM library_items WHERE id=$1 AND status='published' LIMIT 1`,
    [itemId]
  );

  if (!result.rows[0]) {
    return NextResponse.json({ message: "Không tìm thấy tài liệu." }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}
