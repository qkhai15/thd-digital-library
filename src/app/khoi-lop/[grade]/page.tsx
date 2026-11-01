import Link from 'next/link';
import {notFound} from 'next/navigation';
import LibraryShell from '@/components/LibraryShell';
import {DiscoveryItems} from '@/components/DiscoverySections';
import {getTaxonomyItems} from '@/lib/discovery';
import {publicMetadata} from '@/lib/public-metadata';
export const dynamic='force-dynamic';
function gradeLabel(grade:string){if(!['10','11','12','Khác'].includes(grade))notFound();return grade==='Khác'?'dùng chung':`khối ${grade}`;}
export async function generateMetadata({params}:{params:Promise<{grade:string}>}){const {grade}=await params;return publicMetadata({title:`Tài liệu ${gradeLabel(grade)}`,path:`/khoi-lop/${encodeURIComponent(grade)}`});}
export default async function Page({params}:{params:Promise<{grade:string}>}){const {grade}=await params;const label=gradeLabel(grade);const items=await getTaxonomyItems('grade',grade);return <LibraryShell><main className="flow-page"><div className="container"><h1>Tài liệu {label}</h1><Link href={`/tim-kiem?grade=${encodeURIComponent(grade)}`}>Tìm kiếm và lọc toàn bộ tài liệu {label} →</Link>{items.length?<DiscoveryItems title="Tài liệu mới cập nhật" items={items}/>:<p>Chưa có tài liệu công khai cho khối này.</p>}</div></main></LibraryShell>;}
