import { getPublicSitemap } from "@/lib/public-sitemap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return new Response(await getPublicSitemap(), {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" },
    });
  } catch {
    // Do not publish a partial sitemap or return database details during an outage.
    console.error("[sitemap] Public sitemap is temporarily unavailable.");
    return new Response("Sitemap tạm thời không khả dụng.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "60" },
    });
  }
}
