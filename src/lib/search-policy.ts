import { ACTIVE_LIBRARY_TYPES } from "@/lib/library-types";

export const SEARCH_SORTS = ["relevance", "newest", "views", "likes", "az", "popular"] as const;
export type SearchInput = { q?: string; type?: string; classLevel?: string; grade?: string; subject?: string; topic?: string; tag?: string; page?: number; size?: number; sort?: string };
export function cleanSearchText(value: unknown, max = 120) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, max);
}
export function normalizeSearchQuery(value: unknown) {
  return cleanSearchText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}
export function searchLikePattern(value: unknown) {
  return `%${normalizeSearchQuery(value).replace(/[\\%_]/g, "\\$&")}%`;
}
export function sanitizeSearchInput(input: SearchInput): SearchInput {
  const type = cleanSearchText(input.type, 40);
  const grade = cleanSearchText(input.grade || input.classLevel, 20);
  return {
    q: cleanSearchText(input.q), type: type && ([...ACTIVE_LIBRARY_TYPES, "moi-nhat", "thinh-hanh"] as readonly string[]).includes(type) ? type : "",
    grade: ["10", "11", "12", "Khác"].includes(grade) ? grade : "",
    subject: cleanSearchText(input.subject, 120), topic: cleanSearchText(input.topic, 100), tag: cleanSearchText(input.tag, 100),
    sort: (SEARCH_SORTS as readonly string[]).includes(input.sort || "") ? input.sort : (input.q?.trim() ? "relevance" : "newest"),
    page: Number.isSafeInteger(input.page) && Number(input.page) > 0 ? Math.min(Number(input.page), 1000000) : 1,
    size: Number.isSafeInteger(input.size) && Number(input.size) > 0 ? Math.min(Number(input.size), 100) : 24,
  };
}
export function searchInputFromParams(params: URLSearchParams): SearchInput {
  return sanitizeSearchInput({ q: params.get("q") || "", type: params.get("type") || "", subject: params.get("subject") || "", grade: params.get("grade") || params.get("class_level") || "", topic: params.get("topic") || "", tag: params.get("tag") || "", sort: params.get("sort") || "", page: Number(params.get("page")), size: Number(params.get("limit")) });
}
export function searchHref(input: SearchInput, page = 1) {
  const safe = sanitizeSearchInput(input);
  const params = new URLSearchParams();
  for (const name of ["q", "type", "subject", "grade", "topic", "tag", "sort"] as const) if (safe[name]) params.set(name, String(safe[name]));
  if (page > 1) params.set("page", String(page));
  return `/tim-kiem${params.size ? `?${params}` : ""}`;
}
