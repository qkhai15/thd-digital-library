'use client';
import Link from 'next/link';
import LibraryShell from '@/components/LibraryShell';
export default function SearchError({retry}:{retry:()=>void}){
  return <LibraryShell><main className="flow-page"><section className="container results-card"><h1>Chưa thể tải kết quả tìm kiếm</h1><p role="alert">Kết nối thư viện đang gián đoạn. Vui lòng thử lại sau ít giây.</p><button className="action-chip" onClick={retry}>Thử lại tìm kiếm</button><Link className="action-chip" href="/">Về trang chủ</Link></section></main></LibraryShell>;
}
