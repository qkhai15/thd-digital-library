"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getItemHref } from "@/lib/library-url";
import styles from "./SearchExperience.module.css";

type Suggestion={id:number;title:string;author:string;type:string};
type Props={value:string;onChange:(value:string)=>void;name?:string;id?:string;placeholder?:string;required?:boolean;autoFocus?:boolean;label?:string};
export default function QuerySuggestions({value,onChange,name="q",id,placeholder="Tên tài liệu, tác giả, môn học, từ khóa...",required,autoFocus,label="Từ khóa tìm kiếm"}:Props) {
  const generated=useId();const listId=`${generated}-suggestions`;
  const [response,setResponse]=useState<{q:string;items:Suggestion[]}>({q:"",items:[]});
  const [open,setOpen]=useState(false);const [active,setActive]=useState(-1);
  const router=useRouter();const query=value.trim();const items=response.q===query?response.items:[];
  useEffect(()=>{
    if(query.length<2)return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try{
        const res=await fetch(`/api/search/suggestions?q=${encodeURIComponent(query.slice(0,120))}`,{signal:controller.signal});
        if(!res.ok)return;
        const data=await res.json();
        if(!controller.signal.aborted)setResponse({q:query,items:Array.isArray(data.items)?data.items.slice(0,6):[]});
      }catch{/* Suggestions are optional; the explicit search form remains usable. */}
    },250);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[query]);
  const expanded=open&&items.length>0;
  const activeOption=active>=0&&active<items.length?active:-1;
  return <div className={styles.suggestions} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
    <input id={id} name={name} value={value} maxLength={120} required={required} autoFocus={autoFocus}
      aria-label={label} placeholder={placeholder} autoComplete="off" role="combobox" aria-autocomplete="list"
      aria-expanded={expanded} aria-controls={expanded?listId:undefined} aria-activedescendant={expanded&&activeOption>=0?`${listId}-${activeOption}`:undefined}
      onFocus={()=>setOpen(true)} onChange={event=>{onChange(event.target.value);setOpen(true);setActive(-1);}}
      onKeyDown={event=>{
        if(event.key==="Escape"){setOpen(false);setActive(-1);return;}
        if(items.length&&["ArrowDown","ArrowUp"].includes(event.key)){
          event.preventDefault();setOpen(true);setActive(event.key==="ArrowDown"?(activeOption+1)%items.length:(activeOption<=0?items.length-1:activeOption-1));
        }
        if(event.key==="Enter"&&expanded&&activeOption>=0){event.preventDefault();setOpen(false);router.push(getItemHref(items[activeOption]));}
      }}/>
    {expanded&&<ul id={listId} role="listbox" aria-label="Gợi ý tài liệu" className={styles.suggestionList}>
      {items.map((item,index)=><li key={item.id} role="option" id={`${listId}-${index}`} aria-selected={active===index}>
        <Link href={getItemHref(item)} onClick={()=>setOpen(false)} className={active===index?styles.selected:undefined}>
          <strong>{item.title}</strong>{item.author&&<small>{item.author}</small>}
        </Link>
      </li>)}
    </ul>}
  </div>;
}
