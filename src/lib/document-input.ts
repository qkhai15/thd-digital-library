import { cleanText, safeContentUrl } from "@/lib/backend-utils";
import { ACTIVE_LIBRARY_TYPES, LIBRARY_TYPES, TYPE_LABELS, isBookSectionType, type LibraryType } from "@/lib/library-types";
import { documentMetadata } from "@/lib/document-metadata";
import { publicationStatus } from "@/lib/publication-policy";

export function documentInput(body: Record<string, unknown>, existingType?: string) {
  const title = cleanText(body.title, 500);
  const type = cleanText(body.type, 80) as LibraryType;
  if (!title) throw new Error("Bạn chưa nhập tên tài liệu.");
  if (!LIBRARY_TYPES.includes(type) || (!ACTIVE_LIBRARY_TYPES.includes(type) && type !== existingType)) {
    throw new Error("Loại tài liệu này hiện chưa được sử dụng.");
  }
  const status = publicationStatus(body.status);
  const classLevel = cleanText(body.class_level || "Khác", 30);
  if (!["10", "11", "12", "Khác"].includes(classLevel)) throw new Error("Lớp không hợp lệ.");
  const readUrl = (value: unknown) => {
    const raw = cleanText(value, 2000);
    const safe = safeContentUrl(raw);
    if (raw && !safe) throw new Error("Liên kết phải là đường dẫn nội bộ hoặc URL HTTP/HTTPS hợp lệ.");
    return safe || null;
  };
  const coverUrl = type === "album" ? null : readUrl(body.cover_url);
  const fileUrl = ["album", "sach-giay"].includes(type) ? null : readUrl(body.file_url);
  const galleryUrls = type === "album" && Array.isArray(body.gallery_urls)
    ? body.gallery_urls.map(readUrl).filter((url): url is string => Boolean(url)).slice(0, 100) : [];
  let stock: number | null = null;
  if (type === "sach-giay") {
    stock = body.stock === "" || body.stock == null ? 0 : Number(body.stock);
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 2147483647) throw new Error("Tồn kho phải là số nguyên không âm.");
  }
  if (status === "published") {
    if (type === "album" && !galleryUrls.length) throw new Error("Album cần ít nhất một ảnh trước khi xuất bản.");
    if (!["album", "sach-giay"].includes(type) && !fileUrl) throw new Error("Cần file nội dung trước khi xuất bản.");
  }
  return {
    metadata: documentMetadata(body),
    title, type, status, classLevel, stock, coverUrl, fileUrl, galleryUrls,
    author: cleanText(body.author, 255), category: cleanText(body.category, 150),
    format: cleanText(body.format, 120) || TYPE_LABELS[type],
    description: cleanText(body.description, 20_000),
    isFeatured: isBookSectionType(type) && body.is_featured === true,
  };
}
