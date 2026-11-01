import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual, X509Certificate } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, open, rm, stat, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import path from "node:path";

// Versioned binary envelope; the complete header is authenticated as AAD.
const MAGIC = Buffer.from("THDBAK01");
const HEADER_SIZE = MAGIC.length + 12;
const TAG_SIZE = 16;
export const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");
export class OpsError extends Error {
  constructor(code) { super(code); this.name = "OpsError"; this.code = code; }
}
export const ensure = (condition, code) => { if (!condition) throw new OpsError(code); };
export const sha256 = value => createHash("sha256").update(value).digest("hex");

export function parseEncryptionKey(value) {
  ensure(typeof value === "string", "BACKUP_ENCRYPTION_KEY_REQUIRED");
  const key = /^[a-f\d]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  ensure(key.length === 32 && (/^[a-f\d]{64}$/i.test(value) || key.toString("base64") === value), "BACKUP_ENCRYPTION_KEY_MUST_BE_32_RANDOM_BYTES_BASE64_OR_HEX");
  return key;
}

export async function fileMetadata(file) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return { bytes: (await stat(file)).size, sha256: digest.digest("hex") };
}

export async function encryptFile(source, destination, key) {
  const header = Buffer.concat([MAGIC, randomBytes(12)]);
  const cipher = createCipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  cipher.setAAD(header);
  await writeFile(destination, header, { flag: "wx", mode: 0o600 });
  await pipeline(createReadStream(source), cipher, createWriteStream(destination, { flags: "a", mode: 0o600 }));
  const handle = await open(destination, "a");
  try { await handle.write(cipher.getAuthTag()); } finally { await handle.close(); }
  return fileMetadata(destination);
}

export async function decryptFile(source, destination, key, expectedCiphertext) {
  const metadata = await fileMetadata(source);
  if (expectedCiphertext) ensure(metadata.bytes === expectedCiphertext.bytes && metadata.sha256 === expectedCiphertext.sha256, "BACKUP_CIPHERTEXT_CHECKSUM_MISMATCH");
  ensure(metadata.bytes >= HEADER_SIZE + TAG_SIZE, "BACKUP_ENVELOPE_TRUNCATED");
  const handle = await open(source, "r");
  const header = Buffer.alloc(HEADER_SIZE), tag = Buffer.alloc(TAG_SIZE);
  try { await handle.read(header, 0, HEADER_SIZE, 0); await handle.read(tag, 0, TAG_SIZE, metadata.bytes - TAG_SIZE); } finally { await handle.close(); }
  ensure(timingSafeEqual(header.subarray(0, MAGIC.length), MAGIC), "BACKUP_ENVELOPE_VERSION_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  decipher.setAAD(header); decipher.setAuthTag(tag);
  // Empty Storage objects are legitimate. Their envelope contains only the
  // header/tag; opening a file stream with end < start would reject them.
  const ciphertext = metadata.bytes === HEADER_SIZE + TAG_SIZE
    ? Readable.from([])
    : createReadStream(source, { start: HEADER_SIZE, end: metadata.bytes - TAG_SIZE - 1 });
  let created = false;
  const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  output.once("open", () => { created = true; });
  try {
    await pipeline(ciphertext, decipher, output);
  } catch {
    // GCM can emit unauthenticated plaintext before final tag verification.
    // Remove only a destination created by this call, never a preexisting file.
    if (created) await rm(destination, { force: true });
    throw new OpsError("BACKUP_DECRYPT_OR_AUTHENTICATION_FAILED");
  }
  return fileMetadata(destination);
}

export function safeObjectKey(key) {
  ensure(typeof key === "string" && key.length > 0 && key.length <= 1024 && !key.startsWith("/") && !key.includes("\\") && !/[\x00-\x1f\x7f]/.test(key), "BACKUP_OBJECT_KEY_INVALID");
  ensure(key.split("/").every(part => part && part !== "." && part !== ".."), "BACKUP_OBJECT_KEY_INVALID");
  return key;
}
const uriEncode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();

export function signS3Request({ endpoint, region, bucket, accessKeyId, secretAccessKey, method, key, headers = {}, payloadHash = EMPTY_SHA256, date = new Date() }) {
  const url = new URL(endpoint);
  ensure(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && ["", "/"].includes(url.pathname), "BACKUP_S3_ENDPOINT_MUST_BE_EXACT_HTTPS_ORIGIN");
  ensure(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) && !bucket.includes(".."), "BACKUP_S3_BUCKET_INVALID");
  ensure(/^[a-z0-9-]+$/.test(region), "BACKUP_S3_REGION_INVALID");
  safeObjectKey(key);
  ensure(/^[a-f\d]{64}$/.test(payloadHash), "BACKUP_PAYLOAD_HASH_INVALID");
  const stamp = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, " ")]));
  Object.assign(normalized, { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp });
  const names = Object.keys(normalized).sort();
  const canonicalHeaders = names.map(name => `${name}:${normalized[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const pathname = `/${uriEncode(bucket)}/${key.split("/").map(uriEncode).join("/")}`;
  const canonical = [method, pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  normalized.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${url.origin}${pathname}`, headers: normalized, canonical, signature };
}

export function s3Config(env) {
  for (const name of ["BACKUP_S3_ENDPOINT", "BACKUP_S3_REGION", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"]) ensure(env[name], `${name}_REQUIRED`);
  const endpoint = new URL(env.BACKUP_S3_ENDPOINT);
  ensure(!/supabase\.(co|com)$/.test(endpoint.hostname), "BACKUP_TARGET_MUST_BE_INDEPENDENT_OF_SUPABASE");
  if (env.SUPABASE_URL) ensure(endpoint.hostname !== new URL(env.SUPABASE_URL).hostname, "BACKUP_TARGET_MUST_BE_INDEPENDENT_OF_SUPABASE");
  const config = { endpoint: env.BACKUP_S3_ENDPOINT, region: env.BACKUP_S3_REGION, bucket: env.BACKUP_S3_BUCKET, accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY };
  signS3Request({ ...config, method: "HEAD", key: "configuration-check" });
  return config;
}

async function requestOnce(config, method, key, { file, destination, metadata = {}, allow404 = false } = {}) {
  const info = file ? await fileMetadata(file) : { bytes: 0, sha256: EMPTY_SHA256 };
  // Single PUT has a portable S3 5 GiB ceiling. No multipart RAM buffering.
  ensure(info.bytes <= 5 * 1024 ** 3, "BACKUP_OBJECT_EXCEEDS_SINGLE_PUT_LIMIT");
  const extra = method === "PUT" ? { "content-length": String(info.bytes), "content-type": "application/octet-stream", "if-none-match": "*", ...Object.fromEntries(Object.entries(metadata).map(([name, value]) => [`x-amz-meta-${name}`, String(value)])) } : {};
  const signed = signS3Request({ ...config, method, key, headers: extra, payloadHash: info.sha256 });
  return new Promise((resolve, reject) => {
    const request = https.request(signed.url, { method, headers: signed.headers, timeout: 120000 }, async response => {
      const status = response.statusCode;
      if (status === 404 && allow404) { response.resume(); resolve(null); return; }
      if (status < 200 || status >= 300) {
        // Never print provider response XML, credentials, or signed request headers.
        response.resume(); reject(new OpsError(status === 412 ? "BACKUP_IMMUTABLE_OBJECT_ALREADY_EXISTS" : "BACKUP_S3_REQUEST_FAILED")); return;
      }
      try {
        if (destination) await pipeline(response, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
        else {
          let length = 0;
          for await (const chunk of response) { length += chunk.length; ensure(length <= 1024 * 1024, "BACKUP_S3_RESPONSE_TOO_LARGE"); }
        }
        resolve({ status, headers: response.headers, ...(destination ? await fileMetadata(destination) : {}) });
      } catch { reject(new OpsError("BACKUP_S3_TRANSFER_FAILED")); }
    });
    request.on("timeout", () => request.destroy(new OpsError("BACKUP_S3_TIMEOUT")));
    request.on("error", () => reject(new OpsError("BACKUP_S3_NETWORK_FAILED")));
    if (file) pipeline(createReadStream(file), request).catch(() => request.destroy(new OpsError("BACKUP_S3_TRANSFER_FAILED")));
    else request.end();
  });
}

export function createS3Client(config) {
  return {
    put: (key, file, metadata) => requestOnce(config, "PUT", safeObjectKey(key), { file, metadata }),
    get: (key, destination) => requestOnce(config, "GET", safeObjectKey(key), { destination }),
    head: key => requestOnce(config, "HEAD", safeObjectKey(key), { allow404: true }),
  };
}

export async function databaseEnvironment(env, directory) {
  ensure(env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "BACKUP_TLS_VERIFICATION_REQUIRED");
  ensure(env.DATABASE_URL, "DATABASE_URL_REQUIRED");
  const source = new URL(env.DATABASE_URL);
  ensure(["postgres:", "postgresql:"].includes(source.protocol) && /\.supabase\.(co|com)$/.test(source.hostname) && source.port !== "6543", "BACKUP_REQUIRES_SUPABASE_DIRECT_OR_SESSION_POOLER");
  for (const key of ["host", "hostaddr", "port", "user", "password", "database", "dbname", "service", "sslcert", "sslkey"]) ensure(!source.searchParams.has(key), "BACKUP_DATABASE_ROUTING_OVERRIDE_REFUSED");
  ensure(env.DB_SSL_CA_BASE64 || env.DB_SSL_CA_FILE, "DB_SSL_CA_REQUIRED");
  const ca = env.DB_SSL_CA_BASE64 ? Buffer.from(env.DB_SSL_CA_BASE64, "base64") : await readFile(env.DB_SSL_CA_FILE);
  const certificate = new X509Certificate(ca);
  ensure(certificate.ca && Date.parse(certificate.validTo) > Date.now(), "BACKUP_DATABASE_CA_INVALID_OR_EXPIRED");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const caFile = path.join(directory, "db-ca.crt");
  await writeFile(caFile, ca, { flag: "wx", mode: 0o600 });
  source.searchParams.set("sslmode", "verify-full"); source.searchParams.set("sslrootcert", caFile);
  source.searchParams.delete("uselibpqcompat");
  // libpq receives credentials only as environment; never command arguments.
  const childEnv = { PATH: env.PATH, SystemRoot: env.SystemRoot, TEMP: env.TEMP, TMP: env.TMP, PGHOST: source.hostname, PGPORT: source.port || "5432", PGDATABASE: decodeURIComponent(source.pathname.slice(1)), PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password), PGSSLMODE: "verify-full", PGSSLROOTCERT: caFile, PGCONNECT_TIMEOUT: "15", PGAPPNAME: "thd-ops-backup" };
  return { connectionString: source.toString(), childEnv };
}

export function validateReceipt(receipt) {
  ensure(receipt?.version === 1 && ["db", "storage"].includes(receipt.kind) && /^\d{4}-\d\d-\d\dT/.test(receipt.createdAt), "BACKUP_RECEIPT_INVALID");
  ensure(/^[a-f\d]{12}$/.test(receipt.keyId) && Array.isArray(receipt.files) && receipt.files.length > 0, "BACKUP_RECEIPT_INVALID");
  const seen = new Set();
  for (const artifact of receipt.files) {
    safeObjectKey(artifact.objectKey);
    ensure(!seen.has(artifact.objectKey) && Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && /^[a-f\d]{64}$/.test(artifact.sha256), "BACKUP_RECEIPT_INVALID");
    seen.add(artifact.objectKey);
  }
  ensure(receipt.files.filter(artifact => artifact.role === "manifest").length === 1, "BACKUP_RECEIPT_INVALID");
  if (receipt.kind === "db") ensure(receipt.files.filter(artifact => artifact.role === "database").length === 1, "BACKUP_RECEIPT_INVALID");
  return receipt;
}

export function hashTransform() {
  const digest = createHash("sha256"); let bytes = 0;
  const stream = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; digest.update(chunk); callback(null, chunk); } });
  return { stream, result: () => ({ bytes, sha256: digest.digest("hex") }) };
}
