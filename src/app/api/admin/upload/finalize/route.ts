import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { sameOriginAllowed } from "@/lib/backend-utils";
import { directUploadJson, finalizeDirectUpload } from "@/lib/direct-upload";
import { UploadValidationError } from "@/lib/upload-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  if (!sameOriginAllowed(request)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  try {
    const body = await directUploadJson(request);
    return NextResponse.json(await finalizeDirectUpload(body.id, session), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UploadValidationError) return NextResponse.json({ message: error.message }, { status: error.status });
    return NextResponse.json({ message: "Không thể hoàn tất upload. Vui lòng thử lại sau." }, { status: 503 });
  }
}
