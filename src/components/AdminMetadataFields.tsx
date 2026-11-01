"use client";
import {useEffect,useState} from 'react';
import type {LibraryItem,LibrarySubject} from '@/lib/library-types';
export type MetadataForm={publisher:string;publication_year:string;isbn:string;language:string;page_count:string;subject_id:string;topics:string[];tags:string[];source:string;rights:string};
export const EMPTY_METADATA:MetadataForm={publisher:'',publication_year:'',isbn:'',language:'',page_count:'',subject_id:'',topics:[],tags:[],source:'',rights:''};
export function metadataForm(item:Partial<LibraryItem>):MetadataForm {
  return {publisher:item.publisher||'',publication_year:String(item.publication_year??''),isbn:item.isbn||'',language:item.language||'',page_count:String(item.page_count??''),subject_id:String(item.subject_id??''),topics:item.topics||[],tags:item.tags||[],source:item.source||'',rights:item.rights||''};
}
export default function AdminMetadataFields({value,onChange}:{value:MetadataForm;onChange:(patch:Partial<MetadataForm>)=>void}) {
  const [subjects,setSubjects]=useState<LibrarySubject[]>([]);
  const [error,setError]=useState('');
  useEffect(()=>{let cancelled=false;void fetch('/api/admin/subjects').then(async response=>{if(!response.ok)throw new Error();const rows=await response.json();if(!cancelled)setSubjects(rows);}).catch(()=>{if(!cancelled)setError('Chưa tải được môn học. Hãy mở lại biểu mẫu hoặc kiểm tra kết nối.');});return()=>{cancelled=true;};},[]);
  return <>
    <h3 className="admin-span-2">Thông tin thư mục (không bắt buộc)</h3>
    <label>Nhà xuất bản<input maxLength={255} value={value.publisher} onChange={event=>onChange({publisher:event.target.value})}/></label>
    <label>Năm xuất bản<input type="number" min={1} max={9999} value={value.publication_year} onChange={event=>onChange({publication_year:event.target.value})}/></label>
    <label>ISBN / mã định danh<input maxLength={32} value={value.isbn} onChange={event=>onChange({isbn:event.target.value})}/></label>
    <label>Ngôn ngữ<input maxLength={80} value={value.language} onChange={event=>onChange({language:event.target.value})}/></label>
    <label>Số trang<input type="number" min={1} max={1000000} value={value.page_count} onChange={event=>onChange({page_count:event.target.value})}/></label>
    <label>Môn học<select value={value.subject_id} onChange={event=>onChange({subject_id:event.target.value})}><option value="">Chưa phân môn</option>{subjects.map(subject=><option key={subject.id} value={subject.id} disabled={!subject.is_active&&String(subject.id)!==value.subject_id}>{subject.name}{!subject.is_active?' (đã ẩn)':''}</option>)}</select></label>
    {error&&<p className="admin-span-2" role="status">{error}</p>}
    <label>Chủ đề (mỗi dòng một mục)<textarea rows={3} value={value.topics.join('\n')} onChange={event=>onChange({topics:event.target.value.split('\n')})}/></label>
    <label>Từ khóa (mỗi dòng một mục)<textarea rows={3} value={value.tags.join('\n')} onChange={event=>onChange({tags:event.target.value.split('\n')})}/></label>
    <label>Nguồn<input maxLength={2000} value={value.source} onChange={event=>onChange({source:event.target.value})}/></label>
    <label>Quyền sử dụng<input maxLength={2000} value={value.rights} onChange={event=>onChange({rights:event.target.value})}/></label>
  </>;
}
