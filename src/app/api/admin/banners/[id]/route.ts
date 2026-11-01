import { retainedMedia } from "@/lib/upload-references";
import { NextResponse } from "next/server";
import { isAdmin, auditLog } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { jsonBody, sameOriginAllowed, parsePositiveInt } from "@/lib/backend-utils";
import { bannerInput } from "@/lib/banner-input";
type Context={params:Promise<{id:string}>};

export async function PUT(request:Request,context:Context) {
  if (!(await isAdmin())) return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  if (!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  const id=parsePositiveInt((await context.params).id);
  if (!id) return NextResponse.json({message:"ID không hợp lệ."},{status:400});
  let input;
  try {
    const body = await jsonBody(request);
    if (body instanceof NextResponse) return body;
    input=bannerInput(body);
  }
  catch (error) { return NextResponse.json({message:error instanceof Error ? error.message : "Dữ liệu không hợp lệ."},{status:400}); }
  const current = await db.query(`SELECT image_url FROM wall_banners WHERE id=$1`, [id]);
  const result=await db.query(`UPDATE wall_banners SET title=$1,image_url=$2,link_url=$3,is_active=$4,sort_order=$5,updated_at=NOW() WHERE id=$6 RETURNING *`,[input.title,input.image,input.link,input.active,input.order,id]);
  if (!result.rows[0]) return NextResponse.json({message:"Không tìm thấy báo tường."},{status:404});
  await auditLog("update","banner",String(id), retainedMedia(current.rows[0] || {}, result.rows[0]));
  return NextResponse.json(result.rows[0]);
}
export async function DELETE(request:Request,context:Context) {
  if (!(await isAdmin())) return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  if (!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  const id=parsePositiveInt((await context.params).id);
  if (!id) return NextResponse.json({message:"ID không hợp lệ."},{status:400});
  const result=await db.query(`DELETE FROM wall_banners WHERE id=$1 RETURNING id,image_url`,[id]);
  if (!result.rowCount) return NextResponse.json({message:"Không tìm thấy báo tường."},{status:404});
  await auditLog("delete","banner",String(id), retainedMedia(result.rows[0]));
  return NextResponse.json({ok:true});
}
