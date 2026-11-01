import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getAdminDashboard } from "@/lib/admin-insights";
import { logBackendError } from "@/lib/backend-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  try {
    const days = Number(new URL(request.url).searchParams.get("days") || 30);
    return NextResponse.json(await getAdminDashboard(days), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logBackendError("ADMIN DASHBOARD", error);
    return NextResponse.json({ message: "Không thể tải thống kê. Vui lòng thử lại." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
