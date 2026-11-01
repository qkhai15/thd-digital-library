"use client";

import Image from "@/components/ContentImage";
import Link from "next/link";
import useConfirmation from "@/components/useConfirmation";
import { useRouter } from "next/navigation";
import {
  Edit3,
  FilePlus2,
  Newspaper,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { NewsPost } from "@/lib/library-types";

type NewsForm = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_url: string;
  status: "draft" | "published" | "archived";
  is_featured: boolean;
};

const emptyForm: NewsForm = {
  id: 0,
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  cover_url: "",
  status: "published",
  is_featured: false,
};

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("vi-VN") : "—";
}

export default function AdminNewsClient() {
  const router = useRouter();
  const { confirm, confirmation } = useConfirmation();
  const [items, setItems] = useState<NewsPost[]>([]);
  const [form, setForm] = useState<NewsForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [query,setQuery] = useState("");
  const [statusFilter,setStatusFilter] = useState("");
  const [listPage,setListPage] = useState(1);
  const filteredItems = items.filter(item=>(!statusFilter || item.status === statusFilter) && item.title.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")));
  const pages = Math.max(1,Math.ceil(filteredItems.length/25));
  const currentPage = Math.min(listPage,pages);

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    try {
    const response = await fetch("/api/admin/news", { cache: "no-store", signal });

    if (signal?.aborted) return;
    if (response.status === 401) {
      router.replace("/admin/login");
      return;
    }

    if (!response.ok) throw new Error("Không thể tải tin tức.");
    const data = await response.json();
    setItems(Array.isArray(data) ? data : []);
    } catch (error) { if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Lỗi kết nối. Vui lòng thử lại."); }
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(()=>loadItems(controller.signal));
    return ()=>controller.abort();
  }, [loadItems]);

  function startCreate() {
    setForm(emptyForm);
    setMessage("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEdit(item: NewsPost) {
    setForm({
      id: item.id,
      title: item.title,
      slug: item.slug,
      excerpt: item.excerpt ?? "",
      content: item.content ?? "",
      cover_url: item.cover_url ?? "",
      status: ["draft", "published", "archived"].includes(item.status)
        ? (item.status as NewsForm["status"])
        : "published",
      is_featured: Boolean(item.is_featured),
    });
    setMessage("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function uploadCover(file: File) {
    const data = new FormData();
    data.append("file", file);
    data.append("kind", "cover");

    const response = await fetch("/api/admin/upload", {
      method: "POST",
      body: data,
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Không thể upload ảnh.");
    }

    return result.url as string;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        form.id ? `/api/admin/news/${form.id}` : "/api/admin/news",
        {
          method: form.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Không thể lưu tin tức.");
      }

      setMessage(form.id ? "Đã cập nhật bài viết." : "Đã đăng bài viết.");
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
    if (!(await confirm("Xóa bài viết này?"))) return;

    const response = await fetch(`/api/admin/news/${id}`, {
      method: "DELETE",
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      setMessage(result.message || "Không thể xóa.");
      return;
    }

    if (form.id === id) {
      setForm(emptyForm);
      setShowForm(false);
    }

    await loadItems();
    } catch { setMessage("Lỗi kết nối. Vui lòng thử lại."); }

  }

  return (
    <main className="admin-page">
      {confirmation}
      <header className="admin-topbar">
        <div>
          <span>THƯ VIỆN ĐIỆN TỬ</span>
          <h1>Quản lý tin tức</h1>
        </div>

        <div className="admin-top-actions">
          <Link href="/admin" className="admin-top-link">
            ← Quản lý nội dung
          </Link>
          <Link href="/admin/operations" className="admin-top-link">
            Vận hành
          </Link>
          <Link href="/tin-tuc" className="admin-top-link">
            Xem trang tin
          </Link>
          <button onClick={() => void loadItems()}>
            <RefreshCw size={16} /> Làm mới
          </button>
        </div>
      </header>

      <section className="admin-toolbar">
        <div>
          <strong>{items.length}</strong>
          <span>bài viết trong hệ thống</span>
        </div>

        <button className="admin-primary" onClick={startCreate}>
          <FilePlus2 size={18} /> Thêm bài viết
        </button>
      </section>

      {message && <div className="admin-message">{message}</div>}

      {showForm && (
        <section className="admin-form-card">
          <div className="admin-form-head">
            <div>
              <h2>{form.id ? "Sửa bài viết" : "Thêm bài viết"}</h2>
              <p>Nội dung đã xuất bản sẽ hiển thị ngay tại mục Tin tức.</p>
            </div>

            <button type="button" onClick={() => setShowForm(false)} aria-label="Đóng">
              <X size={20} />
            </button>
          </div>

          <form className="admin-form" onSubmit={submit}>
            <label className="admin-span-2">
              Tiêu đề *
              <input
                required
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </label>

            <label>
              Đường dẫn (slug)
              <input
                value={form.slug}
                onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
                placeholder="Để trống để hệ thống tự tạo"
              />
            </label>

            <label>
              Trạng thái
              <select
                value={form.status}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    status: e.target.value as NewsForm["status"],
                  }))
                }
              >
                <option value="published">Đã xuất bản</option>
                <option value="draft">Bản nháp</option>
                <option value="archived">Lưu trữ</option>
              </select>
            </label>

            <label className="admin-span-2">
              Mô tả ngắn
              <textarea
                rows={3}
                value={form.excerpt}
                onChange={(e) => setForm((prev) => ({ ...prev, excerpt: e.target.value }))}
                placeholder="Đoạn giới thiệu hiển thị ở danh sách tin tức."
              />
            </label>

            <label className="admin-span-2">
              Ảnh đại diện
              <div className="admin-upload-row">
                <input
                  value={form.cover_url}
                  onChange={(e) => setForm((prev) => ({ ...prev, cover_url: e.target.value }))}
                  placeholder="/uploads/covers/..."
                />

                <label className="admin-upload-button">
                  <Upload size={16} />
                  {uploading ? "Đang tải..." : "Chọn ảnh"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    disabled={uploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      try {
                        setUploading(true);
                        const url = await uploadCover(file);
                        setForm((prev) => ({ ...prev, cover_url: url }));
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Upload lỗi.");
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                </label>
              </div>

              {form.cover_url && (
                <div className="admin-news-cover-preview">
                  <Image
                    src={form.cover_url}
                    alt="Ảnh đại diện"
                    fill
                    sizes="520px"
                  />
                </div>
              )}
            </label>

            <label className="admin-span-2">
              Nội dung *
              <textarea
                required
                rows={14}
                value={form.content}
                onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
                placeholder={"Mỗi đoạn cách nhau bằng một dòng trống.\n\nVí dụ đoạn thứ hai..."}
              />
            </label>

            <label className="admin-check admin-span-2">
              <input
                type="checkbox"
                checked={form.is_featured}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, is_featured: e.target.checked }))
                }
              />
              Đánh dấu tin nổi bật
            </label>

            <div className="admin-form-actions admin-span-2">
              <button type="button" onClick={() => setShowForm(false)}>
                Hủy
              </button>
              <button className="admin-primary" disabled={loading || uploading}>
                {loading ? "Đang lưu..." : form.id ? "Cập nhật" : "Đăng bài"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="admin-list-card">
        <div className="admin-filter-bar"><input aria-label="Tìm tin" value={query} onChange={e=>{setQuery(e.target.value);setListPage(1);}} placeholder="Tìm tiêu đề tin tức..."/><select aria-label="Trạng thái tin" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setListPage(1);}}><option value="">Tất cả trạng thái</option><option value="draft">Bản nháp</option><option value="published">Đã xuất bản</option><option value="archived">Lưu trữ</option></select></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Bài viết</th>
                <th>Trạng thái</th>
                <th>Nổi bật</th>
                <th>Ngày xuất bản</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {filteredItems.slice((currentPage-1)*25,currentPage*25).map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="admin-news-row">
                      {item.cover_url ? (
                        <div className="admin-news-thumb">
                          <Image src={item.cover_url} alt="" fill sizes="96px" />
                        </div>
                      ) : (
                        <div className="admin-news-thumb admin-news-thumb-empty">
                          <Newspaper size={20} />
                        </div>
                      )}

                      <div>
                        <strong>{item.title}</strong>
                        <small>/{item.slug}</small>
                      </div>
                    </div>
                  </td>
                  <td>{item.status}</td>
                  <td>{item.is_featured ? "Có" : "Không"}</td>
                  <td>{formatDate(item.published_at ?? item.created_at)}</td>
                  <td>
                    <div className="admin-row-actions">
                      {item.status === "published" && <Link target="_blank" href={`/tin-tuc/${item.slug}`}>Xem</Link>}
                      <button onClick={() => startEdit(item)} aria-label="Sửa">
                        <Edit3 size={16} />
                      </button>
                      <button
                        className="admin-danger"
                        onClick={() => void remove(item.id)}
                        aria-label="Xóa"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!filteredItems.length && (
                <tr>
                  <td colSpan={5} className="admin-empty">
                    Chưa có bài viết.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pagination" style={{padding:16}}><span>Trang {currentPage}/{pages}</span><div><button disabled={currentPage<=1} onClick={()=>setListPage(currentPage-1)}>← Trước</button><button disabled={currentPage>=pages} onClick={()=>setListPage(currentPage+1)}>Tiếp →</button></div></div>
      </section>
    </main>
  );
}
