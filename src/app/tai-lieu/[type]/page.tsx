import ContentThumbnail from "@/components/ContentThumbnail";
import { notFound } from "next/navigation";
import { boundedInt } from "@/lib/backend-utils";
import Link from "next/link";
import { BookOpen, Eye, Filter, RotateCcw } from "lucide-react";
import LibraryShell from "@/components/LibraryShell";
import { ACTIVE_LIBRARY_TYPES, TYPE_LABELS, type LibraryType } from "@/lib/library-types";
import { getItemHref } from "@/lib/library-url";
import { searchItems } from "@/lib/library-repository";
import { publicMetadata } from "@/lib/public-metadata";

export const dynamic = "force-dynamic";

type Props={params:Promise<{type:string}>;searchParams:Promise<{lop?:string;q?:string;page?:string;size?:string}>};
export async function generateMetadata({ params, searchParams }: Props) {
  const { type } = await params;
  if (!["moi-nhat", "thinh-hanh"].includes(type) && !ACTIVE_LIBRARY_TYPES.includes(type as LibraryType)) notFound();
  const title = type === "moi-nhat" ? "Sách mới thêm" : type === "thinh-hanh" ? "Tài liệu thịnh hành" : TYPE_LABELS[type as LibraryType];
  const sp = await searchParams;
  const filtered = Boolean(sp.q?.trim() || (sp.lop && sp.lop !== "tat-ca"));
  return {
    ...publicMetadata({ title, path: `/tai-lieu/${type}`, description: `${title} tại thư viện điện tử THPT Trần Hưng Đạo - Thanh Xuân. Tra cứu và khám phá tài liệu phục vụ học tập.` }),
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}
export default async function TypePage({params,searchParams}:Props){
  const {type}=await params; const sp=await searchParams; const latest=type==="moi-nhat"; const popular=type==="thinh-hanh";
  if(!latest&&!popular&&!ACTIVE_LIBRARY_TYPES.includes(type as LibraryType)) notFound();
  const title=latest?"Sách mới thêm":popular?"Tài liệu thịnh hành":TYPE_LABELS[type as LibraryType];
  const lop=sp.lop??"tat-ca"; const q=sp.q??""; const size=[12,24,50].includes(Number(sp.size))?Number(sp.size):24; const requestedPage=boundedInt(sp.page,1,1000000);
  const {items,total,page}=await searchItems({type,classLevel:lop,q,page:requestedPage,size}); const pages=Math.max(1,Math.ceil(total/size));
  const url=(changes:Record<string,string|number>)=>{const p=new URLSearchParams(); const all={lop,q,size,page,...changes};Object.entries(all).forEach(([k,v])=>{if(String(v)&&!(k==="lop"&&v==="tat-ca"))p.set(k,String(v));});return `/tai-lieu/${type}${p.toString()?`?${p}`:""}`};
  return <LibraryShell><main className="flow-page"><div className="container"><div className="breadcrumb"><Link href="/">Trang chủ</Link><span>/</span><span>Tài liệu</span><span>/</span><strong>{title}</strong></div><div className="flow-layout">
    <aside className="filter-card"><div className="filter-title"><Filter size={18}/><b>Bộ lọc tìm kiếm</b></div><div className="filter-actions"><span>Lọc ({lop==="tat-ca"?0:1})</span><Link href={`/tai-lieu/${type}`}><RotateCcw size={14}/>Xóa tất cả</Link></div><h3>Lớp</h3>{["tat-ca","10","11","12","Khác"].map(x=><Link key={x} href={url({lop:x,page:1})} className={`filter-option ${lop===x?"active":""}`}><span/>{x==="tat-ca"?"Tất cả":`Lớp ${x}`}</Link>)}</aside>
    <section className="results-card"><div className="results-top"><h1>{title}</h1><form className="inline-search"><input type="hidden" name="lop" value={lop}/><input name="q" defaultValue={q} placeholder="Tìm trong danh mục..."/><button>Tìm</button></form></div>
      {items.length?<div className="result-grid">{items.map(item=><Link key={item.id} href={getItemHref(item)} className={`result-card ${["video","album"].includes(item.type)?"result-card-media":""}`}><div className="result-cover real-cover-wrap"><ContentThumbnail item={item}/></div><h3>{item.title}</h3><p>{item.author}</p><div><span>{item.category}</span><span><Eye size={13}/>{item.views}</span></div></Link>)}</div>:<div className="empty-box"><BookOpen size={40}/>Không có dữ liệu.</div>}
      <div className="pagination"><div><span>Hiển thị</span>{[12,24,50].map(n=><Link key={n} className={size===n?"active":""} href={url({size:n,page:1})}>{n}</Link>)}<span>dòng / trang</span></div><div><Link className={page<=1?"disabled":""} href={url({page:Math.max(1,page-1)})}>‹</Link><span>{page}/{pages}</span><Link className={page>=pages?"disabled":""} href={url({page:Math.min(pages,page+1)})}>›</Link></div></div>
    </section>
  </div></div></main></LibraryShell>;
}
