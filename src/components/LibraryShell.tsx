"use client";

import Image from "@/components/StorageImage";
import Link from "next/link";
import { Menu, Search, UserRound, X } from "lucide-react";
import { FormEvent, ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { publicStructuredData, serializeStructuredData } from "@/lib/public-metadata";
import QuerySuggestions from '@/components/QuerySuggestions';

export default function LibraryShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/tim-kiem?q=${encodeURIComponent(q)}`);
    setSearchOpen(false);
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeStructuredData(publicStructuredData()) }}
      />
      <header className="main-header">
        <div className="container header-inner">
          <Link href="/" className="school-brand">
            <div className="school-logo">
              <Image src="/logo-thd.png" alt="Logo THPT Trần Hưng Đạo - Thanh Xuân" width={68} height={68} priority />
            </div>
            <div className="school-brand-text">
              <span>TRƯỜNG THPT TRẦN HƯNG ĐẠO - THANH XUÂN</span>
              <strong>THƯ VIỆN ĐIỆN TỬ</strong>
            </div>
          </Link>

          <div className="header-actions">
            <button className="icon-btn" onClick={() => setSearchOpen((v) => !v)} aria-label="Tìm kiếm"><Search size={20}/></button>
            <Link href="/admin/login" className="login-button" aria-label="Đăng nhập"><UserRound size={18}/><span>Đăng nhập</span></Link>
            <button className="mobile-menu" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">{menuOpen ? <X/> : <Menu/>}</button>
          </div>
        </div>
        {searchOpen && (
          <div className="search-area">
            <form className="container search-box" onSubmit={submitSearch}>
              <Search size={20}/>
              <QuerySuggestions autoFocus value={query} onChange={setQuery} placeholder="Nhập tên sách, tài liệu, tác giả..."/>
              <button type="submit">Tìm kiếm</button>
            </form>
          </div>
        )}
      </header>

      <nav className={`main-nav ${menuOpen ? "nav-open" : ""}`}>
        <div className="container nav-content">
          <Link href="/">Trang chủ</Link>
          <Link href="/tai-lieu/moi-nhat">Sách mới</Link>
          <Link href="/tai-lieu/sach-giay">Sách giấy</Link>
          <Link href="/tai-lieu/sach-dien-tu">Sách điện tử</Link>
          <Link href="/tai-lieu/sach-noi">Sách nói</Link>
          <Link href="/tai-lieu/video">Video</Link>
          <Link href="/tai-lieu/album">Album ảnh</Link>
          <Link href="/tai-lieu/tai-lieu-khac">Tài liệu khác</Link>
          <Link href="/tin-tuc">Tin tức</Link>
          <Link href="/bo-suu-tap">Bộ sưu tập</Link>
          <Link href="/kham-pha">Môn học / khối lớp</Link>
          <Link href="/da-luu">Đã lưu / đã xem</Link>
        </div>
      </nav>

      {children}

      <footer className="footer">
        <div className="container footer-grid">
          <div className="footer-school">
            <Image src="/logo-thd.png" alt="Logo trường" width={62} height={62}/>
            <div><span>THƯ VIỆN ĐIỆN TỬ</span><h3>THPT TRẦN HƯNG ĐẠO</h3><strong>THANH XUÂN</strong></div>
          </div>
          <div className="footer-column"><h4>Tài liệu</h4><Link href="/tai-lieu/sach-dien-tu">Sách điện tử</Link><Link href="/tai-lieu/sach-noi">Sách nói</Link><Link href="/tai-lieu/album">Album ảnh</Link><Link href="/tai-lieu/video">Video</Link></div>
          <div className="footer-column"><h4>Tin tức</h4><Link href="/gioi-thieu">Giới thiệu</Link><Link href="/tin-tuc">Tin nhà trường</Link></div>
          <div className="footer-right"><p>“A book, too, can be a star, a living fire to light the darkness.”</p><h4>KẾT NỐI VỚI CHÚNG TÔI</h4><div className="social-list"><a href="https://www.facebook.com/tranhungdaotxhn" target="_blank" rel="noreferrer">f</a><a
  href="https://www.tranhungdaothanhxuan-hanoi.edu.vn/"
  target="_blank"
  rel="noopener noreferrer"
  aria-label="Website nhà trường"
  title="Website nhà trường"
>
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.8 2.6 4.5 5.8 4.5 9s-1.7 6.4-4.5 9" />
    <path d="M12 3c-2.8 2.6-4.5 5.8-4.5 9s1.7 6.4 4.5 9" />
    <path d="M5.5 7.5c1.8.8 4.1 1.3 6.5 1.3s4.7-.5 6.5-1.3" />
    <path d="M5.5 16.5c1.8-.8 4.1-1.3 6.5-1.3s4.7.5 6.5 1.3" />
  </svg>
</a>
</div></div>
        </div>
        <div className="footer-bottom"><div className="container">© 2026 Trường THPT Trần Hưng Đạo - Thanh Xuân</div></div>
      </footer>
    </>
  );
}
