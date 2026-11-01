import { NextRequest, NextResponse } from "next/server";
import { searchItems } from "@/lib/library-repository";
import { searchInputFromParams } from "@/lib/search-policy";
import {logBackendError} from '@/lib/backend-utils';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  try{
    const result = await searchItems(searchInputFromParams(url.searchParams));
    return NextResponse.json({...result, limit:result.size});
  }catch(error){
    logBackendError('PUBLIC_SEARCH_FAILED',error);
    return NextResponse.json({message:'Chưa thể tải kết quả tìm kiếm. Vui lòng thử lại.'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'5'}});
  }
}
