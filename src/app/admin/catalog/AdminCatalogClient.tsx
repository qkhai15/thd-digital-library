"use client";
import Link from 'next/link';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {slugify} from '@/lib/library-url';
import type {LibraryCollection,LibraryItem,LibrarySubject} from '@/lib/library-types';

type Form={id:number;title:string;slug:string;description:string;cover_url:string;status:string;sort_order:number;is_featured:boolean;item_ids:number[]};
const empty:Form={id:0,title:'',slug:'',description:'',cover_url:'',status:'draft',sort_order:0,is_featured:false,item_ids:[]};
export default function AdminCatalogClient(){
  const [subjects,setSubjects]=useState<LibrarySubject[]>([]);const [collections,setCollections]=useState<LibraryCollection[]>([]);const [items,setItems]=useState<LibraryItem[]>([]);
  const [subject,setSubject]=useState({id:0,name:'',slug:'',is_active:true,sort_order:0});const [form,setForm]=useState<Form>(empty);const [selected,setSelected]=useState('');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{const responses=await Promise.all(['/api/admin/subjects','/api/admin/collections','/api/admin/documents'].map(url=>fetch(url)));if(responses.some(r=>!r.ok))throw new Error('Không tải được phân loại.');const [a,b,c]=await Promise.all(responses.map(r=>r.json()));setSubjects(a);setCollections(b);setItems(c);},[]);
  useEffect(()=>{let cancelled=false;void Promise.all(['/api/admin/subjects','/api/admin/collections','/api/admin/documents'].map(url=>fetch(url))).then(async responses=>{if(responses.some(response=>!response.ok))throw new Error('Không tải được phân loại.');return Promise.all(responses.map(response=>response.json()));}).then(([a,b,c])=>{if(!cancelled){setSubjects(a);setCollections(b);setItems(c);}}).catch(()=>{if(!cancelled)setMessage('Không tải được phân loại.');});return()=>{cancelled=true;};},[]);
  async function save(kind:'subjects'|'collections',data:Record<string,unknown>){setBusy(true);setMessage('');try{const response=await fetch(`/api/admin/${kind}${data.id?'/'+data.id:''}`,{method:data.id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.message);await load();setMessage('Đã lưu.');return true;}catch(error){setMessage(error instanceof Error?error.message:'Không thể lưu.');return false;}finally{setBusy(false);}}
  async function submitSubject(event:FormEvent){event.preventDefault();if(await save('subjects',{...subject,slug:subject.slug||slugify(subject.name)}))setSubject({id:0,name:'',slug:'',is_active:true,sort_order:0});}
  async function submitCollection(event:FormEvent){event.preventDefault();if(await save('collections',{...form,slug:form.slug||slugify(form.title)}))setForm(empty);}
  function move(index:number,delta:number){setForm(previous=>{const ids=[...previous.item_ids];const next=index+delta;if(next>=0&&next<ids.length)[ids[index],ids[next]]=[ids[next],ids[index]];return {...previous,item_ids:ids};});}
  return <main className="admin-page"><header className="admin-topbar"><div><h1>Phân loại & bộ sưu tập</h1><p>Quản lý môn học và nhóm tài liệu; URL đã lưu được giữ nguyên.</p></div><Link href="/admin" className="admin-top-link">Quản trị tài liệu</Link></header>
    {message&&<p className="admin-message" role="status">{message}</p>}
    <section className="admin-card"><h2>Môn học</h2><form className="admin-form" onSubmit={submitSubject}>
      <label>Tên môn<input required maxLength={150} value={subject.name} onChange={e=>setSubject({...subject,name:e.target.value})}/></label>
      <label>Slug môn<input value={subject.slug} disabled={Boolean(subject.id)} placeholder="Tự tạo từ tên môn" onChange={e=>setSubject({...subject,slug:e.target.value})}/></label>
      <label>Thứ tự môn<input type="number" min={0} value={subject.sort_order} onChange={e=>setSubject({...subject,sort_order:Number(e.target.value)})}/></label>
      <label><input type="checkbox" checked={subject.is_active} onChange={e=>setSubject({...subject,is_active:e.target.checked})}/>Hiện trong danh sách môn</label>
      <button disabled={busy} type="submit">{subject.id?'Cập nhật môn':'Thêm môn'}</button><button type="button" onClick={()=>setSubject({id:0,name:'',slug:'',is_active:true,sort_order:0})}>Hủy sửa môn</button>
    </form><ul>{subjects.map(row=><li key={row.id}>{row.name} {!row.is_active&&'(ẩn)'} <button disabled={busy} onClick={()=>setSubject({...row})}>Sửa môn {row.name}</button></li>)}</ul></section>
    <section className="admin-card"><h2>Bộ sưu tập</h2><form className="admin-form" onSubmit={submitCollection}>
      <label>Tên bộ sưu tập<input required maxLength={255} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
      <label>Slug bộ sưu tập<input disabled={Boolean(form.id)} value={form.slug} placeholder="Tự tạo từ tên" onChange={e=>setForm({...form,slug:e.target.value})}/></label>
      <label className="admin-span-2">Mô tả bộ sưu tập<textarea rows={3} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
      <label>URL ảnh bộ sưu tập (tùy chọn)<input value={form.cover_url} onChange={e=>setForm({...form,cover_url:e.target.value})}/></label>
      <label>Trạng thái bộ sưu tập<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="draft">Bản nháp</option><option value="review">Chờ duyệt</option><option value="published">Đã xuất bản</option><option value="archived">Lưu trữ</option></select></label>
      <label>Thứ tự bộ sưu tập<input type="number" min={0} value={form.sort_order} onChange={e=>setForm({...form,sort_order:Number(e.target.value)})}/></label>
      <label><input type="checkbox" checked={form.is_featured} onChange={e=>setForm({...form,is_featured:e.target.checked})}/>Bộ sưu tập nổi bật</label>
      <div className="admin-span-2"><label>Chọn tài liệu<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Chọn một tài liệu</option>{items.filter(item=>!form.item_ids.includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.title} — {item.status}</option>)}</select></label><button type="button" onClick={()=>{if(selected)setForm({...form,item_ids:[...form.item_ids,Number(selected)]});setSelected('');}}>Thêm vào bộ sưu tập</button>
        <ol>{form.item_ids.map((id,index)=><li key={id}>{items.find(item=>item.id===id)?.title||`Tài liệu #${id}`} <button type="button" disabled={index===0} aria-label={`Đưa tài liệu ${index+1} lên`} onClick={()=>move(index,-1)}>↑</button> <button type="button" disabled={index===form.item_ids.length-1} aria-label={`Đưa tài liệu ${index+1} xuống`} onClick={()=>move(index,1)}>↓</button> <button type="button" onClick={()=>setForm({...form,item_ids:form.item_ids.filter(value=>value!==id)})}>Bỏ khỏi bộ sưu tập</button></li>)}</ol>
      </div><button type="submit" disabled={busy}>{form.id?'Cập nhật bộ sưu tập':'Tạo bộ sưu tập'}</button><button type="button" onClick={()=>setForm(empty)}>Hủy sửa bộ sưu tập</button>
    </form><ul>{collections.map(row=><li key={row.id}><b>{row.title}</b> — {row.status} <button disabled={busy} onClick={()=>setForm({...empty,...row,cover_url:row.cover_url||'',item_ids:row.item_ids||[]})}>Sửa bộ sưu tập {row.title}</button> {row.status==='published'&&<Link href={`/bo-suu-tap/${row.slug}`}>Mở công khai</Link>}</li>)}</ul></section>
  </main>;
}
