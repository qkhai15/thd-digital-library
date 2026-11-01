import type { Metadata } from "next";
import { PUBLIC_SITE_ORIGIN, PUBLIC_SITE_NAME, PUBLIC_SITE_DESCRIPTION, publicMetadata } from "@/lib/public-metadata";
import "./globals.css";
import "./library-db.css";
import "./mobile-fix.css";
import "./production-ui.css";

export const metadata: Metadata = {
  ...publicMetadata({ title: "Thư viện điện tử", path: "/", description: PUBLIC_SITE_DESCRIPTION }),
  metadataBase: new URL(PUBLIC_SITE_ORIGIN),
  applicationName: PUBLIC_SITE_NAME,
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
