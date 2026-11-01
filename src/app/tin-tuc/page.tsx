import Image from "@/components/ContentImage";
import Link from "next/link";
import LibraryShell from "@/components/LibraryShell";
import { searchNews } from "@/lib/library-repository";
import Pagination from "@/components/Pagination";
import { boundedInt } from "@/lib/backend-utils";
import { publicMetadata } from "@/lib/public-metadata";

export const dynamic = "force-dynamic";
export const metadata = publicMetadata({ title: "Tin tức và hoạt động", path: "/tin-tuc", description: "Tin tức nhà trường, hoạt động thư viện và văn hóa đọc của THPT Trần Hưng Đạo - Thanh Xuân." });

function formatDate(value: string | null) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString("vi-VN");
}

export default async function NewsPage({searchParams}:{searchParams:Promise<{page?:string}>}) {
  const sp = await searchParams;
  const result = await searchNews(boundedInt(sp.page,1,1000000));
  const newsItems = result.items;

  return (
    <LibraryShell>
      <main className="flow-page">
        <div className="container">
          <div className="breadcrumb">
            <Link href="/">Trang chủ</Link>
            <span>/</span>
            <strong>Tin tức</strong>
          </div>

          <section className="article-panel">
            <div className="news-page-heading">
              <div>
                <span className="news-page-eyebrow">TIN NHÀ TRƯỜNG</span>
                <h1>Tin tức & hoạt động</h1>
              </div>
              <p>Cập nhật hoạt động thư viện, nhà trường và các nội dung học tập nổi bật.</p>
            </div>

            {newsItems.length ? (
              <div className="news-list news-list-rich">
                {newsItems.map((item) => (
                  <Link key={item.id} href={`/tin-tuc/${item.slug}`} className="news-list-card">
                    <div className="news-list-cover">
                      {item.cover_url ? (
                        <Image
                          src={item.cover_url}
                          alt={item.title}
                          fill
                          sizes="(max-width: 700px) 100vw, 280px"
                        />
                      ) : (
                        <div className="news-cover-fallback">THĐ</div>
                      )}
                    </div>

                    <div className="news-list-copy">
                      <time>{formatDate(item.published_at ?? item.created_at)}</time>
                      <h2>{item.title}</h2>
                      <p>{item.excerpt || "Tin tức và hoạt động mới từ nhà trường."}</p>
                      <span>Xem chi tiết →</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-box">Chưa có tin tức.</div>
            )}
            <Pagination page={result.page} totalPages={result.totalPages} href={page=>`/tin-tuc?page=${page}`}/>
          </section>
        </div>
      </main>
    </LibraryShell>
  );
}
