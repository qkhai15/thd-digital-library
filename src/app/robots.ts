import type { MetadataRoute } from "next";
import { PUBLIC_SITE_ORIGIN, publicUrl } from "@/lib/public-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/dang-nhap", "/tim-kiem"],
    },
    host: PUBLIC_SITE_ORIGIN,
    sitemap: publicUrl("/sitemap.xml"),
  };
}
