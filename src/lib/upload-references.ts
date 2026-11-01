// Retain detached files during migration. Never delete shared objects or legacy files
// inside a content transaction. Audit details allow a later, explicit cleanup review.
type MediaRecord = { cover_url?: string | null; file_url?: string | null; image_url?: string | null; gallery_urls?: unknown };
export function mediaReferences(record: MediaRecord) {
  return [...new Set([record.cover_url, record.file_url, record.image_url,
    ...(Array.isArray(record.gallery_urls) ? record.gallery_urls : [])]
    .filter((url): url is string => typeof url === "string" && Boolean(url)))];
}
export function retainedMedia(previous: MediaRecord, next: MediaRecord = {}) {
  const current = new Set(mediaReferences(next));
  return { retained_media: mediaReferences(previous).filter(url => !current.has(url)), storage_policy: "retain-during-migration" };
}
