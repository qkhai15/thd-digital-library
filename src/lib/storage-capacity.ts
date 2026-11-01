import "server-only";
import { db } from "@/lib/db";
import { storageCapacityBudget } from "../../scripts/storage-capacity-policy.mjs";

// An admission budget, not a replacement for the provider's quota enforcement.
// Only authenticated upload paths call this; public pages/health do not.
export const storageFullMessage = "Storage gần đầy hoặc không đủ dung lượng cho file này. Vui lòng liên hệ quản trị để dọn file đã được duyệt hoặc bổ sung dung lượng; file chưa được tải lên.";

export async function storageCapacityAvailable(requiredBytes: number, connection: Pick<typeof db, "query"> = db) {
  if (process.env.NODE_ENV !== "production" && !process.env.STORAGE_CAPACITY_LIMIT_BYTES) return true;
  const { limit, headroom } = storageCapacityBudget();
  if (![limit, headroom, requiredBytes].every(Number.isSafeInteger) || limit <= 0 || headroom < 0 || requiredBytes <= 0) throw new Error("Invalid Storage capacity budget.");
  // Include every bucket, not only public assets. Outstanding signed uploads
  // reserve both the private source and public copy until they exist. No writes,
  // deletes, heavy Storage HTTP inventory or file bytes enter this check.
  const result = await connection.query(`WITH usage AS (
    SELECT COALESCE(SUM(CASE WHEN metadata->>'size' ~ '^[0-9]+$' THEN (metadata->>'size')::numeric ELSE 0 END),0) AS used,
      COUNT(*) FILTER (WHERE metadata->>'size' IS NULL OR metadata->>'size' !~ '^[0-9]+$') AS unknown
    FROM storage.objects
  ), reservations AS (
    SELECT COALESCE(SUM(
      GREATEST(0, i.expected_size - COALESCE((s.metadata->>'size')::numeric,0)) +
      GREATEST(0, i.expected_size - COALESCE((d.metadata->>'size')::numeric,0))
    ),0) AS reserved FROM public.storage_upload_intents i
    LEFT JOIN storage.objects s ON s.bucket_id=i.source_bucket AND s.name=i.source_key
    LEFT JOIN storage.objects d ON d.bucket_id=i.destination_bucket AND d.name=i.destination_key
    WHERE i.status='pending' AND i.expires_at > NOW()
  ) SELECT usage.used::text, usage.unknown::text, reservations.reserved::text FROM usage, reservations`);
  const { used, unknown, reserved } = result.rows[0] || {};
  const numbers = [Number(used), Number(reserved), Number(unknown)];
  if (!numbers.every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Storage capacity unavailable.");
  return Number(unknown) === 0 && Number(used) + Number(reserved) + requiredBytes + headroom <= limit;
}
