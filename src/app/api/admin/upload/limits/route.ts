import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { getAdminUploadLimits } from "@/lib/direct-upload";
import { UploadValidationError } from "@/lib/upload-storage";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getAdminSession())) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    return NextResponse.json(await getAdminUploadLimits(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UploadValidationError) return NextResponse.json({ message: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ message: "Không thể đọc giới hạn upload. Kiểm tra cấu hình Storage." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
