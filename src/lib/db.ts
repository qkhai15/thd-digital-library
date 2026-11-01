import { migrateSchema, SCHEMA_VERSION } from "../../scripts/schema.mjs";
import { Pool } from "pg";
import path from "node:path";

function databaseConnectionString() {
  const raw = process.env.DATABASE_URL;
  if (!raw || !process.env.DB_SSL_CA_FILE) return raw;
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("sslrootcert", path.resolve(process.env.DB_SSL_CA_FILE));
  }
  return url.toString();
}

const globalForDb = globalThis as unknown as {
  thdPool?: Pool;
  thdSchemaPromise?: Promise<void>;
};

export const db =
  globalForDb.thdPool ??
  new Pool({
    connectionString: databaseConnectionString(),
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

globalForDb.thdPool = db;

async function bootstrapSchema() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST) throw new Error("Thiếu cấu hình PostgreSQL.");
  if (process.env.AUTO_MIGRATE === "false") {
    const result = await db.query('SELECT 1 FROM thd_schema_migrations WHERE version=$1', [SCHEMA_VERSION]);
    if (!result.rowCount) throw new Error("Database cần migration. Chạy npm run db:migrate trước khi khởi động.");
    return;
  }
  await migrateSchema(db);
}

export async function ensureSchema() {
  globalForDb.thdSchemaPromise ??= bootstrapSchema().catch((error) => {
    globalForDb.thdSchemaPromise = undefined;
    throw error;
  });
  return globalForDb.thdSchemaPromise;
}
