import { spawn } from "node:child_process";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { prepareProductionEnvironment, productionChildExitCode, validateProductionUploadBuckets } from "./production-config.mjs";
import { SCHEMA_VERSION } from "./schema.mjs";

try {
  const env = await prepareProductionEnvironment(process.env);
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15000 });
  try {
    const connection = await pool.connect();
    try {
      const row = await connection.query("SELECT 1 FROM thd_schema_migrations WHERE version=$1", [SCHEMA_VERSION]);
      if (!row.rowCount) throw new Error("Database schema not ready.");
      const socket = connection.connection.stream;
      if (socket.encrypted !== true || socket.authorized !== true) throw new Error("Verified database TLS required.");
      console.log("Production database TLS PASS:", socket.getProtocol());
    } finally { connection.release(); }
  } finally { await pool.end(); }
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
  if (error || !data?.public) throw new Error("Storage public bucket not ready.");
  const pending = await client.storage.getBucket(env.SUPABASE_UPLOAD_BUCKET || "thd-library-quarantine");
  if (pending.error || pending.data?.public !== false || !pending.data.file_size_limit) throw new Error("Storage private upload bucket not ready.");
  validateProductionUploadBuckets(env, data, pending.data);
  console.log("Production preflight PASS: verified database TLS/schema and Supabase Storage. Starting Next.js.");
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", env.PORT], { env, stdio: "inherit", windowsHide: true });
  let shutdownRequested = false;
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { shutdownRequested = true; child.kill(signal); });
  child.on("close", code => process.exitCode = productionChildExitCode(code, shutdownRequested));
  child.on("error", () => { console.error("Next.js start failed."); process.exitCode = 1; });
} catch (error) {
  console.error("Production startup refused:", error.code || (error.message?.startsWith("Missing ") ? error.message : "configuration, TLS, database or Storage preflight failed"));
  process.exitCode = 1;
}
