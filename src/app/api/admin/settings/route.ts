import { jsonBody } from "@/lib/backend-utils";
import { NextResponse } from "next/server";
import { isAdmin, auditLog } from "@/lib/admin-auth";
import { commentsRequireApproval,homepageDiscovery } from "@/lib/site-settings";
import {discoverySettings} from '@/lib/discovery-policy';
import { db } from "@/lib/db";
import { sameOriginAllowed } from "@/lib/backend-utils";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  const [comments,discovery]=await Promise.all([commentsRequireApproval(),homepageDiscovery()]);
  return NextResponse.json({comments_require_approval:comments,homepage_discovery:discovery});
}
export async function PUT(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  if (!sameOriginAllowed(request)) return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  const body = await jsonBody(request);
  if (body instanceof NextResponse) return body;
  const changes:Record<string,unknown>={};
  try{
    if('comments_require_approval' in body){if(typeof body.comments_require_approval!=='boolean')throw new Error('Cài đặt bình luận không hợp lệ.');changes.comments_require_approval=body.comments_require_approval;}
    if('homepage_discovery' in body)changes.homepage_discovery=discoverySettings(body.homepage_discovery,true);
    if(!Object.keys(changes).length)throw new Error('Chưa có cài đặt cần cập nhật.');
  }catch(error){return NextResponse.json({message:error instanceof Error?error.message:'Cài đặt không hợp lệ.'},{status:400});}
  const client=await db.connect();
  try{await client.query('BEGIN');for(const [key,value] of Object.entries(changes))await client.query(`INSERT INTO site_settings(key,value) VALUES($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[key,JSON.stringify(value)]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  await auditLog("settings","site","preferences",changes);
  return NextResponse.json(changes);
}
