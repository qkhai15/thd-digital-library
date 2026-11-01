import { PUBLICATION_STATUSES, type PublicationStatus } from "@/lib/library-types";

/** Single-admin workflow: review is available without forcing a second user. */
const transitions: Record<PublicationStatus, readonly PublicationStatus[]> = {
  draft: ["draft", "review", "published", "archived"],
  review: ["review", "draft", "published", "archived"],
  published: ["published", "draft", "review", "archived"],
  archived: ["archived", "draft", "review", "published"],
};

export function publicationStatus(value: unknown, fallback: PublicationStatus = "published"): PublicationStatus {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !PUBLICATION_STATUSES.includes(value as PublicationStatus)) {
    throw new Error("Trạng thái xuất bản không hợp lệ.");
  }
  return value as PublicationStatus;
}

export function publicationTransition(from: unknown, to: unknown) {
  const target = publicationStatus(to);
  const current = from === undefined ? undefined : publicationStatus(from);
  if (current && !transitions[current].includes(target)) throw new Error("Không thể chuyển trạng thái xuất bản.");
  const action = target === "published" ? current === "archived" ? "republish" : "publish"
    : target === "review" ? "submit_review" : target === "archived" ? "archive" : "save_draft";
  return { from: current, status: target, changed: current !== target, action };
}
