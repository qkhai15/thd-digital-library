import Image from "@/components/ContentImage";
import Link from "next/link";
import { notFound } from "next/navigation";
import LibraryShell from "@/components/LibraryShell";
import { getNewsBySlug } from "@/lib/library-repository";
import { cache } from "react";
import { publicMetadata } from "@/lib/public-metadata";

export const dynamic = "force-dynamic";
const getPublicNews = cache(getNewsBySlug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = await getPublicNews(slug);
  if (!item) notFound();
  return publicMetadata({
    title: item.title,
    path: `/tin-tuc/${encodeURIComponent(item.slug)}`,
    description: item.excerpt || item.content,
    image: item.cover_url,
    article: { publishedTime: item.published_at || item.created_at, modifiedTime: item.updated_at },
  });
}

function formatDate(value: string | null) {
  return new Date(value ?? Date.now()).toLocaleDateString("vi-VN");
}

export default async function NewsDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item = await getPublicNews(slug);

  if (!item) notFound();

  const paragraphs = item.content
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    <LibraryShell>
      <main className="flow-page">
        <div className="container">
          <div className="breadcrumb">
            <Link href="/">Trang chủ</Link>
            <span>/</span>
            <Link href="/tin-tuc">Tin tức</Link>
            <span>/</span>
            <strong>Chi tiết</strong>
          </div>

          <article className="article-panel article-detail news-detail-rich">
            <time>{formatDate(item.published_at ?? item.created_at)}</time>
            <h1>{item.title}</h1>

            {item.excerpt && <p className="news-detail-lead">{item.excerpt}</p>}

            {item.cover_url && (
              <div className="news-detail-cover">
                <Image
                  src={item.cover_url}
                  alt={item.title}
                  fill
                  sizes="(max-width: 900px) 100vw, 850px"
                  priority
                />
              </div>
            )}

            <div className="news-detail-content">
              {paragraphs.length ? (
                paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)
              ) : (
                <p>Chưa có nội dung chi tiết.</p>
              )}
            </div>

            <Link href="/tin-tuc" className="back-home">
              ← Quay lại Tin tức
            </Link>
          </article>
        </div>
      </main>
    </LibraryShell>
  );
}
