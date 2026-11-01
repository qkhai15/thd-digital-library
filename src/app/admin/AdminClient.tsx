"use client";

import Image from "@/components/ContentImage";
import Link from "next/link";
import useConfirmation from "@/components/useConfirmation";
import AdminMetadataFields,{EMPTY_METADATA,metadataForm,type MetadataForm} from "@/components/AdminMetadataFields";
import { useRouter } from "next/navigation";
import {
  Edit3,
  FilePlus2,
  Images,
  LogOut,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAdminUploadLimits, uploadAdminFile, uploadLimitLabel, usesDirectUpload, type AdminUploadLimits, type AdminUploadProgress } from "@/lib/admin-upload-client";
import { getItemHref } from "@/lib/library-url";
import {
  TYPE_LABELS,
  type DashboardStats,
  type LibraryItem,
  type LibraryType,
} from "@/lib/library-types";

const visibleTypes = Object.entries(TYPE_LABELS).filter(
  ([value]) => !["bai-giang-dien-tu", "ky-nang-song"].includes(value)
) as [LibraryType, string][];

type FormState = MetadataForm & {
  id: number;
  title: string;
  author: string;
  type: LibraryType;
  category: string;
  class_level: string;
  format: string;
  cover_url: string;
  file_url: string;
  gallery_urls: string[];
  description: string;
  stock: string;
  is_featured: boolean;
  status: "draft" | "review" | "published" | "archived";
  expected_stock: number | null;
};

const emptyForm: FormState = {
  ...EMPTY_METADATA,
  id: 0,
  title: "",
  author: "",
  type: "sach-dien-tu",
  category: "",
  class_level: "Khác",
  format: "Sách điện tử",
  cover_url: "",
  file_url: "",
  gallery_urls: [],
  description: "",
  stock: "",
  is_featured: false,
  status: "published",
  expected_stock: null,
};

export default function AdminClient() {
  const router = useRouter();
  const { confirm, confirmation } = useConfirmation();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<AdminUploadProgress | null>(null);
  const [directUploadActive, setDirectUploadActive] = useState(false);
  const [uploadLimits, setUploadLimits] = useState<AdminUploadLimits | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [listPage, setListPage] = useState(1);
  const [loadingList, setLoadingList] = useState(false);
  const filteredItems = items.filter(item => (!typeFilter || item.type === typeFilter) && (!statusFilter || item.status === statusFilter) && `${item.title} ${item.author} ${item.category}`.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")));
  const pages = Math.max(1, Math.ceil(filteredItems.length / 25));
  const currentPage = Math.min(listPage, pages);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoadingList(true);
    try {
    const [itemsResponse, dashboardResponse, limitsResult] = await Promise.all([
      fetch("/api/admin/documents", { cache: "no-store", signal }),
      fetch("/api/admin/dashboard", { cache: "no-store", signal }),
      loadAdminUploadLimits(signal).then(
        limits => ({ limits, error: undefined }),
        (error: unknown) => ({ limits: null, error })
      ),
    ]);

    if (signal?.aborted) return;
    if (itemsResponse.status === 401 || dashboardResponse.status === 401
      || (limitsResult.error instanceof Error && (limitsResult.error as Error & { status?: number }).status === 401)) {
      router.replace("/admin/login");
      return;
    }

    if (!itemsResponse.ok || !dashboardResponse.ok) throw new Error("Không thể tải dữ liệu quản trị.");
    const itemsData = await itemsResponse.json();
    const dashboardData = await dashboardResponse.json();

    setItems(Array.isArray(itemsData) ? itemsData : []);
    setUploadLimits(limitsResult.limits);
    if (limitsResult.error) setMessage(limitsResult.error instanceof Error ? limitsResult.error.message : "Không thể kiểm tra giới hạn upload.");
    if (dashboardResponse.ok) {
      setDashboard(dashboardData);
    }
    } catch (error) {
      if (!signal?.aborted && error instanceof Error && (error as Error & { status?: number }).status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Lỗi kết nối. Vui lòng thử lại.");
    } finally { if (!signal?.aborted) setLoadingList(false); }
  }, [router]);

  async function loadItems() {
    await loadData();
  }

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(()=>loadData(controller.signal));
    return ()=>controller.abort();
  }, [loadData]);

  useEffect(() => () => uploadController.current?.abort(), []);

  function startCreate() {
    if (uploading) return;
    setForm(emptyForm);
    setMessage("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEdit(item: LibraryItem) {
    if (uploading) return;
    setForm({
      ...metadataForm(item),
      id: item.id,
      title: item.title,
      author: item.author,
      type: item.type,
      category: item.category,
      class_level: item.class_level,
      format: item.format,
      cover_url: item.type === "album" ? "" : (item.cover_url ?? ""),
      file_url: item.type === "album" ? "" : (item.file_url ?? ""),
      gallery_urls: Array.isArray(item.gallery_urls) ? item.gallery_urls : [],
      description: item.description,
      stock: item.stock == null ? "" : String(item.stock),
      expected_stock: item.stock,
      is_featured: item.is_featured,
      status: ["draft", "review", "published", "archived"].includes(String(item.status))
        ? (item.status as FormState["status"])
        : "published",
    });
    setMessage("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateType(type: LibraryType) {
    setForm((prev) => ({
      ...prev,
      type,
      format: TYPE_LABELS[type],
      cover_url: type === "album" ? "" : prev.cover_url,
      file_url: type === "album" || type === "sach-giay" ? "" : prev.file_url,
      gallery_urls: type === "album" ? prev.gallery_urls : [],
      stock: type === "sach-giay" ? prev.stock : "",
      is_featured: ["video", "album"].includes(type) ? false : prev.is_featured,
    }));
  }

  async function uploadFile(
    file: File,
    kind: "cover" | "gallery" | "document" | "audio" | "video" | "banner"
  ) {
    const controller = new AbortController();
    uploadController.current = controller;
    setDirectUploadActive(usesDirectUpload(file, kind, uploadLimits?.thresholdBytes));
    setMessage("");
    try {
      return await uploadAdminFile(file, kind, {
        documentType: form.type,
        signal: controller.signal,
        onLimits: setUploadLimits,
        onProgress(progress) {
          setUploadProgress(progress);
          if (progress.direct !== undefined) setDirectUploadActive(progress.direct);
        },
      });
    } finally {
      if (uploadController.current === controller) uploadController.current = null;
      setUploadProgress(null);
      setDirectUploadActive(false);
    }
  }

  async function uploadGallery(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, Math.min(30,100-form.gallery_urls.length))) {
        const url = await uploadFile(file, "gallery");
        setForm(prev=>({...prev,gallery_urls:[...prev.gallery_urls,url].slice(0,100)}));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload ảnh thất bại.");
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (form.type === "album" && form.status === "published" && form.gallery_urls.length === 0) {
        throw new Error("Album cần ít nhất 1 ảnh.");
      }

      const payload = {
        ...form,
        cover_url: form.type === "album" ? "" : form.cover_url,
        file_url: form.type === "album" || form.type === "sach-giay" ? "" : form.file_url,
        gallery_urls: form.type === "album" ? form.gallery_urls : [],
      };

      const res = await fetch(
        form.id ? `/api/admin/documents/${form.id}` : "/api/admin/documents",
        {
          method: form.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const result = await res.json();
      if (!res.ok) throw new Error(result.message ?? "Không thể lưu.");

      setMessage(form.id ? "Đã cập nhật nội dung." : "Đã thêm nội dung.");
      setForm(emptyForm);
      setShowForm(false);
      await loadItems();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Có lỗi xảy ra.");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: number) {
    try {
    if (!(await confirm("Xóa nội dung này?"))) return;
    const res = await fetch(`/api/admin/documents/${id}`, { method: "DELETE" });
    if (!res.ok) { const data = await res.json().catch(()=>({})); return setMessage(data.message || "Xóa thất bại."); }
    await loadItems();
    } catch { setMessage("Lỗi kết nối. Vui lòng thử lại."); }

  }

  async function logout() {
    uploadController.current?.abort();
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  }

  const fileKind = useMemo(() => {
    if (form.type === "sach-noi") return "audio" as const;
    if (form.type === "video") return "video" as const;
    return "document" as const;
  }, [form.type]);

  return (
    <main className="admin-page">
      {confirmation}
      <header className="admin-topbar">
        <div>
          <span>THƯ VIỆN ĐIỆN TỬ</span>
          <h1>Quản trị nội dung</h1>
        </div>

        <div className="admin-top-actions">
          <Link href="/admin/news" className="admin-top-link">
            Tin tức
          </Link>
          <Link href="/admin/catalog" className="admin-top-link">Phân loại & bộ sưu tập</Link>
          <Link href="/admin/discovery" className="admin-top-link">Trang chủ</Link>
          <Link href="/admin/insights" className="admin-top-link">Thống kê</Link>
          <Link href="/admin/operations" className="admin-top-link">
            Vận hành & Báo tường
          </Link>
          <Link href="/" className="admin-top-link">Xem website</Link>
          <button onClick={() => void loadItems()}>
            <RefreshCw size={16} /> Làm mới
          </button>
          <button onClick={logout}>
            <LogOut size={16} /> Đăng xuất
          </button>
        </div>
      </header>

      <section className="admin-toolbar">
        <div>
          <strong>{dashboard?.items.total ?? items.length}</strong>
          <span>nội dung trong hệ thống</span>
        </div>
        <button className="admin-primary" onClick={startCreate} disabled={uploading}>
          <FilePlus2 size={18} /> Thêm nội dung
        </button>
      </section>

      <section className="admin-dashboard-grid">
        <div className="admin-dashboard-card">
          <span>Tài liệu đã xuất bản</span>
          <strong>{dashboard?.items.published ?? "—"}</strong>
        </div>
        <div className="admin-dashboard-card">
          <span>Tổng lượt xem</span>
          <strong>{dashboard?.views?.toLocaleString("vi-VN") ?? "—"}</strong>
        </div>
        <div className="admin-dashboard-card">
          <span>Yêu cầu mượn chờ xử lý</span>
          <strong>{dashboard?.borrows.pending ?? "—"}</strong>
        </div>
        <div className="admin-dashboard-card">
          <span>Bình luận chờ duyệt</span>
          <strong>{dashboard?.comments.pending ?? "—"}</strong>
        </div>
        <div className="admin-dashboard-card">
          <span>Tin đã xuất bản</span>
          <strong>{dashboard?.news.published ?? "—"}</strong>
        </div>
        <div className="admin-dashboard-card">
          <span>Báo tường đang hiển thị</span>
          <strong>{dashboard?.banners.active ?? "—"}</strong>
        </div>
      </section>

      {message && <div className="admin-message">{message}</div>}
      {uploadProgress && (
        <div className="admin-message" role="status" aria-live="polite">
          {uploadProgress.phase === "signing" ? "Đang xin quyền tải file..."
            : uploadProgress.phase === "finalizing" ? "Đang kiểm tra file đã tải..."
            : uploadProgress.phase === "retrying" ? "Kết nối gián đoạn, đang thử lại..."
            : uploadProgress.phase === "resuming" ? "Đang tiếp tục phần file còn lại..."
            : `Đang tải${directUploadActive ? " trực tiếp lên Storage" : " file"}${uploadProgress.percent == null ? "..." : `: ${uploadProgress.percent}%`}`}
          {directUploadActive && uploadProgress.phase !== "finalizing" && (
            <button type="button" onClick={() => uploadController.current?.abort()} style={{ marginLeft: 12 }}>
              Tạm dừng tải
            </button>
          )}
        </div>
      )}

      {showForm && (
        <section className="admin-form-card">
          <div className="admin-form-head">
            <h2>{form.id ? "Sửa nội dung" : "Thêm nội dung"}</h2>
            <button type="button" onClick={() => setShowForm(false)} aria-label="Đóng" disabled={uploading}>
              <X size={20} />
            </button>
          </div>

          <form className="admin-form" onSubmit={submit}>
            <label className="admin-span-2">
              Tiêu đề *
              <input value={form.title} onChange={(e) => update("title", e.target.value)} required />
            </label>

            <label>
              Tác giả / đơn vị
              <input value={form.author} onChange={(e) => update("author", e.target.value)} />
            </label>

            <label>
              Loại nội dung
              <select value={form.type} onChange={(e) => updateType(e.target.value as LibraryType)} disabled={uploading}>
                {!visibleTypes.some(([value]) => value === form.type) && <option value={form.type}>{TYPE_LABELS[form.type]} (tạm ngừng)</option>}
                {visibleTypes.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>

            <label>
              Thể loại
              <input
                value={form.category}
                onChange={(e) => update("category", e.target.value)}
                placeholder={form.type === "video" ? "VD: VIDEO HOẠT ĐỘNG" : form.type === "album" ? "VD: Hoạt động tháng 9/2026" : "VD: SÁCH GIÁO KHOA"}
              />
            </label>

            <label>
              Lớp
              <select value={form.class_level} onChange={(e) => update("class_level", e.target.value)}>
                <option value="10">Lớp 10</option>
                <option value="11">Lớp 11</option>
                <option value="12">Lớp 12</option>
                <option value="Khác">Khác</option>
              </select>
            </label>

            <label>
              Trạng thái
              <select value={form.status} onChange={(e) => update("status", e.target.value as FormState["status"])}>
                <option value="published">Đã xuất bản</option>
                <option value="draft">Bản nháp</option>
                <option value="review">Chờ duyệt</option>
                <option value="archived">Lưu trữ</option>
              </select>
            </label>

            <AdminMetadataFields value={form} onChange={patch=>setForm(previous=>({...previous,...patch}))}/>
            {form.type === "sach-giay" && (
              <label>
                Số lượng sách
                <input type="number" min="0" value={form.stock} onChange={(e) => update("stock", e.target.value)} />
              </label>
            )}

            {/* Album dùng gallery trực tiếp, KHÔNG có ảnh bìa riêng */}
            {form.type !== "album" && (
              <label className="admin-span-2">
                Ảnh bìa / thumbnail
                <div className="admin-upload-row">
                  <input
                    value={form.cover_url}
                    onChange={(e) => update("cover_url", e.target.value)}
                    placeholder="/uploads/covers/..."
                  />
                  <label className="admin-upload-button">
                    <Upload size={16} /> Chọn ảnh
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      disabled={uploading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        try {
                          setUploading(true);
                          update("cover_url", await uploadFile(file, "cover"));
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : "Upload lỗi");
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </label>
                </div>
                <small>{uploadLimits ? `Tối đa ${uploadLimitLabel(uploadLimits.maxBytes.cover)} mỗi ảnh.` : "Đang kiểm tra giới hạn upload..."}</small>
                {form.cover_url && (
                  <div className="admin-cover-preview">
                    <Image src={form.cover_url} alt="Ảnh bìa" width={120} height={150} />
                  </div>
                )}
              </label>
            )}

            {form.type === "album" && (
              <div className="admin-span-2 admin-gallery-field">
                <div className="admin-field-title">
                  <div>
                    <b>Ảnh trong album *</b>
                    <p>Không cần ảnh bìa. Ảnh đầu tiên sẽ được dùng làm ảnh đại diện tự động.</p>
                    <small>{uploadLimits ? `Tối đa ${uploadLimitLabel(uploadLimits.maxBytes.gallery)} mỗi ảnh.` : "Đang kiểm tra giới hạn upload..."}</small>
                  </div>
                  <label className="admin-upload-button">
                    <Images size={16} /> {uploading ? "Đang tải..." : "Chọn nhiều ảnh"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      hidden
                      disabled={uploading}
                      onChange={(e) => void uploadGallery(e.target.files)}
                    />
                  </label>
                </div>

                <div className="admin-gallery-grid">
                  {form.gallery_urls.map((src, index) => (
                    <div className="admin-gallery-item" key={`${src}-${index}`}>
                      <Image src={src} alt={`Ảnh ${index + 1}`} fill sizes="140px" />
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({
                          ...prev,
                          gallery_urls: prev.gallery_urls.filter((_, i) => i !== index),
                        }))}
                        aria-label="Xóa ảnh"
                      >
                        ×
                      </button>
                      <span>{index + 1}</span>
                    </div>
                  ))}
                  {!form.gallery_urls.length && <div className="admin-gallery-empty">Chưa có ảnh.</div>}
                </div>
              </div>
            )}

            {form.type !== "album" && form.type !== "sach-giay" && (
              <label className="admin-span-2">
                {form.type === "video" ? "File video" : form.type === "sach-noi" ? "File audio" : "File tài liệu"}
                <div className="admin-upload-row">
                  <input value={form.file_url} onChange={(e) => update("file_url", e.target.value)} placeholder="/uploads/..." />
                  <label className="admin-upload-button">
                    <Upload size={16} /> Chọn file
                    <input
                      type="file"
                      hidden
                      disabled={uploading}
                      accept={form.type === "video" ? "video/mp4,video/webm" : form.type === "sach-noi" ? "audio/*" : "application/pdf"}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        try {
                          setUploading(true);
                          update("file_url", await uploadFile(file, fileKind));
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : "Upload lỗi");
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </label>
                </div>
                <small>{uploadLimits ? `Tối đa ${uploadLimitLabel(uploadLimits.maxBytes[fileKind])} mỗi file.` : "Đang kiểm tra giới hạn upload..."}</small>
              </label>
            )}

            <label className="admin-span-2">
              Mô tả
              <textarea rows={6} value={form.description} onChange={(e) => update("description", e.target.value)} />
            </label>

            {!(["video", "album"] as string[]).includes(form.type) && (
              <label className="admin-check admin-span-2">
                <input
                  type="checkbox"
                  checked={form.is_featured}
                  onChange={(e) => update("is_featured", e.target.checked)}
                />
                Ưu tiên hiển thị ở Tài liệu thịnh hành
              </label>
            )}

            <div className="admin-form-actions admin-span-2">
              <button type="button" onClick={() => setShowForm(false)} disabled={uploading}>Hủy</button>
              <button className="admin-primary" disabled={loading || uploading}>
                {loading ? "Đang lưu..." : form.id ? "Cập nhật" : "Thêm nội dung"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="admin-list-card">
        <div className="admin-filter-bar">
          <input aria-label="Tìm nội dung" placeholder="Tìm tên, tác giả, thể loại..." value={query} onChange={e=>{setQuery(e.target.value);setListPage(1);}}/>
          <select aria-label="Loại nội dung" value={typeFilter} onChange={e=>{setTypeFilter(e.target.value);setListPage(1);}}><option value="">Tất cả loại</option>{Object.entries(TYPE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="Trạng thái" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setListPage(1);}}><option value="">Tất cả trạng thái</option><option value="draft">Bản nháp</option><option value="published">Đã xuất bản</option><option value="archived">Lưu trữ</option></select>
          <span>{loadingList ? "Đang tải..." : `${filteredItems.length} nội dung`}</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nội dung</th>
                <th>Loại</th>
                <th>Lớp</th>
                <th>Trạng thái</th>
                <th>Lượt xem</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.slice((currentPage-1)*25,currentPage*25).map((item) => {
                const preview = item.type === "album"
                  ? item.gallery_urls?.[0]
                  : item.cover_url;
                return (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>
                      <div className="admin-item-name">
                        {preview ? (
                          <Image src={preview} alt="" width={48} height={58} />
                        ) : (
                          <div className="admin-no-cover">—</div>
                        )}
                        <div>
                          <strong>{item.title}</strong>
                          <span>{item.author || "Chưa nhập tác giả"}</span>
                        </div>
                      </div>
                    </td>
                    <td>{TYPE_LABELS[item.type]}</td>
                    <td>{item.class_level}</td>
                    <td>{item.status || "published"}</td>
                    <td>{item.views}</td>
                    <td>
                      <div className="admin-row-actions">
                        {item.status === "published" && <Link href={`${getItemHref(item)}?preview=admin`} target="_blank" rel="noopener">Xem</Link>}
                        <button type="button" onClick={() => startEdit(item)} aria-label="Sửa"><Edit3 size={16} /></button>
                        <button type="button" className="admin-danger" onClick={() => void remove(item.id)} aria-label="Xóa"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filteredItems.length && (
                <tr><td colSpan={7} className="admin-empty">Chưa có nội dung.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination" style={{padding:16}}><span>Trang {currentPage}/{pages}</span><div><button disabled={currentPage<=1} onClick={()=>setListPage(currentPage-1)}>← Trước</button><button disabled={currentPage>=pages} onClick={()=>setListPage(currentPage+1)}>Tiếp →</button></div></div>
      </section>
    </main>
  );
}
