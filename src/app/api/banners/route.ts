import {NextResponse} from "next/server";import {db,ensureSchema} from "@/lib/db";
export async function GET(){await ensureSchema();const r=await db.query(`SELECT id,title,image_url,link_url,sort_order FROM wall_banners WHERE is_active=TRUE ORDER BY sort_order,id`);return NextResponse.json(r.rows)}
