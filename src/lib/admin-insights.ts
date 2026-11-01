import "server-only";
import { db, ensureSchema } from "@/lib/db";
import { getDashboardStats } from "@/lib/library-repository";
import { getSearchAnalytics } from "@/lib/search-analytics";
import { storageCapacityBudget, storageCapacityLevel } from "../../scripts/storage-capacity-policy.mjs";
import type { AdminDashboard, AdminInsights, AdminStorageUsage, DashboardItemSummary } from "@/lib/admin-insights-types";

// Reads are coalesced and bounded per process. Only the authenticated admin API
// calls these; no Storage HTTP listing is added to public pages or health.
export function createExpiringRead<T>(read: () => Promise<T>, ttl: number, now = Date.now) {
  let cached: { value: T; until: number } | undefined;
  let pending: Promise<T> | undefined;
  return async () => {
    if (cached && cached.until > now()) return cached.value;
    if (!pending) {
      pending = read().then(value => {
        cached = { value, until: now() + ttl };
        return value;
      }).finally(() => { pending = undefined; });
    }
    return pending;
  };
}

function count(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid dashboard count");
  return number;
}

function summary(row: DashboardItemSummary): DashboardItemSummary {
  return { id: row.id, title: row.title, type: row.type, status: row.status,
    views: count(row.views), created_at: new Date(row.created_at).toISOString() };
}

async function readStorageUsage(): Promise<AdminStorageUsage> {
  const measured_at = new Date().toISOString();
  try {
    const { limit } = storageCapacityBudget();
    const result = await db.query(`SELECT
      COALESCE(SUM(CASE WHEN metadata->>'size' ~ '^[0-9]+$' THEN (metadata->>'size')::numeric ELSE 0 END),0)::text AS used_bytes,
      COUNT(*)::text AS object_count,
      COUNT(*) FILTER (WHERE metadata->>'size' IS NULL OR metadata->>'size' !~ '^[0-9]+$')::text AS unknown
      FROM storage.objects`);
    const row = result.rows[0];
    if (!row || count(row.unknown) > 0) throw new Error("Storage usage unavailable");
    const used_bytes = count(row.used_bytes);
    return { status: storageCapacityLevel(used_bytes, limit), used_bytes, limit_bytes: limit,
      object_count: count(row.object_count), measured_at };
  } catch {
    // Some isolated/test databases have no Storage schema. A missing measurement
    // must not look like 0% used or make the whole admin dashboard unavailable.
    return { status: "unavailable", used_bytes: null, limit_bytes: null, object_count: null, measured_at };
  }
}

const storageUsage = createExpiringRead(readStorageUsage, 5 * 60_000);

async function readInsights(days: number): Promise<AdminInsights> {
  const [types, views, top, latest, circulation, search, storage] = await Promise.all([
    db.query(`SELECT type,COUNT(*)::int AS count FROM library_items GROUP BY type ORDER BY type`),
    db.query(`SELECT COUNT(*)::int AS count FROM library_views WHERE view_day >= CURRENT_DATE - ($1::int - 1)`, [days]),
    db.query(`SELECT id,title,type,status,views,created_at FROM library_items
      WHERE status='published' ORDER BY views DESC,id DESC LIMIT 8`),
    db.query(`SELECT id,title,type,status,views,created_at FROM library_items ORDER BY created_at DESC,id DESC LIMIT 8`),
    db.query(`SELECT
      COUNT(*) FILTER (WHERE status='pending')::int AS pending,
      COUNT(*) FILTER (WHERE status='approved')::int AS approved,
      COUNT(*) FILTER (WHERE status='ready_for_pickup')::int AS ready_for_pickup,
      COUNT(*) FILTER (WHERE status='borrowed')::int AS borrowed,
      COUNT(*) FILTER (WHERE status='borrowed' AND due_at < NOW())::int AS overdue,
      COUNT(*) FILTER (WHERE status='returned')::int AS returned FROM borrow_requests`),
    getSearchAnalytics(days),
    storageUsage(),
  ]);
  const loans = circulation.rows[0] || {};
  const generated_at = new Date().toISOString();
  return {
    generated_at, days,
    by_type: types.rows.map(row => ({ type: row.type, count: count(row.count) })),
    recent_views: count(views.rows[0]?.count),
    top_items: top.rows.map(summary), new_items: latest.rows.map(summary),
    circulation: { pending: count(loans.pending), approved: count(loans.approved),
      ready_for_pickup: count(loans.ready_for_pickup), borrowed: count(loans.borrowed),
      overdue: count(loans.overdue), returned: count(loans.returned) },
    searches: {
      topQueries: search.topQueries.map(row => ({ query: row.query, normalized_query: row.normalized_query, count: count(row.count) })),
      zeroResults: search.zeroResults.map(row => ({ query: row.query, normalized_query: row.normalized_query, count: count(row.count) })),
      trend: search.trend.map(row => ({ day: String(row.day).slice(0,10),
        count: count(row.count), zero_results: count(row.zero_results) })),
    },
    storage, health: { database: "connected", checked_at: generated_at },
  };
}

// Only three period choices can enter the cache, never an unbounded query map.
const dashboardReads = new Map<number, () => Promise<AdminDashboard>>();
export async function getAdminDashboard(period = 30): Promise<AdminDashboard> {
  const days = [7, 30, 90].includes(period) ? period : 30;
  let read = dashboardReads.get(days);
  if (!read) {
    read = createExpiringRead(async () => {
      await ensureSchema();
      const [base, insights] = await Promise.all([getDashboardStats(), readInsights(days)]);
      return { ...base, insights };
    }, 30_000);
    dashboardReads.set(days, read);
  }
  return read();
}
