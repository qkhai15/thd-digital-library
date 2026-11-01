export const LIBRARY_TYPES = [
  "sach-giay",
  "sach-dien-tu",
  "sach-noi",
  "bai-giang-dien-tu",
  "video",
  "album",
  "ky-nang-song",
  "tai-lieu-khac",
] as const;

export type LibraryType = (typeof LIBRARY_TYPES)[number];
export const PUBLICATION_STATUSES = ["draft", "review", "published", "archived"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const ACTIVE_LIBRARY_TYPES: readonly LibraryType[] = LIBRARY_TYPES.filter(
  (type) => type !== "bai-giang-dien-tu" && type !== "ky-nang-song"
);
export function isBookSectionType(type: string) {
  return ["sach-giay", "sach-dien-tu", "sach-noi", "tai-lieu-khac"].includes(type);
}

export const TYPE_LABELS: Record<LibraryType, string> = {
  "sach-giay": "Sách giấy",
  "sach-dien-tu": "Sách điện tử",
  "sach-noi": "Sách nói",
  "bai-giang-dien-tu": "Bài giảng điện tử",
  video: "Video",
  album: "Album ảnh",
  "ky-nang-song": "Kỹ năng sống",
  "tai-lieu-khac": "Tài liệu khác",
};

export type LibraryItem = {
  id: number;
  title: string;
  author: string;
  type: LibraryType;
  category: string;
  class_level: string;
  format: string;
  cover_url: string | null;
  file_url: string | null;
  gallery_urls: string[];
  description: string;
  publisher?: string | null;
  publication_year?: number | null;
  isbn?: string | null;
  language?: string | null;
  page_count?: number | null;
  subject_id?: number | null;
  subject_name?: string | null;
  subject_slug?: string | null;
  topics?: string[];
  tags?: string[];
  source?: string | null;
  rights?: string | null;
  stock: number | null;
  views: number;
  likes: number;
  is_featured: boolean;
  status?: PublicationStatus | string;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type LibrarySubject = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
};

export type LibraryCollection = {
  id: number;
  title: string;
  slug: string;
  description: string;
  cover_url: string | null;
  status: PublicationStatus;
  sort_order: number;
  is_featured: boolean;
  item_count?: number;
  item_ids?: number[];
  created_at: string;
  updated_at: string;
};

export type CommentItem = {
  id: number;
  item_id: number;
  name: string;
  content: string;
  status?: string;
  created_at: string;
};

export type BorrowRequest = {
  id: number;
  item_id: number;
  borrower_name: string;
  class_name: string;
  phone: string;
  email: string;
  note: string;
  status: string;
  request_code?: string;
  requested_at?: string;
  approved_at?: string | null;
  ready_at?: string | null;
  borrowed_at?: string | null;
  due_at?: string | null;
  returned_at?: string | null;
  rejected_at?: string | null;
  cancelled_at?: string | null;
  is_overdue?: boolean;
  timeline?: { id: number; from_status: string | null; to_status: string; actor: string; created_at: string }[];
  created_at: string;
  updated_at: string;
};

export type WallBanner = {
  id: number;
  title: string;
  image_url: string;
  link_url: string | null;
  is_active: boolean;
  sort_order: number;
};


export type NewsPost = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_url: string | null;
  status: "draft" | "published" | "archived" | string;
  is_featured: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DashboardStats = {
  items: {
    total: number;
    published: number;
  };
  comments: {
    total: number;
    pending: number;
  };
  borrows: {
    total: number;
    pending: number;
  };
  views: number;
  news: {
    total: number;
    published: number;
  };
  banners: {
    total: number;
    active: number;
  };
};
