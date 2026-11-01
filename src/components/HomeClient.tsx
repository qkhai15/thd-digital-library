"use client";

import Image from "@/components/ContentImage";
import Link from "next/link";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  Heart,
  Images,
  Play,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LibraryItem, LibraryType, WallBanner } from "@/lib/library-types";
import { getItemHref } from "@/lib/library-url";

export function DocumentCard({ item }: { item: LibraryItem }) {
  return (
    <Link href={getItemHref(item)} className="book-card">
      <div className="book-cover real-cover-wrap">
        {item.cover_url ? (
          <Image
            src={item.cover_url}
            alt={item.title}
            fill
            sizes="180px"
            className="real-cover-image"
          />
        ) : (
          <div className="cover-fallback">
            <BookOpen size={44} />
          </div>
        )}
      </div>

      <div className="book-info">
        <h3>{item.title}</h3>
        <p>{item.author || "Thư viện nhà trường"}</p>
        <div className="book-bottom">
          <span>{item.format}</span>
          <div>
            <Eye size={13} />
            {item.views}
          </div>
        </div>
      </div>
    </Link>
  );
}

function VideoSection({
  title,
  items,
  href,
}: {
  title: string;
  items: LibraryItem[];
  href: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (direction: number) =>
    ref.current?.scrollBy({ left: direction * 520, behavior: "smooth" });

  return (
    <section className="library-section media-section video-section">
      <div className="section-header media-section-header">
        <div>
          <span className="media-eyebrow">VIDEO THƯ VIỆN</span>
          <h2>{title}</h2>
        </div>

        <div className="section-actions">
          <button type="button" onClick={() => move(-1)} className="slider-arrow" aria-label="Video trước">
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => move(1)} className="slider-arrow" aria-label="Video tiếp theo">
            <ChevronRight size={18} />
          </button>
          <Link href={href} className="view-all">
            Xem tất cả <ChevronRight size={16} />
          </Link>
        </div>
      </div>

      {items.length ? (
        <div className="video-slider" ref={ref}>
          {items.map((item) => (
            <Link href={getItemHref(item)} className="video-card" key={item.id}>
              <div className="video-thumb">
                {item.file_url ? (
                  <video
                    src={`${item.file_url}#t=0.12`}
                    poster={item.cover_url || undefined}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    className="video-thumb-video"
                    onMouseEnter={(event) => {
                      event.currentTarget.play().catch(() => undefined);
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.pause();
                    }}
                  />
                ) : item.cover_url ? (
                  <Image
                    src={item.cover_url}
                    alt={item.title}
                    fill
                    sizes="(max-width: 700px) 86vw, 470px"
                    className="video-thumb-image"
                  />
                ) : (
                  <div className="video-fallback">
                    <Play size={48} />
                  </div>
                )}

                <div className="video-shade" />
                <div className="video-play">
                  <Play size={25} fill="currentColor" />
                </div>
                <span className="video-badge">VIDEO</span>
              </div>

              <div className="video-card-body">
                <h3>{item.title}</h3>
                <p>{item.author || "Trường THPT Trần Hưng Đạo - Thanh Xuân"}</p>
                <div className="video-card-meta">
                  <span>
                    <Eye size={14} /> {item.views.toLocaleString("vi-VN")}
                  </span>
                  <span>{item.category || "VIDEO HOẠT ĐỘNG"}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="media-empty video-empty">
          <div className="media-empty-icon"><Play size={28} /></div>
          <div>
            <strong>Chưa có video</strong>
            <p>Video hoạt động của nhà trường sẽ hiển thị tại đây.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function AlbumSection({
  title,
  items,
  href,
}: {
  title: string;
  items: LibraryItem[];
  href: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (direction: number) =>
    ref.current?.scrollBy({ left: direction * 570, behavior: "smooth" });

  return (
    <section className="library-section media-section album-section-home">
      <div className="section-header media-section-header">
        <div>
          <span className="media-eyebrow">KHOẢNH KHẮC NHÀ TRƯỜNG</span>
          <h2>{title}</h2>
        </div>

        <div className="section-actions">
          <button type="button" onClick={() => move(-1)} className="slider-arrow" aria-label="Album trước">
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => move(1)} className="slider-arrow" aria-label="Album tiếp theo">
            <ChevronRight size={18} />
          </button>
          <Link href={href} className="view-all">
            Xem tất cả <ChevronRight size={16} />
          </Link>
        </div>
      </div>

      {items.length ? (
        <div className="album-home-slider" ref={ref}>
          {items.map((item) => {
            const images = item.gallery_urls?.length
              ? item.gallery_urls
              : item.cover_url
                ? [item.cover_url]
                : [];
            const preview = images.slice(0, 4);

            return (
              <Link href={getItemHref(item)} className="album-home-card" key={item.id}>
                <div className={`album-collage album-count-${Math.max(1, Math.min(preview.length, 4))}`}>
                  {preview.length ? (
                    preview.map((src, index) => (
                      <div className={`album-cell album-cell-${index + 1}`} key={`${src}-${index}`}>
                        <Image
                          src={src}
                          alt={`${item.title} - ảnh ${index + 1}`}
                          fill
                          sizes="(max-width: 700px) 43vw, 260px"
                          className="album-cell-image"
                        />
                      </div>
                    ))
                  ) : (
                    <div className="album-fallback">
                      <Images size={42} />
                    </div>
                  )}

                  <div className="album-overlay" />
                  <div className="album-count-badge">
                    <Images size={15} /> {images.length} ảnh
                  </div>
                </div>

                <div className="album-home-body">
                  <h3>{item.title}</h3>
                  <p>{item.description || "Album hình ảnh hoạt động của nhà trường."}</p>
                  <div className="album-home-meta">
                    <span>{item.author || "Thư viện nhà trường"}</span>
                    <span><Eye size={14} /> {item.views.toLocaleString("vi-VN")}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="media-empty album-empty">
          <div className="media-empty-icon"><Images size={28} /></div>
          <div>
            <strong>Chưa có album ảnh</strong>
            <p>Ảnh sự kiện, hoạt động ngoại khóa và khoảnh khắc của trường sẽ hiển thị tại đây.</p>
          </div>
        </div>
      )}
    </section>
  );
}

export function DocumentSection({
  title,
  type,
  items,
  href,
}: {
  title: string;
  type: LibraryType;
  items: LibraryItem[];
  href?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const targetHref = href ?? `/tai-lieu/${type}`;
  const move = (direction: number) =>
    ref.current?.scrollBy({ left: direction * 700, behavior: "smooth" });

  if (type === "video") {
    return <VideoSection title={title} items={items} href={targetHref} />;
  }
  if (type === "album") {
    return <AlbumSection title={title} items={items} href={targetHref} />;
  }

  return (
    <section className="library-section">
      <div className="section-header">
        <h2>{title}</h2>
        <div className="section-actions">
          <button type="button" onClick={() => move(-1)} className="slider-arrow" aria-label="Trượt trái">
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => move(1)} className="slider-arrow" aria-label="Trượt phải">
            <ChevronRight size={18} />
          </button>
          <Link href={targetHref} className="view-all">
            Xem tất cả <ChevronRight size={16} />
          </Link>
        </div>
      </div>

      {items.length ? (
        <div className="book-slider" ref={ref}>
          {items.map((item) => <DocumentCard key={item.id} item={item} />)}
        </div>
      ) : (
        <div className="empty-box">Chưa có tài liệu.</div>
      )}
    </section>
  );
}

export function Popular({ items }: { items: LibraryItem[] }) {
  const filtered = items.filter(
    (item) => !["video", "album", "bai-giang-dien-tu", "ky-nang-song"].includes(item.type)
  );
  const [active, setActive] = useState(0);

  const safeActive = active < filtered.length ? active : 0;
  const item = filtered[safeActive];
  if (!item) {
    return (
      <section className="popular">
        <div className="container">
          <h2 className="popular-title">Tài liệu thịnh hành</h2>
          <div className="empty-box">Chưa có tài liệu.</div>
        </div>
      </section>
    );
  }

  return (
    <section className="popular">
      <div className="container">
        <div className="popular-heading"><h2 className="popular-title">Tài liệu thịnh hành</h2><Link href="/tai-lieu/thinh-hanh">Xem tất cả →</Link></div>
        <div className="popular-layout">
          <div className="popular-featured">
            <div className="popular-main-cover real-cover-wrap">
              <Image
                src={item.cover_url || "/logo-thd.png"}
                alt={item.title}
                fill
                sizes="400px"
                className="real-cover-image"
              />
            </div>
            <div className="popular-info">
              <h3>{item.title}</h3>
              <div className="popular-meta">
                <span><Eye size={16} /> {item.views.toLocaleString("vi-VN")} lượt xem</span>
                <span><Heart size={16} /> {item.likes} lượt thích</span>
              </div>
              <p><b>Thể loại:</b> {item.category}</p>
              <p><b>Hình thức:</b> {item.format}</p>
              <Link href={getItemHref(item)} className="green-btn">
                <BookOpen size={17} /> XEM ĐẦY ĐỦ
              </Link>
            </div>
          </div>

          <div className="popular-list">
            {filtered.map((currentItem, index) => (
              <button
                type="button"
                key={currentItem.id}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onClick={() => setActive(index)}
                className={`popular-list-item ${index === safeActive ? "active" : ""}`}
              >
                <div className="popular-mini real-cover-wrap">
                  <Image
                    src={currentItem.cover_url || "/logo-thd.png"}
                    alt={currentItem.title}
                    fill
                    sizes="54px"
                    className="real-cover-image"
                  />
                </div>
                <div>
                  <h4>{currentItem.title}</h4>
                  <span>{currentItem.format} · {currentItem.category}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function WallSlider({ banners }: { banners: WallBanner[] }) {
  const displayBanners = banners;
  const [current, setCurrent] = useState(0);
  const [lightbox, setLightbox] = useState(false);

  const safeCurrent = current < displayBanners.length ? current : 0;

  useEffect(() => {
    if (displayBanners.length <= 1 || lightbox) return;
    const timer = window.setTimeout(() => {
      setCurrent((previous) => (previous + 1) % displayBanners.length);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [current, lightbox, displayBanners.length]);

  const go = (direction: number) => {
    setCurrent((previous) =>
      (previous + direction + displayBanners.length) % displayBanners.length
    );
  };

  const selected = displayBanners[safeCurrent] ?? displayBanners[0];

  if (!selected) return null;

  return (
    <section className="wall-section">
      <div className="section-header">
        <h2>Báo tường</h2>
        {displayBanners.length > 1 && (
          <div className="section-actions">
            <button type="button" className="slider-arrow" onClick={() => go(-1)} aria-label="Báo tường trước">
              <ChevronLeft size={18} />
            </button>
            <button type="button" className="slider-arrow" onClick={() => go(1)} aria-label="Báo tường tiếp theo">
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      <div className="wall-slider">
        <div
          className="wall-track"
          style={{ transform: `translateX(-${safeCurrent * 100}%)` }}
        >
          {displayBanners.map((banner, index) => (
            <button
              type="button"
              className="wall-slide"
              key={banner.id}
              onClick={() => {
                setCurrent(index);
                setLightbox(true);
              }}
              aria-label={`Phóng to ${banner.title || `Báo tường ${index + 1}`}`}
            >
              <Image
                src={banner.image_url}
                alt={banner.title || `Báo tường ${index + 1}`}
                fill
                sizes="(max-width: 768px) 100vw, 1200px"
                className="wall-image"
                priority={index === 0}
              />
            </button>
          ))}
        </div>

        {displayBanners.length > 1 && (
          <>
            <button type="button" className="wall-nav left" onClick={() => go(-1)} aria-label="Ảnh trước">
              <ChevronLeft />
            </button>
            <button type="button" className="wall-nav right" onClick={() => go(1)} aria-label="Ảnh tiếp theo">
              <ChevronRight />
            </button>
            <div className="wall-dots">
              {displayBanners.map((banner, index) => (
                <button
                  type="button"
                  key={banner.id}
                  className={index === safeCurrent ? "active" : ""}
                  onClick={() => setCurrent(index)}
                  aria-label={`Chuyển tới ${banner.title || `Báo tường ${index + 1}`}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {selected.link_url && <a className="wall-link" href={selected.link_url} target="_blank" rel="noopener noreferrer">Xem thêm: {selected.title || "Báo tường"} →</a>}

      {lightbox && selected && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(false)}>
          <button type="button" className="lightbox-close" onClick={() => setLightbox(false)} aria-label="Đóng">×</button>
          {displayBanners.length > 1 && (
            <button type="button" className="lightbox-nav lightbox-prev" onClick={(event) => { event.stopPropagation(); go(-1); }} aria-label="Ảnh trước">
              <ChevronLeft size={34} />
            </button>
          )}
          <div className="lightbox-inner" onClick={(event) => event.stopPropagation()}>
            <Image
              src={selected.image_url}
              alt={selected.title || "Báo tường"}
              fill
              sizes="95vw"
              className="lightbox-img"
            />
          </div>
          {displayBanners.length > 1 && (
            <button type="button" className="lightbox-nav lightbox-next" onClick={(event) => { event.stopPropagation(); go(1); }} aria-label="Ảnh tiếp theo">
              <ChevronRight size={34} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
