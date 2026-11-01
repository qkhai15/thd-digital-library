import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfiguredMediaLimit, MIB } from "./upload-policy.mjs";

export function productionChildExitCode(code, shutdownRequested) {
  if (shutdownRequested && [null, 0, 130, 143].includes(code)) return 0;
  return typeof code === "number" ? code : shutdownRequested ? 0 : 1;
}

export function validateProductionConfig(env) {
  for (const name of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_STORAGE_BUCKET", "ADMIN_USERNAME", "ADMIN_PASSWORD", "SESSION_SECRET", "APP_ORIGIN", "ADMIN_SESSION_NOT_BEFORE"]) if (!env[name]) throw new Error(`Missing ${name}.`);
  if (!env.SUPABASE_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase server key.");
  if (env.AUTO_MIGRATE !== "false" || env.STORAGE_DRIVER !== "supabase" || env.STORAGE_LEGACY_REMOTE !== "true") throw new Error("Production storage/migration flags are invalid.");
  const db = new URL(env.DATABASE_URL);
  for (const key of ["host", "hostaddr", "port", "user", "password", "database", "dbname"]) if (db.searchParams.has(key)) throw new Error("Database routing/credential query overrides are not allowed.");
  if (!["postgres:", "postgresql:"].includes(db.protocol) || !/\.supabase\.(co|com)$/.test(db.hostname)) throw new Error("Production database must be hosted Supabase.");
  if (db.port === "6543") throw new Error("Use the reviewed direct/session pooler connection.");
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("TLS verification cannot be disabled.");
  const origin = new URL(env.APP_ORIGIN);
  if (origin.protocol !== "https:" || origin.origin !== env.APP_ORIGIN || origin.hostname.includes("*")) throw new Error("APP_ORIGIN must be an exact HTTPS origin.");
  for (const value of (env.PUBLIC_ORIGINS || "").split(",").map(value=>value.trim()).filter(Boolean)) {
    const additional = new URL(value);
    if (additional.protocol !== "https:" || additional.origin !== value || additional.hostname.includes("*")) throw new Error("PUBLIC_ORIGINS must contain exact HTTPS origins.");
  }
  const cutoff = new Date(env.ADMIN_SESSION_NOT_BEFORE);
  if (!Number.isFinite(cutoff.getTime()) || !/Z$/.test(env.ADMIN_SESSION_NOT_BEFORE) || cutoff.getTime() > Date.now()) throw new Error("Invalid UTC session cutoff.");
  if (env.ADMIN_PASSWORD.length < 16 || /change[-_ ]?me|placeholder|^(password|admin|12345)+$/i.test(env.ADMIN_PASSWORD)) throw new Error("Use a production admin password of at least 16 characters, not a template.");
  if (Buffer.byteLength(env.SESSION_SECRET, "utf8") < 32 || env.SESSION_SECRET === env.ADMIN_PASSWORD || /doi-chuoi|change[-_ ]?me|example|test-secret/i.test(env.SESSION_SECRET)) throw new Error("Use an independent random production SESSION_SECRET of at least 32 bytes.");
  const port = env.PORT || "3000";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("Invalid PORT.");
  for (const name of ["DB_POOL_MAX", "UPLOAD_MAX_CONCURRENT"]) if (env[name] && (!/^\d+$/.test(env[name]) || Number(env[name]) < 1 || Number(env[name]) > 20)) throw new Error(`Invalid ${name}.`);
  if (!env.DB_SSL_CA_BASE64 && !env.DB_SSL_CA_FILE) throw new Error("Provide DB_SSL_CA_BASE64 or DB_SSL_CA_FILE.");
  return { database: db, port, mediaLimit: getConfiguredMediaLimit(env) };
}

export function validateProductionUploadBuckets(env, destination, quarantine) {
  const required = getConfiguredMediaLimit(env);
  if (destination?.public !== true || quarantine?.public !== false) throw new Error("Storage public/private bucket modes are invalid.");
  for (const bucket of [destination, quarantine]) {
    const limit = Number(bucket.file_size_limit);
    if (!Number.isSafeInteger(limit) || limit < required) throw new Error("Storage bucket limit is below configured upload policy.");
  }
}

export async function prepareProductionEnvironment(env) {
  const { database, port, mediaLimit } = validateProductionConfig(env);
  const certificate = env.DB_SSL_CA_BASE64 ? Buffer.from(env.DB_SSL_CA_BASE64, "base64") : await readFile(env.DB_SSL_CA_FILE);
  const parsed = new X509Certificate(certificate);
  if (!parsed.ca || Date.parse(parsed.validTo) <= Date.now()) throw new Error("Invalid/expired database CA certificate.");
  const directory = await mkdtemp(path.join(os.tmpdir(), "thd-db-ca-"));
  const caFile = path.join(directory, "root.crt");
  await writeFile(caFile, certificate, { mode: 0o600 });
  database.searchParams.set("sslmode", "verify-full");
  database.searchParams.set("sslrootcert", caFile);
  database.searchParams.delete("uselibpqcompat");
  return { ...env, NODE_ENV: "production", DATABASE_URL: database.toString(), DB_SSL_CA_FILE: caFile, PORT: port, PRODUCTION_REMOTE_ONLY: "true", DB_POOL_MAX: env.DB_POOL_MAX || "5", UPLOAD_MAX_CONCURRENT: env.UPLOAD_MAX_CONCURRENT || "1", UPLOAD_MEDIA_MAX_MIB: String(mediaLimit / MIB) };
}
