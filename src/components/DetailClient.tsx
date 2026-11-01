"use client";

import Image from "@/components/ContentImage";
import {
  Heart,
  MessageCircle,
  X,
  ChevronLeft,
  ChevronRight,
  BookOpenCheck,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { CommentItem, LibraryItem } from "@/lib/library-types";
import PdfViewer from "@/components/PdfViewer";
import DocumentShare from '@/components/DocumentShare';
import {SaveDocument} from '@/components/DeviceLibrary';
import {publicUrl} from '@/lib/public-metadata';
import {getItemHref} from '@/lib/library-url';
import AccessibleDialog from '@/components/AccessibleDialog';

export default function DetailClient({
  item,
  initialComments,
}: {
  item: LibraryItem;
  initialComments: CommentItem[];
}) {
  const [likes, setLikes] = useState(item.likes);
  const [liked, setLiked] = useState(false);
  const [liking, setLiking] = useState(false);
  const [visitorReady, setVisitorReady] = useState(false);
  const [comments, setComments] = useState(initialComments);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [borrowSending, setBorrowSending] = useState(false);
  const [borrowMessage, setBorrowMessage] = useState("");
  const [borrowForm, setBorrowForm] = useState({
    borrower_name: "",
    class_name: "",
    phone: "",
    email: "",
    note: "",
  });

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const response = await fetch(`/api/library/${item.id}/like`, { cache: "no-store" });
        if (!response.ok) throw new Error("Không thể tải trạng thái yêu thích.");
        const data = await response.json();
        if (cancelled) return;
        setLiked(Boolean(data.liked));
        setLikes(Number(data.likes) || 0);
        setVisitorReady(true);
        await fetch(`/api/library/${item.id}/view`, { method: "POST" });
      } catch {
        if (!cancelled) setMessage("Không thể kết nối thư viện. Vui lòng tải lại trang.");
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, [item.id]);

  async function toggleLike() {
    if (liking || !visitorReady) return;
    setLiking(true);
    try {
      const response = await fetch(`/api/library/${item.id}/like`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Không thể cập nhật yêu thích.");
      setLiked(Boolean(data.liked));
      setLikes(Number(data.likes) || 0);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lỗi kết nối. Vui lòng thử lại.");
    } finally { setLiking(false); }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!name.trim() || !content.trim()) return;

    setSending(true);
    try {
      const response = await fetch(`/api/library/${item.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.message || "Không thể gửi bình luận.");
        return;
      }

      if (data.status === "approved") {
        setComments((current) => [data, ...current]);
      }
      setContent("");
      setMessage(data.message || "Đã gửi bình luận.");
    } catch {
      setMessage("Lỗi kết nối. Vui lòng thử gửi bình luận lại.");
    } finally {
      setSending(false);
    }
  }

  async function submitBorrow(event: FormEvent) {
    event.preventDefault();
    setBorrowMessage("");
    setBorrowSending(true);
    try {
      const response = await fetch(`/api/library/${item.id}/borrow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(borrowForm),
      });
      const data = await response.json();
      setBorrowMessage(data.message || (response.ok ? "Đã gửi yêu cầu." : "Không thể gửi yêu cầu."));
      if (response.ok) {
        setBorrowForm({ borrower_name: "", class_name: "", phone: "", email: "", note: "" });
      }
    } catch {
      setBorrowMessage("Lỗi kết nối. Vui lòng thử gửi yêu cầu lại.");
    } finally {
      setBorrowSending(false);
    }
  }

  const isPdf = Boolean(item.file_url && /\.pdf(?:[?#]|$)/i.test(item.file_url));
  const isAudio = item.type === "sach-noi";
  const isVideo = item.type === "video";
  const isAlbum = item.type === "album";

  return (
    <>
      <div className="detail-actions-row">
        <button disabled={!visitorReady || liking} className={liked ? "action-chip liked" : "action-chip"} onClick={toggleLike}>
          <Heart size={17} fill={liked ? "currentColor" : "none"} />
          {liked ? "Đã yêu thích" : "Yêu thích"} ({likes})
        </button>
        <SaveDocument id={item.id}/>
        <DocumentShare id={item.id} title={item.title} url={publicUrl(getItemHref(item))}/>
        {item.type === "sach-giay" && (
          <button className="action-chip primary" onClick={() => setBorrowOpen(true)} disabled={(item.stock ?? 0) <= 0}>
            <BookOpenCheck size={17} />
            {(item.stock ?? 0) > 0 ? "Đăng ký mượn sách" : "Đã hết sách"}
          </button>
        )}
      </div>

      {isPdf && item.file_url && (
        <section className="detail-section">
          <h2>Đọc tài liệu</h2>
          <PdfViewer key={item.file_url} url={item.file_url} title={item.title} />
        </section>
      )}

      {isAudio && item.file_url && (
        <section className="detail-section">
          <h2>Nghe sách</h2>
          <audio className="media-audio" controls src={item.file_url} />
        </section>
      )}

      {isVideo && item.file_url && (
        <section className="detail-section">
          <h2>Xem video</h2>
          <video className="media-video" controls preload="metadata" poster={item.cover_url || undefined} src={item.file_url} />
        </section>
      )}

      {item.file_url && !isPdf && !["album", "sach-giay"].includes(item.type) && (
        <a className="media-download" href={item.file_url} target="_blank" rel="noopener noreferrer">Mở file trong tab mới / tải xuống</a>
      )}

      {isAlbum && item.gallery_urls.length > 0 && (
        <section className="detail-section">
          <h2>Album ảnh</h2>
          <div className="album-viewer">
            <button aria-label="Ảnh trước" onClick={() => setGalleryIndex((galleryIndex - 1 + item.gallery_urls.length) % item.gallery_urls.length)}>
              <ChevronLeft />
            </button>
            <button aria-label="Phóng to ảnh album" className="album-main" onClick={() => setLightbox(true)}>
              <Image src={item.gallery_urls[galleryIndex]} alt="Album" fill sizes="900px" className="album-image" />
            </button>
            <button aria-label="Ảnh tiếp theo" onClick={() => setGalleryIndex((galleryIndex + 1) % item.gallery_urls.length)}>
              <ChevronRight />
            </button>
          </div>
          <div className="album-thumbs">
            {item.gallery_urls.map((src, index) => (
              <button aria-label={`Chọn ảnh ${index + 1}`} aria-pressed={index === galleryIndex} key={`${src}-${index}`} onClick={() => setGalleryIndex(index)} className={index === galleryIndex ? "active" : ""}>
                <Image src={src} alt="" fill sizes="100px" />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="detail-section">
        <h2><MessageCircle size={19} /> Bình luận</h2>
        <form className="comment-form" onSubmit={submitComment}>
          <input placeholder="Tên của bạn" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <textarea placeholder="Nhập bình luận..." rows={3} maxLength={2000} value={content} onChange={(e) => setContent(e.target.value)} />
          <button disabled={sending || !visitorReady}>{sending ? "Đang gửi..." : "Gửi bình luận"}</button>
        </form>
        {message && <p className="muted">{message}</p>}
        <div className="comment-list">
          {comments.length ? comments.map((comment) => (
            <article key={comment.id}>
              <strong>{comment.name}</strong>
              <time>{new Date(comment.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time>
              <p>{comment.content}</p>
            </article>
          )) : <p className="muted">Chưa có bình luận.</p>}
        </div>
      </section>

      {borrowOpen && (
        <AccessibleDialog label="Đăng ký mượn sách" onClose={()=>setBorrowOpen(false)}>
            <button aria-label="Đóng đăng ký mượn" className="modal-close" onClick={() => setBorrowOpen(false)}><X /></button>
            <h3>Đăng ký mượn sách</h3>
            <p>Hiện còn <b>{item.stock ?? 0}</b> cuốn. Gửi thông tin để thư viện xác nhận.</p>
            <form className="comment-form" onSubmit={submitBorrow}>
              <input aria-label="Họ và tên người mượn" maxLength={150} required placeholder="Họ và tên *" value={borrowForm.borrower_name} onChange={(e) => setBorrowForm((f) => ({ ...f, borrower_name: e.target.value }))} />
              <input aria-label="Lớp người mượn" maxLength={80} placeholder="Lớp (VD: 12A1)" value={borrowForm.class_name} onChange={(e) => setBorrowForm((f) => ({ ...f, class_name: e.target.value }))} />
              <input aria-label="Số điện thoại người mượn" type="tel" maxLength={40} placeholder="Số điện thoại" value={borrowForm.phone} onChange={(e) => setBorrowForm((f) => ({ ...f, phone: e.target.value }))} />
              <input aria-label="Email người mượn" type="email" maxLength={180} placeholder="Email" value={borrowForm.email} onChange={(e) => setBorrowForm((f) => ({ ...f, email: e.target.value }))} />
              <textarea aria-label="Ghi chú mượn sách" maxLength={1000} placeholder="Ghi chú" rows={2} value={borrowForm.note} onChange={(e) => setBorrowForm((f) => ({ ...f, note: e.target.value }))} />
              <button className="primary-btn" disabled={borrowSending || !visitorReady}>{borrowSending ? "Đang gửi..." : "Gửi yêu cầu mượn"}</button>
            </form>
            {borrowMessage && <p className="muted" role="status">{borrowMessage}</p>}
        </AccessibleDialog>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <button aria-label="Đóng ảnh phóng to" className="lightbox-close">×</button>
          <div className="lightbox-inner">
            <Image src={item.gallery_urls[galleryIndex]} alt="Album" fill sizes="95vw" className="lightbox-img" />
          </div>
        </div>
      )}
    </>
  );
}
