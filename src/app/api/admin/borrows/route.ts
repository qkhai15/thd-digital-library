import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { db, ensureSchema } from "@/lib/db";
import { boundedInt, cleanText, logBackendError } from "@/lib/backend-utils";
import { BORROW_STATUSES } from "@/lib/borrow-workflow";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  await ensureSchema();
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";
  if (status && status !== "overdue" && !(BORROW_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ message: "Trạng thái không hợp lệ." }, { status: 400 });
  }
  const values: unknown[] = [];
  const clauses: string[] = [];
  if (status === "overdue") clauses.push("b.status='borrowed' AND b.due_at<NOW()");
  else if (status) { values.push(status); clauses.push(`b.status=$${values.length}`); }
  const code = cleanText(url.searchParams.get("code"), 24).toUpperCase();
  if (code) {
    if (!/^[A-Z0-9-]+$/.test(code)) return NextResponse.json({ message: "Mã yêu cầu không hợp lệ." }, { status: 400 });
    values.push(`${code}%`); clauses.push(`b.request_code LIKE $${values.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const count = await db.query(`SELECT COUNT(*)::int total FROM borrow_requests b ${where}`, values);
    const total = Number(count.rows[0].total);
    const size = boundedInt(url.searchParams.get("limit"), 25, 100);
    const totalPages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(boundedInt(url.searchParams.get("page"), 1, 1000000), totalPages);
    const result = await db.query(`SELECT b.*,i.title AS item_title,i.stock,
      COALESCE((b.status='borrowed' AND b.due_at<NOW()),false) AS is_overdue,
      COALESCE(events.timeline,'[]'::jsonb) AS timeline
      FROM borrow_requests b JOIN library_items i ON i.id=b.item_id
      LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',e.id,'from_status',e.from_status,
        'to_status',e.to_status,'actor',e.actor,'created_at',e.created_at) ORDER BY e.created_at,e.id) timeline
        FROM borrow_events e WHERE e.request_id=b.id) events ON true
      ${where} ORDER BY b.created_at DESC,b.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, size, (page - 1) * size]);
    return NextResponse.json(result.rows, { headers: { "Cache-Control": "no-store", "X-Total-Count": String(total), "X-Total-Pages": String(totalPages), "X-Page": String(page) } });
  } catch (error) {
    logBackendError("LIST BORROWS", error);
    return NextResponse.json({ message: "Không thể tải yêu cầu mượn." }, { status: 500 });
  }
}
