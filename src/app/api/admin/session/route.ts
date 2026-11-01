import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";

export async function GET() {
  try {
  const session = await getAdminSession();
  return NextResponse.json({
    authenticated: Boolean(session),
    username: session?.username ?? null,
    expires_at: session?.expires_at ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("ADMIN_SESSION_FAILED");
    return NextResponse.json({authenticated:false,message:"Không thể kiểm tra phiên đăng nhập lúc này."},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
