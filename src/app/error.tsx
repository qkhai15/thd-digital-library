"use client";

import Link from "next/link";
export default function ErrorPage({ reset }: { error: Error & {digest?:string}; reset: () => void }) {
  return <main className="flow-page"><div className="container results-card"><h1>Thư viện tạm thời chưa kết nối được</h1><p>Vui lòng thử lại sau. Nội dung và dữ liệu của bạn vẫn được giữ nguyên.</p><button className="primary-btn" onClick={reset}>Thử lại</button> <Link href="/">Về trang chủ</Link></div></main>;
}
