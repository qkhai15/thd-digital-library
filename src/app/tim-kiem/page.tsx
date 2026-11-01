import Link from "next/link";
import LibraryShell from "@/components/LibraryShell";
import SearchExperience from "@/components/SearchExperience";
import { getSearchFacets, searchItems } from "@/lib/library-repository";
import { searchHref, searchInputFromParams } from "@/lib/search-policy";
import { publicMetadata } from "@/lib/public-metadata";

export const metadata={...publicMetadata({title:"Tìm kiếm tài liệu",path:"/tim-kiem"}),robots:{index:false,follow:true}};
export const dynamic="force-dynamic";
export default async function SearchPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const sp=await searchParams;const params=new URLSearchParams();
  for(const [key,value] of Object.entries(sp))if(typeof value==="string")params.set(key,value);
  const input=searchInputFromParams(params);
  const [result,facets]=await Promise.all([searchItems(input),getSearchFacets()]);
  return <LibraryShell><main className="flow-page"><div className="container">
    <div className="breadcrumb"><Link href="/">Trang chủ</Link><span>/</span><strong>Tìm kiếm</strong></div>
    <SearchExperience key={searchHref(input,input.page)} input={input} result={result} facets={facets}/>
  </div></main></LibraryShell>;
}