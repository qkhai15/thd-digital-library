import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import AdminOperationsClient from "./AdminOperationsClient";

export const dynamic = "force-dynamic";

export default async function AdminOperationsPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return <AdminOperationsClient />;
}
