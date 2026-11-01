import type { DashboardStats, LibraryType } from "@/lib/library-types";

export type DashboardItemSummary = {
  id: number;
  title: string;
  type: LibraryType;
  status: string;
  views: number;
  created_at: string;
};

export type AdminStorageUsage = {
  status: "normal" | "warning" | "critical" | "unavailable";
  used_bytes: number | null;
  limit_bytes: number | null;
  object_count: number | null;
  measured_at: string;
};

export type AdminInsights = {
  generated_at: string;
  days: number;
  by_type: { type: string; count: number }[];
  recent_views: number;
  top_items: DashboardItemSummary[];
  new_items: DashboardItemSummary[];
  circulation: {
    pending: number;
    approved: number;
    ready_for_pickup: number;
    borrowed: number;
    overdue: number;
    returned: number;
  };
  searches: {
    topQueries: { query: string; normalized_query: string; count: number }[];
    zeroResults: { query: string; normalized_query: string; count: number }[];
    trend: { day: string; count: number; zero_results: number }[];
  };
  storage: AdminStorageUsage;
  health: { database: "connected"; checked_at: string };
};

export type AdminDashboard = DashboardStats & { insights: AdminInsights };
