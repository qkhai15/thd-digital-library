import { cleanText, safeContentUrl } from "./backend-utils";
export function bannerInput(body: Record<string,unknown>) {
  const image = safeContentUrl(body.image_url);
  const link = safeContentUrl(body.link_url);
  const order = Number(body.sort_order ?? 0);
  if (!image) throw new Error("Ảnh báo tường phải là đường dẫn hoặc URL hợp lệ.");
  if (cleanText(body.link_url) && !link) throw new Error("Liên kết báo tường không hợp lệ.");
  if (!Number.isSafeInteger(order) || order < -2147483648 || order > 2147483647) throw new Error("Thứ tự phải là số nguyên hợp lệ.");
  return {title:cleanText(body.title,255),image,link:link||null,active:body.is_active !== false,order};
}
