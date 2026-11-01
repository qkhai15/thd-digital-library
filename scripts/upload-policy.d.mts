export type UploadKind = "cover" | "gallery" | "banner" | "document" | "audio" | "video";
export const MIB: number;
export const DEFAULT_MEDIA_MAX_MIB: number;
export const DIRECT_UPLOAD_THRESHOLD_BYTES: number;
export const MULTIPART_BODY_MAX_BYTES: number;
export const UPLOAD_METADATA_MAX_BYTES: number;
export const UPLOAD_TYPE_MAX_BYTES: Readonly<Record<UploadKind, number>>;
export function getConfiguredMediaLimit(env?: Record<string, string | undefined>): number;
export function getUploadMaxBytes(kind: string, options?: {
  driver?: "local" | "supabase";
  env?: Record<string, string | undefined>;
  bucketLimits?: unknown[];
}): number;
