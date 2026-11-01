import { BookOpen, Images, Play } from "lucide-react";
import ContentImage from "./ContentImage";
import type { LibraryItem } from "@/lib/library-types";

export default function ContentThumbnail({ item, sizes = "220px" }: { item: LibraryItem; sizes?: string }) {
  if (item.type === "video" && item.file_url) {
    return <><video src={`${item.file_url}#t=0.1`} poster={item.cover_url || undefined} muted playsInline preload="metadata" className="content-thumbnail-video" aria-label={item.title} /><span className="thumbnail-badge"><Play size={18} /></span></>;
  }
  const image = item.type === "album" ? item.gallery_urls?.[0] : item.cover_url;
  return image ? <ContentImage src={image} alt={item.title} fill sizes={sizes} className="real-cover-image" />
    : <div className="cover-fallback">{item.type === "album" ? <Images size={40} /> : <BookOpen size={40} />}</div>;
}
