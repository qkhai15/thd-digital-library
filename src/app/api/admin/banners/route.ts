import { NextResponse } from "next/server";
import { isAdmin, auditLog } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { jsonBody, sameOriginAllowed } from "@/lib/backend-utils";
import { bannerInput } from "@/lib/banner-input";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  const result = await db.query(`SELECT * FROM wall_banners ORDER BY sort_order,id`);
  return NextResponse.json(result.rows);
}
export async function POST(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  if (!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  let input;
  try {
    const body = await jsonBody(request);
    if (body instanceof NextResponse) return body;
    input=bannerInput(body);
  }
  catch (error) { return NextResponse.json({message:error instanceof Error ? error.message : "Dữ liệu không hợp lệ."},{status:400}); }
  const result=await db.query(`INSERT INTO wall_banners(title,image_url,link_url,is_active,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING *`,[input.title,input.image,input.link,input.active,input.order]);
  await auditLog("create","banner",String(result.rows[0].id));
  return NextResponse.json(result.rows[0],{status:201});
}
