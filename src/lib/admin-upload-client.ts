"use client";

import { Upload, isSupported } from "tus-js-client";
import type { LibraryType } from "@/lib/library-types";
import { DIRECT_UPLOAD_THRESHOLD_BYTES } from "../../scripts/upload-policy.mjs";

export const DIRECT_UPLOAD_THRESHOLD = DIRECT_UPLOAD_THRESHOLD_BYTES;
export type AdminUploadKind = "cover" | "gallery" | "document" | "audio" | "video" | "banner";
export type AdminUploadLimits = {
  driver: "local" | "supabase";
  maxBytes: Record<AdminUploadKind, number>;
  thresholdBytes: number;
};
export type AdminUploadProgress = {
  phase: "uploading" | "signing" | "retrying" | "resuming" | "finalizing";
  percent?: number;
  direct?: boolean;
};
type UploadOptions = {
  documentType?: LibraryType;
  signal?: AbortSignal;
  onProgress?: (progress: AdminUploadProgress) => void;
  onLimits?: (limits: AdminUploadLimits) => void;
};
type SignedIntent = {
  id: string;
  completed?: boolean;
  uploaded?: boolean;
  token?: string;
  endpoint?: string;
  bucket?: string;
  path?: string;
  expiresAt?: string;
  size?: number;
  mime?: string;
};
type PreviousUpload = Awaited<ReturnType<Upload["findPreviousUploads"]>>[number];
type TusUrlStorage = NonNullable<ConstructorParameters<typeof Upload>[1]["urlStorage"]>;

const memoryStorage = new Map<string, string>();
const storage = {
  get(key: string) {
    try { return window.sessionStorage.getItem(key) ?? memoryStorage.get(key) ?? null; }
    catch { return memoryStorage.get(key) ?? null; }
  },
  set(key: string, value: string) {
    memoryStorage.set(key, value);
    try { window.sessionStorage.setItem(key, value); } catch { /* This tab can still retry in memory. */ }
  },
  remove(key: string) {
    memoryStorage.delete(key);
    try { window.sessionStorage.removeItem(key); } catch { /* Storage can be disabled in private mode. */ }
  },
};

export function usesDirectUpload(file: Pick<File, "size">, kind: AdminUploadKind, thresholdBytes = DIRECT_UPLOAD_THRESHOLD) {
  return ["document", "audio", "video"].includes(kind) && file.size > thresholdBytes;
}

export async function loadAdminUploadLimits(signal?: AbortSignal): Promise<AdminUploadLimits> {
  const data = await responseData(await fetch("/api/admin/upload/limits", { cache: "no-store", signal }));
  const kinds: AdminUploadKind[] = ["cover", "gallery", "document", "audio", "video", "banner"];
  if (!["local", "supabase"].includes(data.driver) || !Number.isSafeInteger(data.thresholdBytes) || data.thresholdBytes <= 0
    || kinds.some(kind => !Number.isSafeInteger(data.maxBytes?.[kind]) || data.maxBytes[kind] <= 0)) {
    throw new Error("Không thể xác định giới hạn upload. Vui lòng thử lại.");
  }
  return { driver: data.driver, thresholdBytes: data.thresholdBytes,
    maxBytes: Object.fromEntries(kinds.map(kind => [kind, data.maxBytes[kind]])) as Record<AdminUploadKind, number> };
}

export function uploadLimitLabel(bytes: number) {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(bytes / 1024 / 1024)} MiB`;
}

function abortError() { return new DOMException("Đã tạm dừng tải. Chọn lại cùng file để tiếp tục.", "AbortError"); }

async function responseData(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Upload thất bại. Vui lòng thử lại.") as Error & { status: number; code?: string };
    error.status = response.status;
    if (typeof data.code === "string") error.code = data.code;
    throw error;
  }
  return data;
}

// Only sample the ends of a file; never read a large file into application memory.
// This identifies a retry, while server ownership and final validation authorize it.
async function fileFingerprint(file: File, kind: string, documentType: string) {
  const sampleSize = 64 * 1024;
  const parts = [new TextEncoder().encode(JSON.stringify([file.name, file.size, file.lastModified, file.type, kind, documentType])),
    new Uint8Array(await file.slice(0, sampleSize).arrayBuffer()),
    new Uint8Array(await file.slice(Math.max(sampleSize, file.size - sampleSize)).arrayBuffer())];
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  if (globalThis.crypto?.subtle) {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", joined);
    return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
  }
  // Non-secure LAN origins may not expose SubtleCrypto. This is only a local retry key.
  let first = 2166136261, second = 5381;
  for (const value of joined) { first = Math.imul(first ^ value, 16777619); second = Math.imul(second, 33) ^ value; }
  return `${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}-${file.size}`;
}

function resumeUrlStorage(intent: SignedIntent): TusUrlStorage {
  const fingerprint = `thd-upload:${intent.id}`;
  const key = `thd:tus:${intent.id}`;
  return {
    async findAllUploads() { return []; },
    async findUploadsByFingerprint(value) {
      if (value !== fingerprint) return [];
      try {
        const saved = JSON.parse(storage.get(key) || "null") as PreviousUpload | null;
        if (!saved?.uploadUrl || !intent.endpoint) return [];
        // This uploader never uses parallel TUS resources. A tampered secondary URL
        // must not receive the signature even when the primary resource is valid.
        if (saved.parallelUploadUrls != null) return [];
        // Never send the short-lived signature to a stored URL outside this Storage endpoint.
        if (!saved.uploadUrl.startsWith(`${intent.endpoint}/`)) return [];
        if (saved.metadata?.bucketName !== intent.bucket || saved.metadata?.objectName !== intent.path || saved.size !== intent.size) return [];
        return [{ ...saved, parallelUploadUrls: null, urlStorageKey: key }];
      } catch { return []; }
    },
    async removeUpload(value) { if (value === key) storage.remove(key); },
    async addUpload(value, upload) {
      if (value !== fingerprint) throw new Error("Không thể lưu thông tin tiếp tục tải.");
      storage.set(key, JSON.stringify({ ...upload, urlStorageKey: key }));
      return key;
    },
  };
}

async function transfer(file: File, intent: SignedIntent, options: UploadOptions) {
  if (!isSupported) throw new Error("Trình duyệt chưa hỗ trợ tải file lớn. Vui lòng dùng trình duyệt mới.");
  if (!intent.token || !intent.endpoint || !intent.bucket || !intent.path || !intent.mime || intent.size !== file.size) {
    throw new Error("Thông tin cấp quyền upload không hợp lệ.");
  }
  const endpoint = new URL(intent.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.pathname !== "/storage/v1/upload/resumable/sign" || endpoint.search || endpoint.hash) {
    throw new Error("Địa chỉ Storage không hợp lệ.");
  }
  if (options.signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", pause);
      if (error) reject(error); else resolve();
    };
    const upload = new Upload(file, {
      endpoint: intent.endpoint,
      chunkSize: DIRECT_UPLOAD_THRESHOLD,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: true,
      urlStorage: resumeUrlStorage(intent),
      fingerprint: async () => `thd-upload:${intent.id}`,
      headers: { "x-signature": intent.token!, "x-upsert": "false" },
      metadata: { bucketName: intent.bucket!, objectName: intent.path!, contentType: intent.mime!, cacheControl: "31536000" },
      onProgress(sent, total) { options.onProgress?.({ phase: "uploading", percent: Math.min(100, Math.round(sent / total * 100)) }); },
      onShouldRetry(error) {
        const status = error.originalResponse?.getStatus() || 0;
        const retry = status === 409 || status === 423 || status === 0 || status >= 500;
        if (retry) options.onProgress?.({ phase: "retrying" });
        return retry && (typeof navigator === "undefined" || navigator.onLine !== false);
      },
      onError(error) {
        // TUS error strings contain signed request URLs. Do not expose those strings in UI/logs.
        const status = "originalResponse" in error ? error.originalResponse?.getStatus() : 0;
        finish(new Error(status === 413
          ? "File vượt giới hạn Supabase Storage. Kiểm tra giới hạn project/bucket."
          : "Tải trực tiếp bị gián đoạn. Chọn lại cùng file để tiếp tục; bạn có thể cần đăng nhập lại."));
      },
      onSuccess() { finish(); },
    });
    const pause = () => { void upload.abort(false).catch(() => undefined); finish(abortError()); };
    options.signal?.addEventListener("abort", pause, { once: true });
    void upload.findPreviousUploads().then(previous => {
      if (settled) return;
      if (previous[0]) { upload.resumeFromPreviousUpload(previous[0]); options.onProgress?.({ phase: "resuming" }); }
      upload.start();
    }).catch(() => finish(new Error("Không thể khởi tạo tải trực tiếp. Chọn lại file để thử lại.")));
  });
}

export async function uploadAdminFile(file: File, kind: AdminUploadKind, options: UploadOptions = {}): Promise<string> {
  // Fetch the server policy before sampling bytes, creating an intent, or invoking TUS.
  // It includes the currently configured Storage/bucket cap, and can change without a browser rebuild.
  const limits = await loadAdminUploadLimits(options.signal);
  options.onLimits?.(limits);
  if (file.size > limits.maxBytes[kind]) {
    const advice = limits.driver === "supabase" && ["document", "audio", "video"].includes(kind)
      ? `${kind === "video" ? "Hãy nén video" : "Hãy giảm dung lượng file"} hoặc nâng cấp gói Supabase Storage.`
      : "Vui lòng giảm dung lượng file.";
    throw new Error(`File vượt giới hạn ${uploadLimitLabel(limits.maxBytes[kind])}. ${advice}`);
  }
  if (!usesDirectUpload(file, kind, limits.thresholdBytes)) {
    return multipartUpload(file, kind, options);
  }
  const documentType = options.documentType || (kind === "video" ? "video" : kind === "audio" ? "sach-noi" : "sach-dien-tu");
  const key = `thd:intent:${await fileFingerprint(file, kind, documentType)}`;
  let resumeId: string | undefined;
  try {
    const saved = JSON.parse(storage.get(key) || "null");
    if (saved?.id && Date.parse(saved.expiresAt) > Date.now()) resumeId = saved.id;
  } catch { storage.remove(key); }
  options.onProgress?.({ phase: "signing" });
  const sign = async (id?: string) => responseData(await fetch("/api/admin/upload/sign", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: options.signal,
    body: JSON.stringify({ kind, fileName: file.name, mime: file.type || "application/octet-stream", size: file.size, documentType, ...(id ? { resumeId: id } : {}) }),
  })) as Promise<SignedIntent>;
  let intent: SignedIntent;
  try { intent = await sign(resumeId); }
  catch (error) {
    const failure = error as Error & { status?: number; code?: string };
    // Only an authenticated local-provider response enables the legacy path.
    // Cloud failures and size limits must never send a large file through Railway.
    if (failure.status === 409 && failure.code === "DIRECT_UPLOAD_UNAVAILABLE_LOCAL") {
      const url = await multipartUpload(file, kind, options);
      storage.remove(key);
      if (resumeId) storage.remove(`thd:tus:${resumeId}`);
      return url;
    }
    if (!resumeId || ![404, 410].includes((error as Error & { status?: number }).status || 0)) throw error;
    storage.remove(key);
    intent = await sign();
  }
  if (!intent.id) throw new Error("Thiếu thông tin upload.");
  storage.set(key, JSON.stringify({ id: intent.id, expiresAt: intent.expiresAt }));
  if (!intent.completed && !intent.uploaded) await transfer(file, intent, options);
  options.onProgress?.({ phase: "finalizing" });
  const result = await responseData(await fetch("/api/admin/upload/finalize", {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: options.signal, body: JSON.stringify({ id: intent.id }),
  }));
  storage.remove(key);
  storage.remove(`thd:tus:${intent.id}`);
  return result.url;
}

async function multipartUpload(file: File, kind: AdminUploadKind, options: UploadOptions) {
  const data = new FormData();
  data.append("file", file);
  data.append("kind", kind);
  options.onProgress?.({ phase: "uploading", direct: false });
  const response = await fetch("/api/admin/upload", { method: "POST", body: data, signal: options.signal });
  return (await responseData(response)).url as string;
}
