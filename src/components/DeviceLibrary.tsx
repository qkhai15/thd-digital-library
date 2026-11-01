'use client';
import Link from 'next/link';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {Bookmark} from 'lucide-react';
import {clearRecent,emptyShelfSnapshot,rememberDocument,removeSaved,shelfSnapshot,subscribeShelf,toggleSaved,type LibraryShelf} from '@/lib/browser-library';
import type {LibraryItem} from '@/lib/library-types';
import {getItemHref} from '@/lib/library-url';
import ContentThumbnail from './ContentThumbnail';

export function SaveDocument({id}:{id:number}){
  const saved=useSyncExternalStore(subscribeShelf,()=>shelfSnapshot('saved'),emptyShelfSnapshot);
  const [message,setMessage]=useState('');
  useEffect(()=>{if(new URLSearchParams(window.location.search).get('preview')!=='admin')rememberDocument(id);},[id]);
  return <><button className="action-chip" aria-pressed={saved.includes(id)} onClick={()=>setMessage(toggleSaved(id)?'':'Trình duyệt không cho phép lưu trên thiết bị này.')}><Bookmark size={17} fill={saved.includes(id)?'currentColor':'none'}/>{saved.includes(id)?'Đã lưu để đọc sau':'Lưu để đọc sau'}</button>{message&&<span role="status">{message}</span>}</>;
}
export function DeviceLibrary({shelf}:{shelf:LibraryShelf}){
  const ids=useSyncExternalStore(subscribeShelf,()=>shelfSnapshot(shelf),emptyShelfSnapshot);
  const [result,setResult]=useState<{key:string;items:LibraryItem[];error:string}|null>(null);
  const [retry,setRetry]=useState(0);
  const key=ids.join(',');
  useEffect(()=>{
    if(!key)return;
    const controller=new AbortController();
    fetch(`/api/library/selection?ids=${key}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if(!response.ok)throw new Error();
      const items=await response.json();
      if(!Array.isArray(items))throw new Error();
      if(!controller.signal.aborted)setResult({key,items,error:''});
    }).catch(()=>{if(!controller.signal.aborted)setResult({key,items:[],error:'Không thể tải danh sách. Vui lòng tải lại trang.'});});
    return ()=>controller.abort();
  },[key,retry]);
  const loaded=result?.key===key;
  const items=loaded?result.items:[];
  const missing=loaded&&!result.error?ids.filter(id=>!items.some(item=>item.id===id)):[];
  return <section className="library-section">
    <div className="section-header"><h2>{shelf==='saved'?'Tài liệu đã lưu':'Đã xem gần đây'}</h2>{shelf==='recent'&&ids.length>0&&<button className="action-chip" onClick={clearRecent}>Xóa lịch sử</button>}</div>
    <p className="muted">Danh sách chỉ lưu trên trình duyệt này. {shelf==='saved'?'Tối đa 100 tài liệu.':'Tối đa 20 tài liệu.'}</p>
    {!key?<p>Chưa có tài liệu.</p>:!loaded?<p role="status">Đang tải tài liệu…</p>:result.error?<div><p role="alert">{result.error}</p><button className="action-chip" onClick={()=>setRetry(value=>value+1)}>Thử tải lại danh sách</button></div>:<>
      <div className="result-grid">{items.map(item=><article className="result-card" key={item.id}><Link href={getItemHref(item)}><div className="result-cover real-cover-wrap"><ContentThumbnail item={item}/></div><h3>{item.title}</h3><p>{item.author}</p></Link>{shelf==='saved'&&<button className="action-chip" onClick={()=>removeSaved(item.id)}>Bỏ lưu {item.title}</button>}</article>)}</div>
      {!!missing.length&&<div><p>{missing.length} tài liệu hiện không còn công khai.</p>{shelf==='saved'&&<button className="action-chip" onClick={()=>missing.forEach(removeSaved)}>Bỏ lưu tài liệu không còn công khai</button>}</div>}
    </>}
  </section>;
}
