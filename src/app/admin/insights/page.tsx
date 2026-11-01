import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import AdminInsightsClient from "./AdminInsightsClient";
import "./insights.css";

export const dynamic = "force-dynamic";

export default async function AdminInsightsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return <AdminInsightsClient />;
}
