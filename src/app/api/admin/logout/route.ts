import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, clearAdminCookie, deleteAdminSessionToken } from "@/lib/admin-auth";
import { requestOrigin, sameOriginAllowed } from "@/lib/backend-utils";

export async function POST(request: NextRequest) {
  if (!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403, headers:{"Cache-Control":"no-store"}});
  try {
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  await deleteAdminSessionToken(token);

  const origin = requestOrigin(request);
  const response = NextResponse.redirect(new URL("/admin/login", origin), 303);
  response.headers.set("Cache-Control", "no-store");
  clearAdminCookie(response, origin);
  return response;
  } catch {
    console.error("ADMIN_LOGOUT_FAILED");
    return NextResponse.json({message:"Không thể đăng xuất lúc này. Vui lòng thử lại."},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
