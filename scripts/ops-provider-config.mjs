import { parseEncryptionKey, s3Config } from './ops-backup/core.mjs';

export const backupVariableNames = Object.freeze(['BACKUP_S3_ENDPOINT', 'BACKUP_S3_REGION', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY', 'BACKUP_ENCRYPTION_KEY']);
export function checkBackupProviderConfig(env) {
  const missing = backupVariableNames.filter(name => !env[name]);
  if (missing.length) return { status: 'MISSING_CONFIG', missing, externalBackupVerified: false };
  try {
    s3Config(env); const key = parseEncryptionKey(env.BACKUP_ENCRYPTION_KEY); key.fill(0);
    return { status: 'READY', missing: [], externalBackupVerified: false };
  } catch { return { status: 'INVALID_CONFIG', missing: [], reason: 'Check HTTPS S3 endpoint, region, bucket and 32-byte encryption key format.', externalBackupVerified: false }; }
}
