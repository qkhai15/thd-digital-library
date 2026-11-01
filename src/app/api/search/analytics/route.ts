import { NextRequest, NextResponse } from "next/server";
import { sameOriginAllowed, logBackendError } from "@/lib/backend-utils";
import { readLimitedText, RequestBodyTooLargeError } from "@/lib/request-body";
import { analyticsQuery, allowSearchRequest, recordSearchAnalytics } from "@/lib/search-analytics";
import { buildSearchQuery } from "@/lib/library-repository";
import { searchInputFromParams } from "@/lib/search-policy";
import { db, ensureSchema } from "@/lib/db";

export async function POST(request:NextRequest) {
  if(!sameOriginAllowed(request))return NextResponse.json({message:"Yêu cầu không hợp lệ."},{status:403});
  if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return NextResponse.json({message:"Cần dữ liệu JSON."},{status:415});
  if(!allowSearchRequest("analytics"))return NextResponse.json({message:"Vui lòng thử lại sau."},{status:429,headers:{"Retry-After":"30"}});
  try{
    const body=JSON.parse(await readLimitedText(request,2048));
    if(!body||typeof body!=="object"||typeof body.q!=="string"||body.q.length>120)return NextResponse.json({message:"Từ khóa không hợp lệ."},{status:400});
    if(!analyticsQuery(body.q))return new NextResponse(null,{status:204});
    const params=new URLSearchParams();
    for(const name of ["q","type","subject","grade","topic","tag","sort"])if(typeof body[name]==="string")params.set(name,body[name]);
    const {fromSql,whereSql,values}=buildSearchQuery(searchInputFromParams(params));
    await ensureSchema();
    // Recompute server-side; a caller cannot forge zero-result analytics.
    const count=await db.query(`SELECT COUNT(*)::int total ${fromSql} ${whereSql}`,values);
    await recordSearchAnalytics(body.q,Number(count.rows[0]?.total||0));
    return new NextResponse(null,{status:204});
  }catch(error){
    if(error instanceof RequestBodyTooLargeError)return NextResponse.json({message:"Yêu cầu quá lớn."},{status:413});
    if(error instanceof SyntaxError)return NextResponse.json({message:"JSON không hợp lệ."},{status:400});
    logBackendError("Search analytics",error);return NextResponse.json({message:"Chưa thể ghi thống kê."},{status:503});
  }
}
