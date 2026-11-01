import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { adminList } from "@/lib/admin-pagination";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  return adminList(request, "library_comments c JOIN library_items i ON i.id=c.item_id", "c", "c.created_at DESC,c.id DESC", 300, 300);
}
