import LibraryShell from "@/components/LibraryShell";
import Link from "next/link";
export default function NotFound() {
  return <LibraryShell><main className="flow-page"><div className="container results-card"><h1>Không tìm thấy nội dung</h1><p>Nội dung có thể chưa được xuất bản hoặc đã chuyển sang lưu trữ.</p><Link className="green-btn" href="/">Về trang chủ</Link></div></main></LibraryShell>;
}
