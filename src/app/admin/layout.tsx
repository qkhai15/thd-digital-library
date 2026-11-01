import type { Metadata } from "next";
import "./admin.css";
export const metadata: Metadata = {
  title: "Quản trị thư viện",
  robots: { index: false, follow: false, noarchive: true },
  alternates: { canonical: null },
};
export default function AdminLayout({children}:{children:React.ReactNode}){return children}
