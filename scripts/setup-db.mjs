import pg from "pg";
import dotenv from "dotenv";
import { migrateSchema } from "./schema.mjs";

dotenv.config({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL && !process.env.PGHOST) throw new Error("Thiếu cấu hình PostgreSQL.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await migrateSchema(pool);
  console.log("Migration hoàn tất. Không xóa dữ liệu hoặc thêm nội dung demo.");
} finally { await pool.end(); }
