import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { borrowStockDelta, canTransitionBorrow } from "@/lib/borrow-rules";

export const BORROW_STATUSES = ["pending", "approved", "ready_for_pickup", "borrowed", "returned", "rejected", "cancelled"] as const;
export const ACTIVE_BORROW_STATUSES = ["pending", "approved", "ready_for_pickup", "borrowed"] as const;

export class BorrowWorkflowError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function createBorrowCode() {
  // 72 random bits; deliberately contains no sequential ID or reader details.
  return `BR-${randomBytes(9).toString("hex").toUpperCase()}`;
}

export function borrowIsOverdue(status: string, dueAt: string | Date | null | undefined, now = Date.now()) {
  return status === "borrowed" && Boolean(dueAt) && new Date(dueAt!).getTime() < now;
}

export function parseBorrowDueDate(value: unknown, now = Date.now()) {
  if (value === undefined || value === null || value === "") return new Date(now + 14 * 86400000).toISOString();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) {
    throw new BorrowWorkflowError("Hạn trả sách không hợp lệ.", 400);
  }
  // A date picked by the librarian means end of that school day (UTC+7).
  const date = new Date(value.length === 10 ? `${value}T16:59:59.999Z` : value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)
    || date.getTime() <= now || date.getTime() > now + 366 * 86400000) {
    throw new BorrowWorkflowError("Hạn trả phải ở tương lai và trong vòng một năm.", 400);
  }
  return date.toISOString();
}

/** Caller owns transaction. All circulation writes lock item, then request. */
export async function transitionBorrow(client: PoolClient, id: number, next: string, actor: string, dueAt?: unknown) {
  const found = await client.query("SELECT item_id FROM borrow_requests WHERE id=$1", [id]);
  if (!found.rows[0]) throw new BorrowWorkflowError("Không tìm thấy yêu cầu.", 404);
  await client.query("SELECT id FROM library_items WHERE id=$1 FOR UPDATE", [found.rows[0].item_id]);
  const current = await client.query(`SELECT b.*,i.stock,i.type FROM borrow_requests b
    JOIN library_items i ON i.id=b.item_id WHERE b.id=$1 FOR UPDATE OF b`, [id]);
  const row = current.rows[0];
  if (!row) throw new BorrowWorkflowError("Không tìm thấy yêu cầu.", 404);
  if (!canTransitionBorrow(row.status, next)) throw new BorrowWorkflowError("Không thể chuyển sang trạng thái này. Hãy thực hiện đúng thứ tự giao/nhận sách.", 409);
  // An old web process can insert during the additive migration/deploy window.
  // Its row receives the DB code default, but it cannot write the new timeline.
  // Under the request lock, capture its current state once without fabricating
  // past transitions or changing its existing reservation/timestamps.
  await client.query(`INSERT INTO borrow_events(request_id,from_status,to_status,actor)
    SELECT $1,NULL,$2,'migration'
    WHERE NOT EXISTS (SELECT 1 FROM borrow_events WHERE request_id=$1)`, [id, row.status]);
  if (row.status === next) return { ...row, is_overdue: borrowIsOverdue(row.status, row.due_at) };
  const delta = borrowStockDelta(row.status, next);
  if (delta === -1) {
    if (row.type !== "sach-giay" || (row.stock ?? 0) <= 0) throw new BorrowWorkflowError("Sách đã hết, không thể duyệt.", 409);
    const reserved = await client.query(`UPDATE library_items SET stock=stock-1,updated_at=NOW()
      WHERE id=$1 AND stock>0 RETURNING stock`, [row.item_id]);
    if (!reserved.rowCount) throw new BorrowWorkflowError("Sách đã hết, không thể duyệt.", 409);
  } else if (delta === 1) {
    await client.query("UPDATE library_items SET stock=COALESCE(stock,0)+1,updated_at=NOW() WHERE id=$1", [row.item_id]);
  }
  const due = next === "borrowed" ? parseBorrowDueDate(dueAt) : null;
  const updated = await client.query(`UPDATE borrow_requests SET status=$1::text,
    approved_at=CASE WHEN $1::text='approved' THEN COALESCE(approved_at,NOW()) ELSE approved_at END,
    ready_at=CASE WHEN $1::text='ready_for_pickup' THEN COALESCE(ready_at,NOW()) ELSE ready_at END,
    borrowed_at=CASE WHEN $1::text='borrowed' THEN COALESCE(borrowed_at,NOW()) ELSE borrowed_at END,
    due_at=CASE WHEN $1::text='borrowed' THEN $3::timestamptz ELSE due_at END,
    returned_at=CASE WHEN $1::text='returned' THEN COALESCE(returned_at,NOW()) ELSE returned_at END,
    rejected_at=CASE WHEN $1::text='rejected' THEN COALESCE(rejected_at,NOW()) ELSE rejected_at END,
    cancelled_at=CASE WHEN $1::text='cancelled' THEN COALESCE(cancelled_at,NOW()) ELSE cancelled_at END,
    updated_at=NOW() WHERE id=$2 RETURNING *`, [next, id, due]);
  await client.query(`INSERT INTO borrow_events(request_id,from_status,to_status,actor) VALUES($1,$2,$3,$4)`, [id, row.status, next, actor]);
  await client.query(`INSERT INTO audit_logs(username,action,entity_type,entity_id,details)
    VALUES($1,'borrow_status','borrow_request',$2,$3::jsonb)`, [actor, String(id), JSON.stringify({ from: row.status, to: next, item_id: row.item_id })]);
  return { ...updated.rows[0], is_overdue: borrowIsOverdue(next, updated.rows[0].due_at) };
}
