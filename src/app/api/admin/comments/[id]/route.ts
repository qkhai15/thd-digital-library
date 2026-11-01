import { jsonBody } from "@/lib/backend-utils";
import { NextResponse } from "next/server";
import { auditLog, isAdmin } from "@/lib/admin-auth";
import { parsePositiveInt, sameOriginAllowed } from "@/lib/backend-utils";
import { db, ensureSchema } from "@/lib/db";

type Ctx={params:Promise<{id:string}>};
export async function PATCH(request:Request,ctx:Ctx){
  await ensureSchema(); if(!(await isAdmin())) return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  if(!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  const {id}=await ctx.params; const commentId=parsePositiveInt(id); if(!commentId)return NextResponse.json({message:"ID không hợp lệ."},{status:400});
  const body=await jsonBody(request);
  if (body instanceof NextResponse) return body;
  const status=String(body.status??"");
  if(!["approved","hidden","pending"].includes(status))return NextResponse.json({message:"Trạng thái không hợp lệ."},{status:400});
  const r=await db.query(`UPDATE library_comments SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *`,[status,commentId]);
  if(!r.rows[0])return NextResponse.json({message:"Không tìm thấy bình luận."},{status:404});
  await auditLog("comment_status","comment",String(commentId),{status}); return NextResponse.json(r.rows[0]);
}
export async function DELETE(request:Request,ctx:Ctx){
  await ensureSchema(); if(!(await isAdmin())) return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  if(!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  const {id}=await ctx.params; const commentId=parsePositiveInt(id); if(!commentId)return NextResponse.json({message:"ID không hợp lệ."},{status:400});
  await db.query(`DELETE FROM library_comments WHERE id=$1`,[commentId]); await auditLog("delete","comment",String(commentId));
  return NextResponse.json({ok:true});
}
