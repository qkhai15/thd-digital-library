import { NextResponse } from "next/server";
import { auditLog, isAdmin } from "@/lib/admin-auth";
import { sameOriginAllowed } from "@/lib/backend-utils";
import { storeUpload, storageDriver, UploadValidationError } from "@/lib/upload-storage";
import { readLimitedFormData, RequestBodyTooLargeError } from "@/lib/request-body";
import { MULTIPART_BODY_MAX_BYTES, UPLOAD_TYPE_MAX_BYTES, MIB } from "../../../../../scripts/upload-policy.mjs";

export const runtime = "nodejs";
let activeUploads = 0;

export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  if (!sameOriginAllowed(request)) return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  const limit = Number(process.env.UPLOAD_MAX_CONCURRENT || 2);
  if (activeUploads >= limit) return NextResponse.json({ message: "Đang có file được tải lên. Vui lòng thử lại sau." }, { status: 429, headers: { "Retry-After": "5" } });
  activeUploads += 1;
  try { return await receiveUpload(request); }
  finally { activeUploads -= 1; }
}

async function receiveUpload(request: Request) {
  let form: FormData;
  // Cloud media uses signed direct upload; this compatibility endpoint is bounded.
  // Local development retains its existing local-file upload behavior.
  const maxBody = storageDriver() === "supabase" ? MULTIPART_BODY_MAX_BYTES : UPLOAD_TYPE_MAX_BYTES.video + MIB;
  try { form = await readLimitedFormData(request, maxBody); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({message:"File lớn cần tải trực tiếp bằng signed upload."},{status:413});
    return NextResponse.json({message:"Dữ liệu upload không hợp lệ."},{status:400});
  }
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "document");
  if (!(file instanceof File)) return NextResponse.json({ message: "Không tìm thấy file." }, { status: 400 });
  try {
    const stored = await storeUpload(file, kind);
    await auditLog("upload", "file", stored.fileName, { kind, ...stored });
    return NextResponse.json(stored, { status: 201 });
  } catch (error) {
    if (error instanceof UploadValidationError) return NextResponse.json({ message: error.message }, { status: error.status });
    console.error("UPLOAD FAILED: storage unavailable");
    return NextResponse.json({ message: "Không thể lưu file. Kiểm tra cấu hình storage hoặc thử lại." }, { status: 503 });
  }
}
