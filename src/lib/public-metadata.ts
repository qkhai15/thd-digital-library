import type { Metadata } from "next";

// The canonical host is a site identity, not the hostname of a preview or tunnel.
export const PUBLIC_SITE_ORIGIN = "https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn";
export const PUBLIC_SITE_NAME = "Thư viện điện tử THPT Trần Hưng Đạo - Thanh Xuân";
export const PUBLIC_SITE_DESCRIPTION = "Thư viện điện tử Trường THPT Trần Hưng Đạo - Thanh Xuân: tra cứu sách giấy, sách điện tử, sách nói, video, album ảnh và tin tức nhà trường.";

export function publicStructuredData() {
  const schoolId = `${PUBLIC_SITE_ORIGIN}/#school`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${PUBLIC_SITE_ORIGIN}/#website`,
        url: publicUrl(),
        name: PUBLIC_SITE_NAME,
        alternateName: "Thư viện số THPT Trần Hưng Đạo - Thanh Xuân",
        description: PUBLIC_SITE_DESCRIPTION,
        inLanguage: "vi-VN",
        publisher: { "@id": schoolId },
      },
      {
        "@type": "School",
        "@id": schoolId,
        name: "Trường THPT Trần Hưng Đạo - Thanh Xuân",
        url: "https://www.tranhungdaothanhxuan-hanoi.edu.vn/",
        logo: publicUrl("/logo-thd.png"),
      },
    ],
  };
}

// JSON-LD lives inside an HTML script element; escaping '<' prevents closing it.
export function serializeStructuredData(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function publicUrl(path = "/") {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Đường dẫn public phải nằm trong website thư viện.");
  }
  const url = new URL(path, PUBLIC_SITE_ORIGIN);
  if (url.origin !== PUBLIC_SITE_ORIGIN) throw new Error("Đường dẫn public không hợp lệ.");
  url.hash = "";
  return url.toString();
}

export function metadataDescription(value: string | null | undefined, fallback = PUBLIC_SITE_DESCRIPTION) {
  const plain = (value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return (plain || fallback).slice(0, 180);
}

function publicImage(value?: string | null) {
  if (value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return publicUrl(value);
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password) return url.toString();
    } catch { /* An invalid image uses the existing school logo. */ }
  }
  return publicUrl("/logo-thd.png");
}

export function publicMetadata(input: {
  title: string;
  path: string;
  description?: string | null;
  image?: string | null;
  article?: { publishedTime?: string | null; modifiedTime?: string | null };
}): Metadata {
  const title = `${input.title} | THPT Trần Hưng Đạo - Thanh Xuân`;
  const description = metadataDescription(input.description);
  const image = { url: publicImage(input.image), alt: input.title };
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: publicUrl(input.path) },
    openGraph: {
      type: input.article ? "article" : "website",
      title,
      description,
      url: publicUrl(input.path),
      siteName: PUBLIC_SITE_NAME,
      locale: "vi_VN",
      images: [image],
      ...(input.article ? {
        publishedTime: input.article.publishedTime || undefined,
        modifiedTime: input.article.modifiedTime || undefined,
      } : {}),
    },
    twitter: { card: "summary", title, description, images: [image.url] },
  };
}
