import dotenv from "dotenv";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { validateProductionConfig } from "./production-config.mjs";

// Creates a private, ignored handoff file. Never edits .env.local or prints values.
const filename = "deploy/data/railway-production.env";
const source = { ...dotenv.parse(await readFile(".env.local")), ...process.env };
let existing = {};
try { existing = dotenv.parse(await readFile(filename)); } catch (error) { if (error.code !== "ENOENT") throw error; }
const certificate = await readFile(source.DB_SSL_CA_FILE || "deploy/data/certs/prod-ca-2021.crt");
const env = {
  DATABASE_URL: source.SUPABASE_DATABASE_URL,
  DB_SSL_CA_BASE64: certificate.toString("base64"),
  AUTO_MIGRATE: "false", STORAGE_DRIVER: "supabase", STORAGE_LEGACY_REMOTE: "true",
  SUPABASE_URL: source.SUPABASE_URL, SUPABASE_STORAGE_BUCKET: source.SUPABASE_STORAGE_BUCKET || "thd-library",
  SUPABASE_UPLOAD_BUCKET: source.SUPABASE_UPLOAD_BUCKET || "thd-library-quarantine",
  SUPABASE_SECRET_KEY: source.SUPABASE_SECRET_KEY || source.SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_USERNAME: existing.ADMIN_USERNAME || source.ADMIN_USERNAME,
  ADMIN_PASSWORD: existing.ADMIN_PASSWORD || randomBytes(32).toString("base64url"),
  SESSION_SECRET: existing.SESSION_SECRET || randomBytes(48).toString("hex"),
  APP_ORIGIN: "https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn",
  PUBLIC_ORIGINS: existing.PUBLIC_ORIGINS || "",
  ADMIN_SESSION_NOT_BEFORE: existing.ADMIN_SESSION_NOT_BEFORE || new Date().toISOString(),
  DB_POOL_MAX: "5", UPLOAD_MAX_CONCURRENT: "1", UPLOAD_MEDIA_MAX_MIB: "50",
  COMMENTS_REQUIRE_APPROVAL: "true",
  RAILWAY_DOCKERFILE_PATH: "deploy/Dockerfile.railway",
};
validateProductionConfig(env);
await mkdir("deploy/data", {recursive:true});
await writeFile(filename, Object.entries(env).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join("\n")+"\n", {mode:0o600});
console.log(JSON.stringify({privateFile:filename,variables:Object.keys(env),newCredentials:!existing.ADMIN_PASSWORD,valuesPrinted:false}));
