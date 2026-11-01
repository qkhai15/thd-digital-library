import { NextResponse } from "next/server";
import { getAdminSession, isAdmin } from "@/lib/admin-auth";
import { jsonBody, parsePositiveInt, sameOriginAllowed, logBackendError } from "@/lib/backend-utils";
import { db, ensureSchema } from "@/lib/db";
import { BORROW_STATUSES, BorrowWorkflowError, transitionBorrow } from "@/lib/borrow-workflow";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  if (!(await isAdmin())) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  if (!sameOriginAllowed(request)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  const { id } = await ctx.params;
  const borrowId = parsePositiveInt(id);
  if (!borrowId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });
  const body = await jsonBody(request);
  if (body instanceof NextResponse) return body;
  const next = String(body.status ?? "");
  if (!(BORROW_STATUSES as readonly string[]).includes(next)) return NextResponse.json({ message: "Trạng thái không hợp lệ." }, { status: 400 });
  await ensureSchema();
  const session = await getAdminSession();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const updated = await transitionBorrow(client, borrowId, next, session?.username ?? "admin", body.due_at);
    await client.query("COMMIT");
    return NextResponse.json(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof BorrowWorkflowError) return NextResponse.json({ message: error.message }, { status: error.status });
    if (error && typeof error === "object" && "code" in error && ["55P03", "57014"].includes(String(error.code))) {
      return NextResponse.json({ message: "Yêu cầu đang được xử lý ở phiên khác. Vui lòng tải lại và thử lại." }, { status: 409 });
    }
    logBackendError("BORROW STATUS", error);
    return NextResponse.json({ message: "Không thể cập nhật yêu cầu mượn." }, { status: 500 });
  } finally { client.release(); }
}
