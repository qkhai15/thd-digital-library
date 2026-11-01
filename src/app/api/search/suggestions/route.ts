import { NextRequest, NextResponse } from "next/server";
import { getSearchSuggestions } from "@/lib/library-repository";
import { allowSearchRequest } from "@/lib/search-analytics";
import { cleanSearchText } from "@/lib/search-policy";
import { logBackendError } from "@/lib/backend-utils";
import { cachedSearchSuggestions, cacheSearchSuggestions, searchSuggestionsRevision } from "@/lib/search-suggestions-cache";

const headers={"Cache-Control":"private, no-store"};
export async function GET(request:NextRequest) {
  const raw=request.nextUrl.searchParams.get("q")||"";
  if(raw.length>120)return NextResponse.json({message:"Từ khóa tối đa 120 ký tự."},{status:400,headers});
  const q=cleanSearchText(raw);
  if(q.length<2)return NextResponse.json({items:[]},{headers});
  if(!allowSearchRequest("suggest"))return NextResponse.json({message:"Vui lòng thử lại sau ít giây."},{status:429,headers:{...headers,"Retry-After":"5"}});
  const saved=cachedSearchSuggestions(q);
  if(saved)return NextResponse.json({items:saved},{headers});
  const revision=searchSuggestionsRevision();
  try{
    const items=await getSearchSuggestions(q);
    cacheSearchSuggestions(q,items,revision);
    return NextResponse.json({items},{headers});
  }catch(error){logBackendError("Search suggestions",error);return NextResponse.json({items:[]},{status:503,headers});}
}
