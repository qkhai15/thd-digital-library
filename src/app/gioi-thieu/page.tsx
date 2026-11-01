import Link from "next/link";
import LibraryShell from "@/components/LibraryShell";
import { publicMetadata } from "@/lib/public-metadata";
export const metadata = publicMetadata({ title: "Giới thiệu thư viện", path: "/gioi-thieu" });
export default function About(){return <LibraryShell><main className="flow-page"><div className="container"><div className="breadcrumb"><Link href="/">Trang chủ</Link><span>/</span><strong>Giới thiệu</strong></div><article className="article-panel article-detail"><h1>Thư viện điện tử THPT Trần Hưng Đạo - Thanh Xuân</h1><p>Không gian học liệu trực tuyến hỗ trợ giáo viên và học sinh tra cứu sách, tài liệu, bài giảng, sách nói, video và album hoạt động.</p><p>Hệ thống được thiết kế để nội dung có thể được cập nhật trực tiếp từ trang quản trị mà không cần sửa mã nguồn.</p></article></div></main></LibraryShell>}
