import Link from "next/link";
import Image from "@/components/ContentImage";
import { BookOpen, Eye } from "lucide-react";
import { notFound } from "next/navigation";
import LibraryShell from "@/components/LibraryShell";
import DetailClient from "@/components/DetailClient";
import { getComments, getItemById } from "@/lib/library-repository";
import { getItemIdFromSlug } from "@/lib/library-url";
import { getItemHref } from "@/lib/library-url";
import { publicMetadata } from "@/lib/public-metadata";
import { cache } from "react";
import { TYPE_LABELS } from "@/lib/library-types";
import { ACTIVE_LIBRARY_TYPES } from "@/lib/library-types";
import {getRelatedItems} from '@/lib/catalog';
import ContentThumbnail from '@/components/ContentThumbnail';
import DocumentMetadata from '@/components/DocumentMetadata';

export const dynamic = "force-dynamic";
const getPublicItem = cache(async (type: string, slug: string) => {
  const id = getItemIdFromSlug(slug);
  if (!id) notFound();
  const item = await getItemById(id);
  if (!item || item.type !== type || !ACTIVE_LIBRARY_TYPES.includes(item.type)) notFound();
  return item;
});

export async function generateMetadata({ params }: { params: Promise<{ type: string; slug: string }> }) {
  const { type, slug } = await params;
  const item = await getPublicItem(type, slug);
  return publicMetadata({
    title: item.title,
    path: getItemHref(item),
    description: item.description || [TYPE_LABELS[item.type],item.title,item.author,item.subject_name,item.class_level!=='Khác'?`Khối ${item.class_level}`:'',item.publisher,item.publication_year].filter(Boolean).join(' · '),
    image: item.type === "album" ? item.gallery_urls[0] : item.cover_url,
  });
}

export default async function DetailPage({
  params,
}: {
  params: Promise<{ type: string; slug: string }>;
}) {
  const { slug, type } = await params;
  const item = await getPublicItem(type, slug);
  const [comments,related] = await Promise.all([getComments(item.id),getRelatedItems(item.id)]);

  const isVideo = item.type === "video";
  const isAlbum = item.type === "album";
  const isPaper = item.type === "sach-giay";
  const hideCover = isVideo || isAlbum;

  return (
    <LibraryShell>
      <main className="flow-page">
        <div className="container">
          <div className="breadcrumb">
            <Link href="/">Trang chủ</Link>
            <span>/</span>
            <Link href={`/tai-lieu/${item.type}`}>{TYPE_LABELS[item.type]}</Link>
            <span>/</span>
            <strong>Chi tiết</strong>
          </div>

          <section className={`detail-card ${hideCover ? "detail-card-no-cover" : ""}`}>
            {!hideCover && (
              <div className={`detail-cover ${item.cover_url ? "" : "detail-cover-generated"}`}>
                {item.cover_url ? (
                  <Image
                    src={item.cover_url}
                    alt={item.title}
                    width={300}
                    height={420}
                    className="detail-real-cover"
                  />
                ) : (
                  <>
                    <small>THPT TRẦN HƯNG ĐẠO</small>
                    <BookOpen size={70} strokeWidth={1.2} />
                    <strong>{item.title}</strong>
                    <span>{item.format}</span>
                  </>
                )}
              </div>
            )}

            <div className="detail-info">
              <span className="detail-kind">{TYPE_LABELS[item.type]}</span>
              <h1>{item.title}</h1>
              <p className="detail-author">{item.author}</p>

              <div className="detail-stats">
                <span>
                  <Eye size={17} />
                  {item.views.toLocaleString("vi-VN")} lượt xem
                </span>
              </div>

              <DocumentMetadata item={item}/>

              {item.description && <p className="detail-desc">{item.description}</p>}

              {item.file_url && !isPaper && !isAlbum && (
                <a className="green-btn" href="#noi-dung">
                  <BookOpen size={17} /> MỞ NỘI DUNG
                </a>
              )}
            </div>
          </section>

          <div id="noi-dung">
            <DetailClient key={item.id} item={item} initialComments={comments} />
          </div>
          {!!related.length&&<section className="library-section"><h2>Có thể bạn quan tâm</h2><div className="result-grid">{related.map(document=><Link className="result-card" key={document.id} href={getItemHref(document)}><div className="result-cover real-cover-wrap"><ContentThumbnail item={document}/></div><h3>{document.title}</h3><p>{document.author}</p></Link>)}</div></section>}
        </div>
      </main>
    </LibraryShell>
  );
}
