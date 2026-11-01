"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import ContentThumbnail from "@/components/ContentThumbnail";
import Pagination from "@/components/Pagination";
import QuerySuggestions from "@/components/QuerySuggestions";
import { ACTIVE_LIBRARY_TYPES, TYPE_LABELS, type LibraryItem } from "@/lib/library-types";
import { getItemHref } from "@/lib/library-url";
import { searchHref, searchInputFromParams, type SearchInput } from "@/lib/search-policy";
import styles from "./SearchExperience.module.css";

type Props={input:SearchInput;result:{items:LibraryItem[];total:number;page:number;totalPages:number};facets:{subjects:{id:number;name:string;slug:string}[];topics:string[]}};
export default function SearchExperience({input,result,facets}:Props) {
  const router=useRouter();
  const [query,setQuery]=useState(input.q||"");const tracked=useRef(false);
  const formRef=useRef<HTMLFormElement>(null);
  useEffect(()=>{
    // Browsers can restore the last edited (unsubmitted) form state from their
    // back/forward cache. Restore the URL's server defaults after that browser
    // step, including when Next reactivates a cached search page.
    let frame=0;
    const restore=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        formRef.current?.reset();
        setQuery(searchInputFromParams(new URLSearchParams(window.location.search)).q||"");
      });
    };
    window.addEventListener("pageshow",restore);window.addEventListener("popstate",restore);
    return ()=>{cancelAnimationFrame(frame);window.removeEventListener("pageshow",restore);window.removeEventListener("popstate",restore);};
  },[]);
  useEffect(()=>{
    if(tracked.current||!input.q||Number(input.page)>1)return;
    tracked.current=true;
    // Record only a submitted results-page search, never typing or suggestions.
    void fetch("/api/search/analytics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),keepalive:true}).catch(()=>{});
  },[input]);
  return <section className="results-card search-page">
    <h1>Tìm kiếm tài liệu</h1>
    <form ref={formRef} action="/tim-kiem" method="get" className={styles.form} onSubmit={event=>{
      event.preventDefault();
      const params=new URLSearchParams();
      for(const [name,value] of new FormData(event.currentTarget))if(typeof value==="string")params.set(name,value);
      const next=searchInputFromParams(params);
      // Cache the departing page in the state represented by its URL, rather
      // than the edited values intended for the next search. A normal GET form
      // remains available before JavaScript hydrates.
      event.currentTarget.reset();
      setQuery(input.q||"");
      router.push(searchHref(next));
    }}>
      <label htmlFor="library-search-query" className={styles.label}>Từ khóa</label>
      <div className={styles.queryRow}><QuerySuggestions id="library-search-query" value={query} onChange={setQuery}/><button type="submit">Tìm kiếm</button></div>
      <div className={styles.filters}>
        <label>Loại tài liệu<select name="type" defaultValue={input.type||""}><option value="">Tất cả loại</option>{ACTIVE_LIBRARY_TYPES.map(type=><option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></label>
        <label>Môn học<select name="subject" defaultValue={input.subject||""}><option value="">Tất cả môn</option>{facets.subjects.map(subject=><option key={subject.id} value={subject.slug}>{subject.name}</option>)}</select></label>
        <label>Khối lớp<select name="grade" defaultValue={input.grade||""}><option value="">Tất cả khối</option>{["10","11","12","Khác"].map(grade=><option key={grade} value={grade}>{grade==="Khác"?"Khác / dùng chung":`Lớp ${grade}`}</option>)}</select></label>
        <label>Chủ đề<select name="topic" defaultValue={input.topic||""}><option value="">Tất cả chủ đề</option>{facets.topics.map(topic=><option key={topic} value={topic}>{topic}</option>)}</select></label>
        <label>Sắp xếp<select name="sort" defaultValue={input.sort||"relevance"}><option value="relevance">Liên quan nhất</option><option value="newest">Mới nhất</option><option value="views">Xem nhiều</option><option value="likes">Được quan tâm nhiều</option><option value="az">Tên A–Z</option></select></label>
      </div>
      {input.tag&&<input type="hidden" name="tag" value={input.tag}/>}
      <Link href="/tim-kiem" className={styles.clear}>Xóa bộ lọc</Link>
    </form>
    <p className={styles.summary} aria-live="polite">{result.total} tài liệu{input.q?` cho “${input.q}”`:" phù hợp"}. Tìm kiếm hỗ trợ từ khóa có dấu hoặc không dấu.</p>
    {result.items.length?<div className="result-grid">{result.items.map(item=><Link key={item.id} href={getItemHref(item)} className={`result-card ${["video","album"].includes(item.type)?"result-card-media":""}`}>
      <div className="result-cover real-cover-wrap"><ContentThumbnail item={item}/></div><h3>{item.title}</h3><p>{item.author}</p>
      <div className={styles.resultMeta}><span>{TYPE_LABELS[item.type]}</span><span><Eye size={13}/>{item.views}</span></div>
    </Link>)}</div>:<div className={styles.empty}><strong>Không tìm thấy tài liệu phù hợp.</strong><p>Thử từ khóa ngắn hơn hoặc bỏ bớt bộ lọc.</p></div>}
    <Pagination page={result.page} totalPages={result.totalPages} href={page=>searchHref(input,page)}/>
  </section>;
}
