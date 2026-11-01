import type {LibraryItem} from '@/lib/library-types';
import Link from 'next/link';
export default function DocumentMetadata({item}:{item:LibraryItem}) {
  const fields:[string,string|number|null|undefined][]=[
    ['Thể loại',item.category],['Hình thức',item.format],
    ['Nhà xuất bản',item.publisher],['Năm xuất bản',item.publication_year],['ISBN / mã định danh',item.isbn],
    ['Ngôn ngữ',item.language],['Số trang',item.page_count],
    ['Nguồn',item.source],['Quyền sử dụng',item.rights],['Số lượng',item.type==='sach-giay'?`${item.stock??0} cuốn`:null],
  ];
  return <div className="detail-fields">{fields.filter(([,value])=>value!==null&&value!==undefined&&value!=='').map(([label,value])=><p key={label}><b>{label}:</b> {value}</p>)}
    {item.class_level&&<p><b>Khối lớp:</b> <Link href={`/khoi-lop/${encodeURIComponent(item.class_level)}`}>{item.class_level==='Khác'?'Dùng chung / khác':item.class_level}</Link></p>}
    {item.subject_name&&<p><b>Môn học:</b> {item.subject_slug?<Link href={`/mon-hoc/${item.subject_slug}`}>{item.subject_name}</Link>:item.subject_name}</p>}
    {(['topics','tags'] as const).map(field=>Boolean(item[field]?.length)&&<p key={field}><b>{field==='topics'?'Chủ đề':'Từ khóa'}:</b> {item[field]!.map((value,index)=><span key={value}>{index>0?', ':''}<Link href={`/tim-kiem?${field==='topics'?'topic':'tag'}=${encodeURIComponent(value)}`}>{value}</Link></span>)}</p>)}
  </div>;
}
