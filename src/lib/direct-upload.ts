import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { db, ensureSchema } from "@/lib/db";
import { detectedFileMime } from "@/lib/file-signature";
import { uploadRules, UploadValidationError, validStorageKey, storageDriver } from "@/lib/upload-storage";
import { DIRECT_UPLOAD_THRESHOLD_BYTES, getUploadMaxBytes, MIB, UPLOAD_METADATA_MAX_BYTES, UPLOAD_TYPE_MAX_BYTES } from "../../scripts/upload-policy.mjs";
import { storageCapacityAvailable, storageFullMessage } from "@/lib/storage-capacity";

const JSON_LIMIT = UPLOAD_METADATA_MAX_BYTES;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const typeRules: Record<string, string[]> = { document: ["sach-dien-tu", "tai-lieu-khac"], audio: ["sach-noi"], video: ["video"] };
const aliases: Record<string, string> = { "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/x-m4a": "audio/mp4", "audio/mp3": "audio/mpeg" };
const extensions: Record<string, string[]> = { "application/pdf": [".pdf"], "audio/mpeg": [".mp3"], "audio/wav": [".wav"], "audio/ogg": [".ogg", ".oga"], "audio/mp4": [".m4a"], "video/mp4": [".mp4"], "video/webm": [".webm"] };

export interface UploadOwner { token_hash: string; username: string }
interface UploadIntent {
  id: string; owner_token_hash: string; username: string; kind: string;
  document_type: string; original_name: string; expected_size: string | number; expected_mime: string;
  source_bucket: string; source_key: string; destination_bucket: string; destination_key: string;
  status: "pending" | "completed" | "rejected"; expires_at: Date; result: UploadResult | null;
}
export interface UploadResult { url: string; fileName: string; size: number; mime: string; driver: "supabase" }

export function validateDirectUpload(input: Record<string, unknown>) {
  const kind = typeof input.kind === "string" ? input.kind : "";
  const documentType = typeof input.documentType === "string" ? input.documentType : "";
  if (!Object.hasOwn(typeRules, kind) || !typeRules[kind].includes(documentType)) throw new UploadValidationError("Loại tài liệu không phù hợp với file upload.", 400);
  const fileName = typeof input.fileName === "string" ? input.fileName : "";
  if (!fileName || fileName.length > 255 || /[\x00-\x1f\x7f/\\]/.test(fileName) || fileName !== fileName.trim()) throw new UploadValidationError("Tên file không hợp lệ.", 400);
  const size = input.size;
  const max = getUploadMaxBytes(kind, { driver: "supabase", env: process.env });
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > max) throw uploadSizeError(max);
  const claimed = typeof input.mime === "string" ? input.mime.toLowerCase().trim() : "";
  const inferred = Object.keys(uploadRules[kind].mime).find(candidate => extensions[candidate]?.includes(path.extname(fileName).toLowerCase()));
  const mime = !claimed || claimed === "application/octet-stream" ? inferred || "" : aliases[claimed] || claimed;
  const extension = uploadRules[kind].mime[mime];
  if (!extension || !extensions[mime]?.includes(path.extname(fileName).toLowerCase())) throw new UploadValidationError("MIME type hoặc phần mở rộng không được hỗ trợ.", 415);
  if (input.resumeId !== undefined && (typeof input.resumeId !== "string" || !UUID.test(input.resumeId))) throw new UploadValidationError("Mã upload không hợp lệ.", 400);
  return { kind, documentType, fileName, size, mime, extension, resumeId: input.resumeId as string | undefined };
}

// These endpoints receive metadata only. Limit actual stream bytes, including
// chunked requests with absent or misleading Content-Length.
export async function directUploadJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new UploadValidationError("Yêu cầu phải dùng application/json.", 415);
  if (Number(request.headers.get("content-length")) > JSON_LIMIT) {
    await request.body?.cancel().catch(() => undefined);
    throw new UploadValidationError("Metadata upload quá lớn.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new UploadValidationError("Metadata upload không hợp lệ.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > JSON_LIMIT) throw new UploadValidationError("Metadata upload quá lớn.", 413);
      chunks.push(chunk.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid metadata");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof UploadValidationError) throw error;
    throw new UploadValidationError("Metadata upload không hợp lệ.", 400);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function config() {
  if (process.env.STORAGE_DRIVER === "local") throw new UploadValidationError("Upload trực tiếp cần Supabase Storage.", 503);
  const url = new URL(process.env.SUPABASE_URL || "https://invalid.invalid");
  const destinationBucket = process.env.SUPABASE_STORAGE_BUCKET || "";
  const sourceBucket = process.env.SUPABASE_UPLOAD_BUCKET || "thd-library-quarantine";
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || url.hostname === "invalid.invalid" || url.protocol !== "https:" || url.origin + "/" !== url.href || !/^[a-zA-Z0-9_-]+$/.test(destinationBucket) || !/^[a-zA-Z0-9_-]+$/.test(sourceBucket) || destinationBucket === sourceBucket) throw new UploadValidationError("Thiếu cấu hình upload trực tiếp an toàn.", 503);
  const client = createClient(url.origin, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Metadata and server-side copies must not hold a DB row lock forever if
    // Storage stalls. A timed-out copy remains retryable at its immutable key.
    global: { fetch: (input, init) => fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    }) },
  });
  // Supabase's dedicated Storage host improves resumable upload performance.
  const endpointOrigin = /^[-a-z0-9]+\.supabase\.co$/.test(url.hostname) ? `https://${url.hostname.replace(".supabase.co", ".storage.supabase.co")}` : url.origin;
  // Scoped upload tokens require the signed TUS route. The ordinary resumable
  // route validates Supabase Auth JWTs and rejects these capability tokens.
  return { client, origin: url.origin, endpoint: `${endpointOrigin}/storage/v1/upload/resumable/sign`, sourceBucket, destinationBucket };
}

function assertOwnedIntent(intent: UploadIntent | undefined, owner: UploadOwner) {
  if (!intent || intent.owner_token_hash !== owner.token_hash) throw new UploadValidationError("Không tìm thấy upload của phiên đăng nhập này.", 404);
  if (intent.status === "rejected") throw new UploadValidationError("File upload đã bị từ chối. Hãy chọn lại file hợp lệ.", 415);
  if (intent.status !== "completed" && new Date(intent.expires_at).getTime() <= Date.now()) throw new UploadValidationError("Quyền upload đã hết hạn. Hãy bắt đầu lại.", 410);
  if (!validStorageKey(intent.source_key) || !validStorageKey(intent.destination_key)) throw new UploadValidationError("Path upload không hợp lệ.", 400);
  return intent;
}

function uploadSizeError(max: number) {
  return new UploadValidationError(`File vượt giới hạn ${max / MIB} MiB. Hãy nén video hoặc giảm dung lượng file; file lớn hơn cần nâng gói Storage.`, 413);
}

async function bucketLimits(storage: ReturnType<typeof config>) {
  const bucket = await storage.client.storage.getBucket(storage.sourceBucket);
  if (bucket.error || !bucket.data || bucket.data.public !== false) throw new UploadValidationError("Bucket tạm phải tồn tại và ở chế độ private.", 503);
  const destination = await storage.client.storage.getBucket(storage.destinationBucket);
  if (destination.error || !destination.data || destination.data.public !== true) throw new UploadValidationError("Bucket tài liệu phải tồn tại và ở chế độ public.", 503);
  return [bucket.data.file_size_limit, destination.data.file_size_limit];
}

// Safe client metadata only; never return bucket credentials or session hashes.
export async function getAdminUploadLimits() {
  const driver = storageDriver();
  const limits = driver === "supabase" ? await bucketLimits(config()) : [];
  const maxBytes = Object.fromEntries(Object.keys(UPLOAD_TYPE_MAX_BYTES).map(kind => [kind, getUploadMaxBytes(kind, { driver, env: process.env, bucketLimits: limits })]));
  return { driver, maxBytes, thresholdBytes: DIRECT_UPLOAD_THRESHOLD_BYTES };
}

export async function signDirectUpload(input: Record<string, unknown>, owner: UploadOwner) {
  const metadata = validateDirectUpload(input);
  const storage = config();
  const maximum = getUploadMaxBytes(metadata.kind, { driver: "supabase", env: process.env, bucketLimits: await bucketLimits(storage) });
  if (metadata.size > maximum) throw uploadSizeError(maximum);
  await ensureSchema();
  const connection = await db.connect();
  let intent: UploadIntent;
  try {
    await connection.query("BEGIN");
    // Serialize quota checks across concurrent requests for the same admin,
    // including requests from different browser sessions.
    await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`thd-upload:${owner.username}`]);
    if (metadata.resumeId) {
      const found = await connection.query<UploadIntent>("SELECT * FROM storage_upload_intents WHERE id=$1", [metadata.resumeId]);
      intent = assertOwnedIntent(found.rows[0], owner);
      if (intent.kind !== metadata.kind || intent.document_type !== metadata.documentType || intent.original_name !== metadata.fileName || Number(intent.expected_size) !== metadata.size || intent.expected_mime !== metadata.mime) throw new UploadValidationError("File không khớp upload đang tiếp tục.", 409);
    } else {
      // Serialize new signed capacity reservations across all administrators.
      await connection.query("SELECT pg_advisory_xact_lock(hashtextextended('thd-storage-capacity', 0))");
      if (!(await storageCapacityAvailable(metadata.size * 2, connection))) throw new UploadValidationError(storageFullMessage, 507);
      const quota = await connection.query<{ active: string; daily: string; bytes: string }>(`SELECT
        COUNT(*) FILTER (WHERE status='pending' AND expires_at > NOW())::text AS active,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')::text AS daily,
        COALESCE(SUM(expected_size) FILTER (WHERE created_at > NOW() - INTERVAL '1 day'),0)::text AS bytes
        FROM storage_upload_intents WHERE username=$1`, [owner.username]);
      if (Number(quota.rows[0].active) >= 4 || Number(quota.rows[0].daily) >= 30 || Number(quota.rows[0].bytes) + metadata.size > 3 * 1024 ** 3) throw new UploadValidationError("Đã đạt giới hạn upload đồng thời hoặc trong ngày. Vui lòng thử lại sau.", 429);
      const id = randomUUID();
      const now = new Date();
      const fileName = `${randomUUID()}${metadata.extension}`;
      const sourceKey = `pending/${id}/${fileName}`;
      const destinationKey = `${uploadRules[metadata.kind].folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${fileName}`;
      const inserted = await connection.query<UploadIntent>(`INSERT INTO storage_upload_intents
        (id,owner_token_hash,username,kind,document_type,original_name,expected_size,expected_mime,source_bucket,source_key,destination_bucket,destination_key,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW() + INTERVAL '2 hours') RETURNING *`, [id, owner.token_hash, owner.username, metadata.kind, metadata.documentType, metadata.fileName, metadata.size, metadata.mime, storage.sourceBucket, sourceKey, storage.destinationBucket, destinationKey]);
      intent = inserted.rows[0];
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally { connection.release(); }
  if (intent.status === "completed") return { id: intent.id, completed: true as const, expiresAt: new Date(intent.expires_at).toISOString() };
  if (metadata.resumeId) {
    if (intent.source_bucket !== storage.sourceBucket || intent.destination_bucket !== storage.destinationBucket) throw new UploadValidationError("Cấu hình Storage đã thay đổi. Hãy bắt đầu upload mới.", 409);
    // TUS may already have committed the object before the browser lost its
    // response or refreshed. The client can proceed directly to validation;
    // issuing a new upload against an immutable existing path would conflict.
    const uploaded = await storage.client.storage.from(intent.source_bucket).info(intent.source_key);
    if (!uploaded.error && uploaded.data) return { id: intent.id, uploaded: true as const, expiresAt: new Date(intent.expires_at).toISOString() };
    if (uploaded.error) {
      const failure = uploaded.error as { status?: number; statusCode?: string; code?: string };
      if (failure.status !== 404 && failure.statusCode !== "404" && !["not_found", "NoSuchKey", "NotFound"].includes(failure.code || "")) throw new UploadValidationError("Không thể kiểm tra trạng thái upload đang tiếp tục.", 503);
    }
  }
  const signed = await storage.client.storage.from(intent.source_bucket).createSignedUploadUrl(intent.source_key, { upsert: false });
  if (signed.error || !signed.data?.token) throw new UploadValidationError("Không thể cấp quyền upload. Kiểm tra cấu hình Storage.", 503);
  return { id: intent.id, token: signed.data.token, endpoint: storage.endpoint, bucket: intent.source_bucket, path: intent.source_key, expiresAt: new Date(intent.expires_at).toISOString(), size: Number(intent.expected_size), mime: intent.expected_mime };
}

async function objectMetadata(storage: ReturnType<typeof config>, bucket: string, key: string) {
  const result = await storage.client.storage.from(bucket).info(key);
  if (result.error || !result.data) throw new UploadValidationError("File chưa upload xong hoặc Storage chưa đọc được file.", 409);
  const mime = result.data.contentType || (result.data.metadata?.mimetype as string | undefined);
  return { size: Number(result.data.size ?? result.data.metadata?.size), mime: mime?.toLowerCase().split(";")[0].trim() };
}

async function storedSignature(storage: ReturnType<typeof config>, bucket: string, key: string) {
  const signed = await storage.client.storage.from(bucket).createSignedUrl(key, 60);
  if (signed.error || !signed.data) throw new UploadValidationError("Không thể xác minh file upload.", 503);
  const signedUrl = new URL(signed.data.signedUrl);
  if (signedUrl.origin !== storage.origin) throw new UploadValidationError("URL xác minh Storage không hợp lệ.", 503);
  return readSignaturePrefix(signedUrl.href);
}

// Range plus a bounded reader ensures even an upstream ignoring Range cannot
// cause the application to download/buffer a whole video. Only 64 signature
// bytes are retained; the upstream stream is cancelled immediately afterwards.
export async function readSignaturePrefix(url: string) {
  const response = await fetch(url, { headers: { Range: "bytes=0-63" }, cache: "no-store", signal: AbortSignal.timeout(20000), redirect: "error" });
  if (!response.ok || !response.body) throw new UploadValidationError("Không thể kiểm tra nội dung file.", 503);
  const reader = response.body.getReader();
  const prefix = Buffer.alloc(64);
  let length = 0;
  try {
    while (length < 64) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const take = Math.min(64 - length, chunk.value.byteLength);
      prefix.set(chunk.value.subarray(0, take), length);
      length += take;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return prefix.subarray(0, length);
}

function validateStoredMetadata(intent: UploadIntent, metadata: { size: number; mime: string | undefined }, maximum: number) {
  if (metadata.size > maximum) throw uploadSizeError(maximum);
  if (metadata.size !== Number(intent.expected_size)) throw new UploadValidationError("Dung lượng file thực tế không khớp quyền upload.", 413);
  if (metadata.mime !== intent.expected_mime) throw new UploadValidationError("MIME type thực tế không khớp quyền upload.", 415);
}

export async function finalizeDirectUpload(id: unknown, owner: UploadOwner): Promise<UploadResult> {
  if (typeof id !== "string" || !UUID.test(id)) throw new UploadValidationError("Mã upload không hợp lệ.", 400);
  const storage = config();
  await ensureSchema();
  const connection = await db.connect();
  let intent: UploadIntent | undefined;
  try {
    await connection.query("BEGIN");
    const found = await connection.query<UploadIntent>("SELECT * FROM storage_upload_intents WHERE id=$1 FOR UPDATE", [id]);
    intent = assertOwnedIntent(found.rows[0], owner);
    if (intent.status === "completed" && intent.result) { await connection.query("COMMIT"); return intent.result; }
    if (intent.source_bucket !== storage.sourceBucket || intent.destination_bucket !== storage.destinationBucket) throw new UploadValidationError("Cấu hình Storage đã thay đổi. Hãy bắt đầu upload mới.", 409);
    const maximum = getUploadMaxBytes(intent.kind, { driver: "supabase", env: process.env, bucketLimits: await bucketLimits(storage) });
    if (Number(intent.expected_size) > maximum) throw uploadSizeError(maximum);
    const sourceMetadata = await objectMetadata(storage, intent.source_bucket, intent.source_key);
    validateStoredMetadata(intent, sourceMetadata, maximum);
    const sourcePrefix = await storedSignature(storage, intent.source_bucket, intent.source_key);
    const detected = detectedFileMime(sourcePrefix);
    const actualMime = intent.kind === "audio" && detected === "video/mp4" ? "audio/mp4" : detected;
    if (actualMime !== intent.expected_mime) throw new UploadValidationError("Nội dung file không khớp MIME type và phần mở rộng.", 415);
    const copied = await storage.client.storage.from(intent.source_bucket).copy(intent.source_key, intent.destination_key, { destinationBucket: intent.destination_bucket });
    // A retry after a successful copy but a lost DB transaction may encounter
    // the same destination. Its UUID belongs only to this intent; verify the
    // immutable object's metadata before accepting the previous copy.
    if (copied.error) {
      const failure = copied.error as { status?: number; statusCode?: string };
      if (failure.status === 413 || failure.statusCode === "413") throw new UploadValidationError("File vượt giới hạn dung lượng Storage.", 413);
      if (failure.status !== 409 && failure.statusCode !== "409" && failure.statusCode !== "Duplicate") throw new UploadValidationError("Không thể hoàn tất lưu file trên Storage.", 503);
    }
    const destinationMetadata = await objectMetadata(storage, intent.destination_bucket, intent.destination_key);
    validateStoredMetadata(intent, destinationMetadata, maximum);
    if (copied.error) {
      const destinationPrefix = await storedSignature(storage, intent.destination_bucket, intent.destination_key);
      // Multipart source and server-side copies may legitimately have different
      // ETag algorithms. ETags are not portable full-file checksum assertions.
      if (!destinationPrefix.equals(sourcePrefix)) throw new UploadValidationError("File đích không khớp file upload đã xác minh.", 415);
    }
    const result: UploadResult = { url: `/uploads/supabase/${intent.destination_key}`, fileName: path.posix.basename(intent.destination_key), size: Number(intent.expected_size), mime: intent.expected_mime, driver: "supabase" };
    await connection.query("UPDATE storage_upload_intents SET status='completed',result=$2::jsonb,completed_at=NOW() WHERE id=$1", [id, JSON.stringify(result)]);
    await connection.query(`INSERT INTO audit_logs(username,action,entity_type,entity_id,details) VALUES($1,'upload_direct','file',$2,$3::jsonb)`, [owner.username, id, JSON.stringify({ kind: intent.kind, ...result })]);
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    if (intent && intent.owner_token_hash === owner.token_hash && intent.status === "pending" && error instanceof UploadValidationError && [413, 415].includes(error.status)) {
      await connection.query("UPDATE storage_upload_intents SET status='rejected' WHERE id=$1", [id]);
      await connection.query("COMMIT");
    } else await connection.query("ROLLBACK");
    throw error;
  } finally { connection.release(); }
}
