export type LibraryType =
  | "sach-giay"
  | "sach-dien-tu"
  | "sach-noi"
  | "bai-giang-dien-tu"
  | "video"
  | "album"
  | "ky-nang-song"
  | "tai-lieu-khac";

export type LibraryItem = {
  id: number;
  title: string;
  author: string;
  type: LibraryType;
  category: string;
  classLevel: "10" | "11" | "12" | "Khác";
  format: string;
  cover: string;
  views: number;
  likes: number;
  description: string;
  createdAt: string;
  fileUrl?: string;
  stock?: number;
};

export const typeLabels: Record<LibraryType, string> = {
  "sach-giay": "Sách giấy",
  "sach-dien-tu": "Sách điện tử",
  "sach-noi": "Sách nói",
  "bai-giang-dien-tu": "Bài giảng điện tử",
  video: "Video",
  album: "Album ảnh",
  "ky-nang-song": "Kỹ năng sống",
  "tai-lieu-khac": "Tài liệu khác",
};

export const libraryItems: LibraryItem[] = [
  {
    id: 1,
    title: "Giáo dục quốc phòng và an ninh 11 (KNTT - SGK)",
    author: "Tổ GDQP-AN",
    type: "sach-dien-tu",
    category: "SÁCH GIÁO KHOA",
    classLevel: "11",
    format: "Sách điện tử",
    cover: "cover-blue",
    views: 5000,
    likes: 0,
    description:
      "Tài liệu phục vụ học tập môn Giáo dục quốc phòng và an ninh lớp 11.",
    createdAt: "2026-09-30",
  },
  {
    id: 2,
    title: "Lịch sử 11 (KNTT - SGK)",
    author: "Tổ Lịch sử",
    type: "sach-dien-tu",
    category: "SÁCH GIÁO KHOA",
    classLevel: "11",
    format: "Sách điện tử",
    cover: "cover-orange",
    views: 4200,
    likes: 1,
    description:
      "Sách giáo khoa Lịch sử 11 theo chương trình Kết nối tri thức.",
    createdAt: "2026-09-29",
  },
  {
    id: 3,
    title: "Tiếng Anh 12 Global Success (KNTT-SGV)",
    author: "Tổ Ngoại ngữ",
    type: "sach-dien-tu",
    category: "SÁCH NGHIỆP VỤ",
    classLevel: "12",
    format: "Sách điện tử",
    cover: "cover-purple",
    views: 3400,
    likes: 2,
    description:
      "Tài liệu giáo viên Tiếng Anh 12 Global Success phục vụ giảng dạy và học tập.",
    createdAt: "2026-09-28",
  },
  {
    id: 4,
    title: "Tôi là Bêtô",
    author: "Nguyễn Nhật Ánh",
    type: "sach-dien-tu",
    category: "SÁCH TRUYỆN",
    classLevel: "Khác",
    format: "Sách điện tử",
    cover: "cover-green",
    views: 2900,
    likes: 7,
    description:
      "Tác phẩm văn học dành cho bạn đọc yêu thích truyện và văn học.",
    createdAt: "2026-09-27",
  },
  {
    id: 5,
    title: "Ngữ văn 12, tập 1 (KNTT-SGV)",
    author: "Tổ Ngữ văn",
    type: "sach-dien-tu",
    category: "SÁCH NGHIỆP VỤ",
    classLevel: "12",
    format: "Sách điện tử",
    cover: "cover-red",
    views: 2600,
    likes: 4,
    description: "Sách giáo viên Ngữ văn 12 phục vụ công tác giảng dạy.",
    createdAt: "2026-09-26",
  },
  {
    id: 6,
    title: "Công nghệ 10 - Công nghệ Trồng trọt",
    author: "Tổ Công nghệ",
    type: "sach-dien-tu",
    category: "SÁCH GIÁO KHOA",
    classLevel: "10",
    format: "Sách điện tử",
    cover: "cover-dark",
    views: 2100,
    likes: 3,
    description: "Sách giáo khoa Công nghệ 10 - Công nghệ trồng trọt.",
    createdAt: "2026-09-25",
  },
  {
    id: 7,
    title: "Toán 12 - Chuyên đề ôn thi tốt nghiệp",
    author: "Tổ Toán",
    type: "sach-giay",
    category: "TÀI LIỆU THAM KHẢO",
    classLevel: "12",
    format: "Sách giấy",
    cover: "cover-blue",
    views: 1900,
    likes: 6,
    description:
      "Tổng hợp các chuyên đề trọng tâm phục vụ ôn thi tốt nghiệp THPT.",
    createdAt: "2026-09-24",
    stock: 5,
  },
  {
    id: 8,
    title: "4500 English Collocations and Idioms",
    author: "Tổ Ngoại ngữ",
    type: "sach-giay",
    category: "SÁCH THAM KHẢO",
    classLevel: "12",
    format: "Sách giấy",
    cover: "cover-purple",
    views: 1500,
    likes: 4,
    description: "Tài liệu tham khảo từ vựng và cụm từ tiếng Anh.",
    createdAt: "2026-09-23",
    stock: 0,
  },
  {
    id: 9,
    title: "Audio Global 1 - Student Book - Unit 15",
    author: "Tổ Ngoại ngữ",
    type: "sach-noi",
    category: "SÁCH NÓI",
    classLevel: "10",
    format: "Sách nói",
    cover: "cover-green",
    views: 1200,
    likes: 3,
    description: "Tài liệu âm thanh phục vụ luyện nghe tiếng Anh.",
    createdAt: "2026-09-22",
  },
  {
    id: 10,
    title: "Lịch sử 10 - Cách mạng công nghiệp thời cận đại",
    author: "Tổ Lịch sử",
    type: "bai-giang-dien-tu",
    category: "BÀI GIẢNG",
    classLevel: "10",
    format: "Bài giảng điện tử",
    cover: "cover-orange",
    views: 980,
    likes: 2,
    description:
      "Bài giảng điện tử môn Lịch sử 10 về cách mạng công nghiệp thời cận đại.",
    createdAt: "2026-09-21",
  },
  {
    id: 11,
    title: "Ngày sách và Văn hóa đọc Việt Nam 2026",
    author: "Thư viện nhà trường",
    type: "video",
    category: "VIDEO HOẠT ĐỘNG",
    classLevel: "Khác",
    format: "Video",
    cover: "cover-red",
    views: 870,
    likes: 5,
    description:
      "Video giới thiệu hoạt động hưởng ứng Ngày sách và Văn hóa đọc Việt Nam.",
    createdAt: "2026-09-20",
  },
  {
    id: 12,
    title: "Album hoạt động thư viện tháng 9",
    author: "Thư viện nhà trường",
    type: "album",
    category: "ALBUM",
    classLevel: "Khác",
    format: "Album ảnh",
    cover: "cover-dark",
    views: 650,
    likes: 8,
    description: "Hình ảnh các hoạt động thư viện trong tháng 9.",
    createdAt: "2026-09-19",
  },
  {
    id: 13,
    title: "Kỹ năng quản lý thời gian dành cho học sinh",
    author: "Thư viện nhà trường",
    type: "ky-nang-song",
    category: "KỸ NĂNG SỐNG",
    classLevel: "Khác",
    format: "Tài liệu",
    cover: "cover-green",
    views: 720,
    likes: 9,
    description:
      "Một số phương pháp giúp học sinh sắp xếp thời gian học tập và nghỉ ngơi hợp lý.",
    createdAt: "2026-09-18",
  },
  {
    id: 14,
    title: "Tài liệu hướng dẫn sử dụng thư viện điện tử",
    author: "Thư viện nhà trường",
    type: "tai-lieu-khac",
    category: "HƯỚNG DẪN",
    classLevel: "Khác",
    format: "Tài liệu",
    cover: "cover-blue",
    views: 520,
    likes: 1,
    description: "Hướng dẫn tra cứu và sử dụng tài liệu trên thư viện điện tử.",
    createdAt: "2026-09-17",
  },
];

export function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getItemHref(item: LibraryItem) {
  return `/tai-lieu/${item.type}/${slugify(item.title)}-${item.id}`;
}

export function getItemIdFromSlug(slug: string) {
  const match = slug.match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function isLibraryType(value: string): value is LibraryType {
  return value in typeLabels;
}
