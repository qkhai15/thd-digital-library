import type { NextConfig } from "next";

// Next's development asset check uses hostnames; API origin checks remain exact.
const devOrigins = [process.env.APP_ORIGIN, ...(process.env.PUBLIC_ORIGINS || "").split(",")]
  .filter((value): value is string => Boolean(value?.trim()))
  .flatMap(value => {
    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" && !url.hostname.includes("*") ? [url.hostname] : [];
    } catch { return []; }
  });

const nextConfig: NextConfig = {
  allowedDevOrigins: [...new Set(devOrigins)],
  turbopack: { root: process.cwd() },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }, ...["/admin/:path*", "/api/:path*", "/dang-nhap"].map(source => ({
      source,
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        { key: "Cache-Control", value: "no-store" },
      ],
    }))];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
};

export default nextConfig;
