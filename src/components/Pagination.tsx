import Link from "next/link";

export default function Pagination({ page, totalPages, href }: { page: number; totalPages: number; href: (page: number) => string }) {
  if (totalPages <= 1) return null;
  return <nav className="pagination" aria-label="Phân trang"><span>Trang {page} / {totalPages}</span><div>
    {page > 1 ? <Link href={href(page - 1)}>← Trước</Link> : <span>← Trước</span>}
    {page < totalPages ? <Link href={href(page + 1)}>Tiếp →</Link> : <span>Tiếp →</span>}
  </div></nav>;
}
