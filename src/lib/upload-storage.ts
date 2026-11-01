import "server-only";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { detectedFileMime } from "@/lib/file-signature";
import { getUploadMaxBytes, MIB, UPLOAD_TYPE_MAX_BYTES } from "../../scripts/upload-policy.mjs";
import { storageCapacityAvailable, storageFullMessage } from "@/lib/storage-capacity";

export const uploadRules: Record<string, { folder: string; max: number; mime: Record<string, string> }> = {
  cover: { folder: "covers", max: UPLOAD_TYPE_MAX_BYTES.cover, mime: { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" } },
  gallery: { folder: "gallery", max: UPLOAD_TYPE_MAX_BYTES.gallery, mime: { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" } },
  banner: { folder: "banners", max: UPLOAD_TYPE_MAX_BYTES.banner, mime: { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" } },
  document: { folder: "documents", max: UPLOAD_TYPE_MAX_BYTES.document, mime: { "application/pdf": ".pdf" } },
  audio: { folder: "audio", max: UPLOAD_TYPE_MAX_BYTES.audio, mime: { "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/ogg": ".ogg", "audio/mp4": ".m4a" } },
  video: { folder: "videos", max: UPLOAD_TYPE_MAX_BYTES.video, mime: { "video/mp4": ".mp4", "video/webm": ".webm" } },
};

export class UploadValidationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function storageDriver() {
  const driver = process.env.STORAGE_DRIVER || (process.env.NODE_ENV === "production" ? "supabase" : "local");
  if (driver !== "local" && driver !== "supabase") throw new Error("STORAGE_DRIVER không hợp lệ.");
  return driver;
}

function storageConfig() {
  const raw = process.env.SUPABASE_URL;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!raw || !bucket || !/^[a-zA-Z0-9_-]+$/.test(bucket)) throw new Error("Thiếu cấu hình Supabase Storage.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SUPABASE_URL phải là HTTPS origin.");
  return { url: url.origin, bucket };
}

export function validStorageKey(key: string) {
  return key.length > 0 && key.length <= 1000 && key.split("/").every(part => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== "..");
}

// No privileged credentials are needed to resolve a public object URL.
export function storagePublicUrl(key: string) {
  if (!validStorageKey(key)) throw new Error("Object key không hợp lệ.");
  const config = storageConfig();
  return `${config.url}/storage/v1/object/public/${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

interface UploadTarget {
  put(key: string, file: File, mime: string): Promise<string>;
}

const localStorage: UploadTarget = {
  async put(key, file) {
    const target = path.join(process.cwd(), "public", "uploads", key);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await pipeline(Readable.fromWeb(file.stream() as NodeReadableStream), createWriteStream(target, { flags: "wx" }));
    } catch (error) {
      // Only a partial file owned by this upload may be removed; never an existing file.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") await unlink(target).catch(() => undefined);
      throw error;
    }
    return `/uploads/${key}`;
  },
};

const supabaseStorage: UploadTarget = {
  async put(key, file, mime) {
    const config = storageConfig();
    const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error("Thiếu khóa Supabase Storage phía server.");
    const client = createClient(config.url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { error } = await client.storage.from(config.bucket).upload(key, file.stream(), {
      contentType: mime, cacheControl: "31536000", upsert: false, duplex: "half",
    });
    // Do not log SDK errors: request metadata can include privileged credentials.
    if (error) {
      const failure = error as { status?: number; statusCode?: string };
      if (failure.status === 413 || failure.statusCode === "413") {
        throw new UploadValidationError("File vượt giới hạn dung lượng của Supabase Storage. Chọn file nhỏ hơn hoặc kiểm tra giới hạn project/bucket.", 413);
      }
      throw new Error("Không thể ghi Supabase Storage.");
    }
    return `/uploads/supabase/${key}`;
  },
};

export async function storeUpload(file: File, kind: string) {
  const rule = Object.hasOwn(uploadRules, kind) ? uploadRules[kind] : undefined;
  if (!rule) throw new UploadValidationError("Loại upload không hợp lệ.");
  const driver = storageDriver();
  const max = getUploadMaxBytes(kind, { driver, env: process.env });
  if (file.size <= 0 || file.size > max) throw new UploadValidationError(`File vượt quá giới hạn ${max / MIB} MiB. Hãy giảm dung lượng file hoặc nén video.`, 413);
  const detected = detectedFileMime(Buffer.from(await file.slice(0, 64).arrayBuffer()));
  const mime = kind === "audio" && detected === "video/mp4" ? "audio/mp4" : detected;
  const ext = mime ? rule.mime[mime] : null;
  if (!ext || !mime) throw new UploadValidationError("Định dạng file không được hỗ trợ.", 415);
  const allowedExtensions: Record<string, string[]> = {
    "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"],
    "application/pdf": [".pdf"], "audio/mpeg": [".mp3"], "audio/wav": [".wav"],
    "audio/ogg": [".ogg", ".oga"], "audio/mp4": [".m4a"],
    "video/mp4": [".mp4"], "video/webm": [".webm"],
  };
  if (!allowedExtensions[mime].includes(path.extname(file.name).toLowerCase())) {
    throw new UploadValidationError("Phần mở rộng không khớp nội dung file.", 415);
  }
  const aliases: Record<string, string> = { "image/jpg": "image/jpeg", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/x-m4a": "audio/mp4", "audio/mp3": "audio/mpeg" };
  const claimed = file.type.toLowerCase();
  if (claimed && claimed !== "application/octet-stream" && (aliases[claimed] || claimed) !== mime) {
    throw new UploadValidationError("MIME type không khớp nội dung file.", 415);
  }
  const now = new Date();
  const fileName = `${randomUUID()}${ext}`;
  const key = `${rule.folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${fileName}`;
  if (driver === "supabase" && !(await storageCapacityAvailable(file.size))) throw new UploadValidationError(storageFullMessage, 507);
  const url = await (driver === "supabase" ? supabaseStorage : localStorage).put(key, file, mime);
  return { url, fileName, size: file.size, mime, driver };
}
