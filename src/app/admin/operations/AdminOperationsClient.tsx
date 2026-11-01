"use client";

import Image from "@/components/ContentImage";
import Link from "next/link";
import useConfirmation from "@/components/useConfirmation";
import { useRouter } from "next/navigation";
import { Images, RefreshCw, Trash2, Upload } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { BorrowRequest } from "@/lib/library-types";

type Borrow = BorrowRequest & {
  item_title: string;
};

const borrowLabels: Record<string, string> = {
  pending: "Chờ duyệt", approved: "Đã duyệt / giữ sách", ready_for_pickup: "Sẵn sàng nhận",
  borrowed: "Đang mượn", returned: "Đã trả", rejected: "Từ chối", cancelled: "Đã hủy", overdue: "Quá hạn",
};
function borrowTime(value?: string | null) {
  return value ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—";
}

type Comment = {
  id: number;
  item_title: string;
  name: string;
  content: string;
  status: string;
  created_at: string;
};

type Banner = {
  id: number;
  title: string;
  image_url: string;
  link_url: string | null;
  is_active: boolean;
  sort_order: number;
};


type Audit = {
  id: number;
  username: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

type BannerForm = {
  id: number;
  title: string;
  image_url: string;
  link_url: string;
  is_active: boolean;
  sort_order: string;
};

const emptyBanner: BannerForm = {
  id: 0,
  title: "",
  image_url: "",
  link_url: "",
  is_active: true,
  sort_order: "0",
};

export default function AdminOperationsClient() {
  const router = useRouter();
  const { confirm, confirmation } = useConfirmation();
  const [tab, setTab] = useState<"borrow" | "comments" | "banners" | "audit" | "settings">("borrow");
  const [message, setMessage] = useState("");
  const [requireApproval, setRequireApproval] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [listPage,setListPage] = useState(1);
  const [pageCounts,setPageCounts] = useState({borrow:1,comments:1,audit:1});
  const [totals,setTotals] = useState({borrow:0,comments:0,audit:0});
  const [borrows, setBorrows] = useState<Borrow[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [bannerForm, setBannerForm] = useState<BannerForm>(emptyBanner);
  const [loading, setLoading] = useState(true);
  const [savingBanner, setSavingBanner] = useState(false);
  const [borrowFilter, setBorrowFilter] = useState("");
  const [borrowCodeInput, setBorrowCodeInput] = useState("");
  const [borrowCode, setBorrowCode] = useState("");
  const [busyBorrow, setBusyBorrow] = useState<number | null>(null);
  const [dueDates, setDueDates] = useState<Record<number, string>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [borrowResponse, commentResponse, bannerResponse, auditResponse, settingsResponse] = await Promise.all([
        fetch(`/api/admin/borrows?limit=25&page=${listPage}&status=${encodeURIComponent(borrowFilter)}&code=${encodeURIComponent(borrowCode)}`, { cache: "no-store", signal }),
        fetch(`/api/admin/comments?limit=25&page=${listPage}`, { cache: "no-store", signal }),
        fetch("/api/admin/banners", { cache: "no-store", signal }),
        fetch(`/api/admin/audit?limit=25&page=${listPage}`, { cache: "no-store", signal }),
        fetch("/api/admin/settings", { cache: "no-store", signal }),
      ]);

    if (signal?.aborted) return;
      if ([borrowResponse, commentResponse, bannerResponse, auditResponse].some((r) => r.status === 401)) {
        router.replace("/admin/login");
        return;
      }

      if (borrowResponse.ok) setBorrows(await borrowResponse.json());
      if (commentResponse.ok) setComments(await commentResponse.json());
      if (bannerResponse.ok) setBanners(await bannerResponse.json());
      if (auditResponse.ok) setAudits(await auditResponse.json());
      setPageCounts({borrow:Number(borrowResponse.headers.get("X-Total-Pages"))||1,comments:Number(commentResponse.headers.get("X-Total-Pages"))||1,audit:Number(auditResponse.headers.get("X-Total-Pages"))||1});
      setTotals({borrow:Number(borrowResponse.headers.get("X-Total-Count"))||0,comments:Number(commentResponse.headers.get("X-Total-Count"))||0,audit:Number(auditResponse.headers.get("X-Total-Count"))||0});
      if (settingsResponse.ok) setRequireApproval((await settingsResponse.json()).comments_require_approval);
      if ([borrowResponse,commentResponse,bannerResponse,auditResponse,settingsResponse].some(r=>!r.ok)) throw new Error("Không thể tải đầy đủ dữ liệu vận hành.");
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Lỗi kết nối. Vui lòng thử lại.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [listPage,router,borrowFilter,borrowCode]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(()=>load(controller.signal));
    return ()=>controller.abort();
  }, [load]);

  function changeTab(next: typeof tab) { setTab(next); setListPage(1); }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const response = await fetch("/api/admin/settings", {method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({comments_require_approval:requireApproval})});
      if (!response.ok) throw new Error("Không thể lưu cài đặt.");
      setMessage("Đã lưu cài đặt bình luận.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lỗi kết nối."); }
    finally { setSavingSettings(false); }
  }

  async function borrowStatus(id: number, status: string) {
    if (busyBorrow !== null) return;
    setBusyBorrow(id);
    try {
    const response = await fetch(`/api/admin/borrows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(status === "borrowed" && dueDates[id] ? { due_at: dueDates[id] } : {}) }),
    });
    const data = await response.json();
    if (!response.ok) return setMessage(data.message || "Không thể cập nhật.");
    setMessage(`Đã cập nhật ${data.request_code || "yêu cầu"}: ${borrowLabels[status] || status}.`);
    await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lỗi kết nối. Vui lòng thử lại."); }
    finally { setBusyBorrow(null); }
  }

  async function commentStatus(id: number, status: string) {
    try {
    const response = await fetch(`/api/admin/comments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) return setMessage("Không thể cập nhật bình luận.");
    await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lỗi kết nối. Vui lòng thử lại."); }

  }

  async function deleteComment(id: number) {
    try {
    if (!(await confirm("Xóa bình luận này?"))) return;
    const response = await fetch(`/api/admin/comments/${id}`, { method: "DELETE" });
    if (response.ok) await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lỗi kết nối. Vui lòng thử lại."); }

  }

  async function uploadBanner(file: File) {
    const data = new FormData();
    data.append("file", file);
    data.append("kind", "banner");
    const response = await fetch("/api/admin/upload", { method: "POST", body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Không thể upload ảnh.");
    return result.url as string;
  }

  function editBanner(banner: Banner) {
    setBannerForm({
      id: banner.id,
      title: banner.title,
      image_url: banner.image_url,
      link_url: banner.link_url || "",
      is_active: banner.is_active,
      sort_order: String(banner.sort_order),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveBanner(event: FormEvent) {
    event.preventDefault();
    if (!bannerForm.image_url) return setMessage("Bạn chưa chọn ảnh báo tường.");

    setSavingBanner(true);
    try {
      const response = await fetch(
        bannerForm.id ? `/api/admin/banners/${bannerForm.id}` : "/api/admin/banners",
        {
          method: bannerForm.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: bannerForm.title,
            image_url: bannerForm.image_url,
            link_url: bannerForm.link_url,
            is_active: bannerForm.is_active,
            sort_order: Number(bannerForm.sort_order) || 0,
          }),
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Không thể lưu báo tường.");
      setBannerForm(emptyBanner);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể lưu báo tường.");
    } finally {
      setSavingBanner(false);
    }
  }

  async function toggleBanner(banner: Banner) {
    try {
    const response = await fetch(`/api/admin/banners/${banner.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...banner, is_active: !banner.is_active }),
    });
    if (!response.ok) return setMessage("Không thể cập nhật báo tường.");
    await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lỗi kết nối. Vui lòng thử lại."); }

  }

  async function deleteBanner(id: number) {
    try {
    if (!(await confirm("Xóa ảnh báo tường này?"))) return;
    const response = await fetch(`/api/admin/banners/${id}`, { method: "DELETE" });
    if (!response.ok) return setMessage("Không thể xóa báo tường.");
    if (bannerForm.id === id) setBannerForm(emptyBanner);
    await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lỗi kết nối. Vui lòng thử lại."); }

  }

  return (
    <main className="admin-page">
      {confirmation}
      <header className="admin-topbar">
        <div>
          <span>THƯ VIỆN ĐIỆN TỬ</span>
          <h1>Vận hành thư viện</h1>
        </div>
        <div className="admin-top-actions">
          <Link href="/admin" className="admin-top-link">← Quản lý nội dung</Link>
          <Link href="/admin/news" className="admin-top-link">Tin tức</Link>
          <Link href="/" className="admin-top-link">Xem website</Link>
        </div>
      </header>

      <section className="admin-ops-wrap">
        {message && <p role="status" className="inline-error">{message}</p>}
        <div className="admin-ops-tabs">
          <button className={tab === "borrow" ? "active" : ""} onClick={() => changeTab("borrow")}>
            Yêu cầu mượn ({totals.borrow})
          </button>
          <button className={tab === "comments" ? "active" : ""} onClick={() => changeTab("comments")}>
            Bình luận ({totals.comments})
          </button>
          <button className={tab === "banners" ? "active" : ""} onClick={() => changeTab("banners")}>
            Báo tường ({banners.length})
          </button>
          <button className={tab === "audit" ? "active" : ""} onClick={() => changeTab("audit")}>
            Nhật ký ({totals.audit})
          </button>
          <button onClick={() => void load()}>
            <RefreshCw size={15} /> {loading ? "Đang tải..." : "Làm mới"}
          </button>
          <button className={tab === "settings" ? "active" : ""} onClick={()=>changeTab("settings")}>Cài đặt</button>
        </div>

        {(tab === "borrow" || tab === "comments" || tab === "audit") && <nav className="pagination" aria-label="Phân trang quản trị"><span>Trang {Math.min(listPage,pageCounts[tab])}/{pageCounts[tab]}</span><div><button disabled={loading || listPage<=1} onClick={()=>setListPage(Math.max(1,listPage-1))}>← Trước</button><button disabled={loading || listPage>=pageCounts[tab]} onClick={()=>setListPage(listPage+1)}>Tiếp →</button></div></nav>}

        {tab === "settings" && <section className="admin-form-card" style={{width:"100%",margin:0}}><h2>Bình luận</h2><label className="admin-check"><input type="checkbox" checked={requireApproval} onChange={e=>setRequireApproval(e.target.checked)}/>Bình luận mới cần quản trị viên duyệt trước khi hiển thị</label><p>Cài đặt áp dụng cho bình luận mới, giữ nguyên bình luận đã có.</p><button className="primary-btn" disabled={savingSettings || loading} onClick={()=>void saveSettings()}>{savingSettings?"Đang lưu...":"Lưu cài đặt"}</button></section>}

        {tab === "borrow" && (
          <div className="admin-list-card">
            <form className="admin-form" style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 12 }} onSubmit={event => { event.preventDefault(); setBorrowCode(borrowCodeInput.trim()); setListPage(1); }}>
              <label style={{ flex: "1 1 220px" }}>Mã yêu cầu nhận sách
                <input aria-label="Tìm mã yêu cầu mượn" disabled={loading} value={borrowCodeInput} maxLength={24} placeholder="BR-..." onChange={event => setBorrowCodeInput(event.target.value.toUpperCase())} />
              </label>
              <label style={{ flex: "1 1 220px" }}>Trạng thái
                <select aria-label="Lọc trạng thái mượn" disabled={loading} value={borrowFilter} onChange={event => { setBorrowFilter(event.target.value); setListPage(1); }}>
                  <option value="">Tất cả trạng thái</option>
                  {Object.entries(borrowLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button type="submit" disabled={loading}>Tìm mã</button>
              <button type="button" disabled={loading} onClick={() => { setBorrowCodeInput(""); setBorrowCode(""); setBorrowFilter(""); setListPage(1); }}>Xóa bộ lọc</button>
            </form>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Người mượn</th><th>Sách</th><th>Liên hệ</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                <tbody>
                  {borrows.map((borrow) => (
                    <tr key={borrow.id}>
                      <td><b>{borrow.borrower_name}</b><br/><small>{borrow.class_name || "—"}</small><br/><code>{borrow.request_code || "—"}</code></td>
                      <td>{borrow.item_title}<br/><small>{borrowTime(borrow.requested_at || borrow.created_at)}</small></td>
                      <td>{borrow.phone || borrow.email || "—"}</td>
                      <td>{borrowLabels[borrow.status] || borrow.status}
                        {borrow.is_overdue && <p role="status" className="inline-error">Quá hạn</p>}
                        {borrow.due_at && <p><small>Hạn trả: {borrowTime(borrow.due_at)}</small></p>}
                        <details><summary>Lịch sử ({borrow.timeline?.length || 0})</summary>
                          <ol style={{ paddingLeft: 20, minWidth: 180 }}>
                            {(borrow.timeline || []).map(event => <li key={event.id}><small>{borrowTime(event.created_at)} · {borrowLabels[event.to_status] || event.to_status} · {event.actor === "reader" ? "Người đọc" : event.actor === "migration" ? "Dữ liệu trước nâng cấp" : event.actor}</small></li>)}
                          </ol>
                          <small>Duyệt: {borrowTime(borrow.approved_at)}<br/>Sẵn sàng: {borrowTime(borrow.ready_at)}<br/>Giao sách: {borrowTime(borrow.borrowed_at)}<br/>Trả sách: {borrowTime(borrow.returned_at)}</small>
                        </details>
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          {borrow.status === "pending" && <>
                            <button disabled={busyBorrow !== null} onClick={() => void borrowStatus(borrow.id, "approved")}>Duyệt / giữ sách</button>
                            <button disabled={busyBorrow !== null} onClick={() => void borrowStatus(borrow.id, "rejected")}>Từ chối</button>
                          </>}
                          {borrow.status === "approved" && <button disabled={busyBorrow !== null} onClick={() => void borrowStatus(borrow.id, "ready_for_pickup")}>Sẵn sàng nhận sách</button>}
                          {borrow.status === "ready_for_pickup" && <>
                            <label>Hạn trả<input aria-label={`Hạn trả ${borrow.request_code}`} type="date" value={dueDates[borrow.id] || ""} onChange={event => setDueDates(previous => ({ ...previous, [borrow.id]: event.target.value }))} /><small>Để trống: 14 ngày kể từ khi giao sách.</small></label>
                            <button disabled={busyBorrow !== null} onClick={() => void borrowStatus(borrow.id, "borrowed")}>Đã giao sách</button>
                          </>}
                          {borrow.status === "borrowed" && <button disabled={busyBorrow !== null} onClick={() => void borrowStatus(borrow.id, "returned")}>Xác nhận trả sách</button>}
                          {["pending","approved","ready_for_pickup"].includes(borrow.status) && <button disabled={busyBorrow !== null} onClick={()=>void borrowStatus(borrow.id,"cancelled")}>Hủy</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!borrows.length && <tr><td colSpan={5} className="admin-empty">Chưa có yêu cầu mượn.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "comments" && (
          <div className="admin-list-card">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Người gửi</th><th>Tài liệu</th><th>Nội dung</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                <tbody>
                  {comments.map((comment) => (
                    <tr key={comment.id}>
                      <td><b>{comment.name}</b><br/><small>{new Date(comment.created_at).toLocaleString("vi-VN")}</small></td>
                      <td>{comment.item_title}</td>
                      <td>{comment.content}</td>
                      <td>{comment.status}</td>
                      <td>
                        <div className="admin-row-actions">
                          {comment.status !== "approved" && <button onClick={() => void commentStatus(comment.id, "approved")}>Hiện</button>}
                          {comment.status !== "hidden" && <button onClick={() => void commentStatus(comment.id, "hidden")}>Ẩn</button>}
                          <button className="admin-danger" onClick={() => void deleteComment(comment.id)}>Xóa</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!comments.length && <tr><td colSpan={5} className="admin-empty">Chưa có bình luận.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "audit" && (
          <div className="admin-list-card">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Tài khoản</th>
                    <th>Thao tác</th>
                    <th>Đối tượng</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {audits.map((audit) => (
                    <tr key={audit.id}>
                      <td>{new Date(audit.created_at).toLocaleString("vi-VN")}</td>
                      <td>{audit.username}</td>
                      <td><b>{audit.action}</b></td>
                      <td>{audit.entity_type || "—"} {audit.entity_id ? `#${audit.entity_id}` : ""}</td>
                      <td>
                        <code className="admin-audit-details">
                          {audit.details && Object.keys(audit.details).length
                            ? JSON.stringify(audit.details)
                            : "—"}
                        </code>
                      </td>
                    </tr>
                  ))}
                  {!audits.length && (
                    <tr>
                      <td colSpan={5} className="admin-empty">Chưa có nhật ký thao tác.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "banners" && (
          <div className="admin-banner-layout">
            <section className="admin-form-card admin-banner-form-card">
              <div className="admin-form-head">
                <div>
                  <h2>{bannerForm.id ? "Sửa ảnh báo tường" : "Thêm ảnh báo tường"}</h2>
                  <p>Ảnh được lưu vào database và tự xuất hiện ở slider trang chủ.</p>
                </div>
                {bannerForm.id > 0 && <button type="button" onClick={() => setBannerForm(emptyBanner)}>Hủy sửa</button>}
              </div>

              <form className="admin-form" onSubmit={saveBanner}>
                <label className="admin-span-2">
                  Tiêu đề
                  <input value={bannerForm.title} onChange={(e) => setBannerForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="VD: Dòng chảy" />
                </label>

                <label>
                  Thứ tự hiển thị
                  <input type="number" value={bannerForm.sort_order} onChange={(e) => setBannerForm((prev) => ({ ...prev, sort_order: e.target.value }))} />
                </label>

                <label className="admin-check admin-banner-check">
                  <input type="checkbox" checked={bannerForm.is_active} onChange={(e) => setBannerForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
                  Đang hiển thị
                </label>

                <label className="admin-span-2">
                  Ảnh báo tường *
                  <div className="admin-upload-row">
                    <input value={bannerForm.image_url} onChange={(e) => setBannerForm((prev) => ({ ...prev, image_url: e.target.value }))} placeholder="/uploads/banners/..." />
                    <label className="admin-upload-button">
                      <Upload size={16} /> Chọn ảnh
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        hidden
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const url = await uploadBanner(file);
                            setBannerForm((prev) => ({ ...prev, image_url: url }));
                          } catch (error) {
                            setMessage(error instanceof Error ? error.message : "Upload lỗi");
                          }
                        }}
                      />
                    </label>
                  </div>
                </label>

                {bannerForm.image_url && (
                  <div className="admin-span-2 admin-banner-preview">
                    <Image src={bannerForm.image_url} alt="Xem trước báo tường" fill sizes="900px" />
                  </div>
                )}

                <label className="admin-span-2">
                  Link khi cần dẫn sang trang khác (không bắt buộc)
                  <input value={bannerForm.link_url} onChange={(e) => setBannerForm((prev) => ({ ...prev, link_url: e.target.value }))} placeholder="https://..." />
                </label>

                <div className="admin-form-actions admin-span-2">
                  <button type="button" onClick={() => setBannerForm(emptyBanner)}>Làm mới form</button>
                  <button className="admin-primary" disabled={savingBanner}>{savingBanner ? "Đang lưu..." : bannerForm.id ? "Cập nhật" : "Thêm báo tường"}</button>
                </div>
              </form>
            </section>

            <section className="admin-banner-list">
              {banners.map((banner) => (
                <article className="admin-banner-card" key={banner.id}>
                  <div className="admin-banner-thumb">
                    <Image src={banner.image_url} alt={banner.title || "Báo tường"} fill sizes="420px" />
                  </div>
                  <div className="admin-banner-card-body">
                    <div>
                      <strong>{banner.title || `Báo tường #${banner.id}`}</strong>
                      <span>Thứ tự: {banner.sort_order} · {banner.is_active ? "Đang hiện" : "Đang ẩn"}</span>
                    </div>
                    <div className="admin-banner-actions">
                      <button onClick={() => editBanner(banner)}>Sửa</button>
                      <button onClick={() => void toggleBanner(banner)}>{banner.is_active ? "Ẩn" : "Hiện"}</button>
                      <button className="admin-danger" onClick={() => void deleteBanner(banner.id)}><Trash2 size={15} /> Xóa</button>
                    </div>
                  </div>
                </article>
              ))}
              {!banners.length && (
                <div className="admin-banner-empty"><Images size={32}/><p>Chưa có ảnh báo tường.</p></div>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
