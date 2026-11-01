"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TYPE_LABELS, type LibraryType } from "@/lib/library-types";
import { getItemHref } from "@/lib/library-url";
import type { AdminDashboard, DashboardItemSummary } from "@/lib/admin-insights-types";

const number = (value: number) => value.toLocaleString("vi-VN");
const bytes = (value: number) => `${(value / 1024 ** 2).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} MiB`;
const time = (value: string) => new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
const statusNames: Record<string, string> = { draft: "Nháp", review: "Chờ duyệt", published: "Đã xuất bản", archived: "Lưu trữ" };

function ItemList({ items }: { items: DashboardItemSummary[] }) {
  if (!items.length) return <p>Chưa có tài liệu.</p>;
  return <ol className="insights-item-list">{items.map(item => <li key={item.id}>
    <div>{item.status === "published" ? <Link href={getItemHref(item)}>{item.title}</Link> : <span>{item.title}</span>}
      <small>{TYPE_LABELS[item.type]} · {statusNames[item.status] || item.status}</small></div>
    <span>{number(item.views)} lượt xem</span>
  </li>)}</ol>;
}

function SearchTable({ rows, empty }: { rows: { query: string; count: number }[]; empty: string }) {
  if (!rows.length) return <p>{empty}</p>;
  return <table className="insights-table"><thead><tr><th scope="col">Từ khóa</th><th scope="col">Số lượt</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.query}><td>{row.query}</td><td>{number(row.count)}</td></tr>)}</tbody></table>;
}

export default function AdminInsightsClient() {
  const router = useRouter();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/dashboard?days=${days}`, { cache: "no-store", signal });
      if (response.status === 401) { router.replace("/admin/login"); return; }
      if (!response.ok) throw new Error("Không thể tải thống kê. Vui lòng thử lại.");
      const result: AdminDashboard = await response.json();
      if (!signal?.aborted) setData(result);
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Lỗi kết nối.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [days, router]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return load(controller.signal); });
    return () => controller.abort();
  }, [load]);
  const insight = data?.insights;
  const storage = insight?.storage;
  const storageLabel = { normal: "Bình thường", warning: "Cảnh báo", critical: "Gần đầy", unavailable: "Chưa có số đo" };

  return <main className="admin-page"><header className="admin-topbar"><div><span>THƯ VIỆN ĐIỆN TỬ</span><h1>Thống kê thư viện</h1></div>
    <nav className="admin-top-actions" aria-label="Quản trị"><Link className="admin-top-link" href="/admin">Tài liệu</Link><Link className="admin-top-link" href="/admin/operations">Mượn / trả & vận hành</Link></nav></header>
    <div className="insights-content">
      <div className="insights-toolbar"><label>Khoảng thời gian <select value={days} onChange={event => setDays(Number(event.target.value))}>
        <option value={7}>7 ngày</option><option value={30}>30 ngày</option><option value={90}>90 ngày</option></select></label>
        <button type="button" disabled={loading} onClick={() => void load()}>Làm mới thống kê</button></div>
      {loading && <p role="status">Đang tải thống kê…</p>}
      {message && <p role="alert" className="admin-message">{message}</p>}
      {data && insight && <><p className="insights-updated">Cập nhật: {time(insight.generated_at)} · Số liệu được lưu tạm tối đa 30 giây.</p>
        <section className="insights-metrics" aria-label="Tổng quan">
          <article><span>Tổng tài liệu</span><strong>{number(data.items.total)}</strong><small>{number(data.items.published)} đã xuất bản</small></article>
          <article><span>Lượt xem tài liệu</span><strong>{number(data.views)}</strong><small>{number(insight.recent_views)} trong {insight.days} ngày</small></article>
          <article><span>Bình luận chờ duyệt</span><strong>{number(data.comments.pending)}</strong><Link href="/admin/operations">Xử lý bình luận</Link></article>
          <article><span>Kết nối dữ liệu</span><strong className="insights-healthy">Hoạt động</strong><small>Kiểm tra {time(insight.health.checked_at)}</small></article>
        </section>
        <section className="insights-panel"><h2>Tài liệu theo loại</h2><dl className="insights-types">{insight.by_type.map(row => <div key={row.type}><dt>{TYPE_LABELS[row.type as LibraryType] || row.type}</dt><dd>{number(row.count)}</dd></div>)}</dl></section>
        <section className="insights-panel"><h2>Mượn / trả sách</h2><dl className="insights-types">
          <div><dt>Chờ duyệt</dt><dd>{number(insight.circulation.pending)}</dd></div><div><dt>Đã duyệt</dt><dd>{number(insight.circulation.approved)}</dd></div>
          <div><dt>Sẵn sàng nhận</dt><dd>{number(insight.circulation.ready_for_pickup)}</dd></div><div><dt>Đang mượn</dt><dd>{number(insight.circulation.borrowed)}</dd></div>
          <div><dt>Quá hạn</dt><dd className={insight.circulation.overdue ? "insights-critical" : undefined}>{number(insight.circulation.overdue)}</dd></div><div><dt>Đã trả</dt><dd>{number(insight.circulation.returned)}</dd></div>
        </dl><p>Quá hạn được tính từ sách đang mượn có hạn trả đã qua; số này nằm trong tổng đang mượn.</p><Link href="/admin/operations">Quản lý yêu cầu mượn</Link></section>
        <div className="insights-columns"><section className="insights-panel"><h2>Tài liệu được xem nhiều</h2><ItemList items={insight.top_items}/></section>
          <section className="insights-panel"><h2>Tài liệu mới thêm</h2><ItemList items={insight.new_items}/></section></div>
        <div className="insights-columns"><section className="insights-panel"><h2>Từ khóa được tìm nhiều</h2><SearchTable rows={insight.searches.topQueries} empty="Chưa có lượt tìm kiếm trong khoảng này."/></section>
          <section className="insights-panel"><h2>Tìm kiếm không có kết quả</h2><SearchTable rows={insight.searches.zeroResults} empty="Chưa ghi nhận tìm kiếm không có kết quả."/><p>Dùng các từ khóa này để bổ sung tài liệu hoặc điều chỉnh metadata.</p></section></div>
        <section className="insights-panel"><h2>Xu hướng tìm kiếm · {insight.days} ngày</h2>{insight.searches.trend.length ? <div className="insights-table-wrap"><table className="insights-table"><thead><tr><th scope="col">Ngày</th><th scope="col">Lượt tìm</th><th scope="col">Không có kết quả</th></tr></thead><tbody>{insight.searches.trend.map(row => <tr key={row.day}><td>{row.day}</td><td>{number(row.count)}</td><td>{number(row.zero_results)}</td></tr>)}</tbody></table></div> : <p>Chưa có số liệu.</p>}</section>
        {storage && <section className="insights-panel"><h2>Dung lượng Storage</h2><p className={storage.status === "critical" ? "insights-critical" : undefined}><strong>{storageLabel[storage.status]}</strong></p>
          {storage.used_bytes !== null && storage.limit_bytes !== null && <><p>{bytes(storage.used_bytes)} / {bytes(storage.limit_bytes)} · {number(storage.object_count || 0)} files</p>
            <progress className="insights-storage-progress" max={storage.limit_bytes} value={Math.min(storage.used_bytes, storage.limit_bytes)} aria-label="Dung lượng Storage đã dùng"/>
            <p>Cảnh báo từ 70%, gần đầy từ 85%. Không tự xóa file.</p></>}
          {storage.status === "unavailable" && <p>Chưa thể lấy dung lượng. Kiểm tra báo cáo vận hành; số liệu này không được coi là còn trống.</p>}
          <small>Đo lúc {time(storage.measured_at)} · Lưu tạm tối đa 5 phút.</small></section>}
      </>}
    </div>
  </main>;
}
