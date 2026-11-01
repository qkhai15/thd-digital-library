import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { adminList } from "@/lib/admin-pagination";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  return adminList(request, "audit_logs", "audit", "created_at DESC,id DESC", 100, 300);
}
