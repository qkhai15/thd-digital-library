import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";

export async function GET() {
  try {
    await ensureSchema();
    const result = await db.query(`SELECT NOW() AS now`);
    return NextResponse.json({
      ok: true,
      database: "connected",
      time: result.rows[0].now,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("HEALTH ERROR", (error as { code?: string }).code || "database unavailable");
    return NextResponse.json({ ok: false, database: "error" }, { status: 500 });
  }
}
