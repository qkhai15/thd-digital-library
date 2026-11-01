import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { sameOriginAllowed } from "@/lib/backend-utils";
import { directUploadJson, signDirectUpload } from "@/lib/direct-upload";
import { storageDriver, UploadValidationError } from "@/lib/upload-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  if (!sameOriginAllowed(request)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  try {
    // Explicitly preserve the existing local provider in development. Clients
    // may only fall back for this code, never for a cloud signing failure.
    if (storageDriver() === "local") return NextResponse.json({
      code: "DIRECT_UPLOAD_UNAVAILABLE_LOCAL",
      message: "Storage local sử dụng upload qua server.",
    }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const result = await signDirectUpload(await directUploadJson(request), session);
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UploadValidationError) return NextResponse.json({ message: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ message: "Không thể cấp quyền upload. Vui lòng thử lại sau." }, { status: 503 });
  }
}
