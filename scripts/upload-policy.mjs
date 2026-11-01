/** Shared, secret-free upload policy used by server, clients and storage CLI. */
export const MIB = 1024 * 1024;
export const DEFAULT_MEDIA_MAX_MIB = 50;
export const DIRECT_UPLOAD_THRESHOLD_BYTES = 6 * MIB;
export const MULTIPART_BODY_MAX_BYTES = 16 * MIB;
export const UPLOAD_METADATA_MAX_BYTES = 8192;
export const UPLOAD_TYPE_MAX_BYTES = Object.freeze({
  cover: 10 * MIB, gallery: 15 * MIB, banner: 15 * MIB,
  document: 80 * MIB, audio: 150 * MIB, video: 500 * MIB,
});
const MEDIA_KINDS = new Set(['document', 'audio', 'video']);

/** @param {Record<string, string | undefined>} [env] */
export function getConfiguredMediaLimit(env = {}) {
  const raw = env.UPLOAD_MEDIA_MAX_MIB;
  if (raw === undefined || raw === '') return DEFAULT_MEDIA_MAX_MIB * MIB;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > 500) throw new Error('UPLOAD_MEDIA_MAX_MIB must be an integer from 1 to 500.');
  return Number(raw) * MIB;
}

/**
 * @param {string} kind
 * @param {{driver?: 'local' | 'supabase', env?: Record<string,string|undefined>, bucketLimits?: unknown[]}} [options]
 */
export function getUploadMaxBytes(kind, { driver = 'supabase', env = {}, bucketLimits = [] } = {}) {
  if (!Object.hasOwn(UPLOAD_TYPE_MAX_BYTES, kind)) throw new Error('Invalid upload kind.');
  if (!['local', 'supabase'].includes(driver)) throw new Error('Invalid storage driver.');
  const typeLimit = UPLOAD_TYPE_MAX_BYTES[kind];
  // Preserve the established local provider limits during coexistence.
  if (driver === 'local') return typeLimit;
  const configured = MEDIA_KINDS.has(kind) ? getConfiguredMediaLimit(env) : typeLimit;
  const buckets = bucketLimits.map(Number).filter(value => Number.isSafeInteger(value) && value > 0);
  return Math.min(typeLimit, configured, ...buckets);
}
