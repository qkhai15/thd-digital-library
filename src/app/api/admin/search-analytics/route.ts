import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getSearchAnalytics } from "@/lib/search-analytics";
import { logBackendError } from "@/lib/backend-utils";

export const dynamic="force-dynamic";
export async function GET() {
  if(!await isAdmin())return NextResponse.json({message:"Chưa đăng nhập."},{status:401});
  try{return NextResponse.json(await getSearchAnalytics(),{headers:{"Cache-Control":"no-store"}});}
  catch(error){logBackendError("Admin search analytics",error);return NextResponse.json({message:"Chưa thể tải thống kê."},{status:503});}
}
