import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import AdminNewsClient from "./AdminNewsClient";

export const dynamic = "force-dynamic";

export default async function AdminNewsPage() {
  if (!(await isAdmin())) {
    redirect("/admin/login");
  }

  return <AdminNewsClient />;
}
