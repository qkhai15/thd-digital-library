import { jsonBody } from "@/lib/backend-utils";
import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { cleanText, ensureVisitorId, parsePositiveInt, visitorIdFromRequest, sameOriginAllowed, logBackendError } from "@/lib/backend-utils";
import { createBorrowCode } from "@/lib/borrow-workflow";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  await ensureSchema();
  const { id } = await params;
  const itemId = parsePositiveInt(id);
  if (!itemId) return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });

  const body = await jsonBody(request);
  if (body instanceof NextResponse) return body;
  const borrowerName = cleanText(body.borrower_name, 150);
  const className = cleanText(body.class_name, 80);
  const phone = cleanText(body.phone, 40);
  const email = cleanText(body.email, 180);
  const note = cleanText(body.note, 1000);

  if (borrowerName.length < 2) {
    return NextResponse.json({ message: "Vui lòng nhập họ tên người mượn." }, { status: 400 });
  }
  if (!phone && !email) {
    return NextResponse.json({ message: "Vui lòng nhập số điện thoại hoặc email liên hệ." }, { status: 400 });
  }

  const seedResponse = NextResponse.json({});
  const visitorId = visitorIdFromRequest(request) || ensureVisitorId(request, seedResponse);
  const client = await db.connect();
  let transactionOpen = true;
  try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='15s'");
  const item = await client.query(
    `SELECT id,title,type,stock FROM library_items WHERE id=$1 AND status='published' FOR UPDATE`,
    [itemId]
  );
  if (!item.rows[0]) return NextResponse.json({ message: "Không tìm thấy sách." }, { status: 404 });
  if (item.rows[0].type !== "sach-giay") {
    return NextResponse.json({ message: "Chỉ sách giấy mới có thể đăng ký mượn." }, { status: 400 });
  }
  if ((item.rows[0].stock ?? 0) <= 0) {
    return NextResponse.json({ message: "Sách hiện đã hết." }, { status: 409 });
  }

  const duplicate = await client.query(
    `SELECT id FROM borrow_requests
     WHERE item_id=$1 AND visitor_id=$2 AND status IN ('pending','approved','ready_for_pickup','borrowed')
     LIMIT 1`,
    [itemId, visitorId]
  );
  if (duplicate.rowCount) {
    return NextResponse.json({ message: "Bạn đã có một yêu cầu mượn cuốn sách này đang được xử lý." }, { status: 409 });
  }

  const result = await client.query(
    `INSERT INTO borrow_requests
     (item_id,visitor_id,borrower_name,class_name,phone,email,note,status,request_code,requested_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8,NOW())
     RETURNING id,item_id,request_code,status,requested_at`,
    [itemId, visitorId, borrowerName, className, phone, email, note, createBorrowCode()]
  );
  await client.query(`INSERT INTO borrow_events(request_id,from_status,to_status,actor) VALUES($1,NULL,'pending','reader')`, [result.rows[0].id]);

  await client.query("COMMIT");
  transactionOpen = false;
  const response = NextResponse.json({
    ...result.rows[0],
    message: `Đã gửi yêu cầu mượn sách. Mã nhận sách: ${result.rows[0].request_code}. Vui lòng lưu mã và chờ thư viện xác nhận.`,
  }, { status: 201 });
  ensureVisitorId(request, response);
  return response;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["55P03", "57014"].includes(String(error.code))) {
      return NextResponse.json({ message: "Sách đang được cập nhật. Vui lòng thử lại sau ít giây." }, { status: 409 });
    }
    logBackendError("BORROW REQUEST", error);
    return NextResponse.json({message:"Không thể gửi yêu cầu mượn."},{status:500});
  } finally {
    try { if (transactionOpen) await client.query("ROLLBACK"); }
    finally { client.release(); }
  }
}
