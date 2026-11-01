import {cache} from 'react';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import LibraryShell from '@/components/LibraryShell';
import {DiscoveryItems} from '@/components/DiscoverySections';
import {getSubjects} from '@/lib/catalog';
import {getTaxonomyItems} from '@/lib/discovery';
import {publicMetadata} from '@/lib/public-metadata';
export const dynamic='force-dynamic';
const subjectBySlug=cache(async(slug:string)=>{const subject=(await getSubjects()).find(subject=>subject.slug===slug);if(!subject)notFound();return subject;});
export async function generateMetadata({params}:{params:Promise<{slug:string}>}){const {slug}=await params;const subject=await subjectBySlug(slug);return publicMetadata({title:`Tài liệu môn ${subject.name}`,description:`Sách và tài liệu môn ${subject.name} tại thư viện THPT Trần Hưng Đạo - Thanh Xuân.`,path:`/mon-hoc/${slug}`});}
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;const subject=await subjectBySlug(slug);const items=await getTaxonomyItems('subject',slug);return <LibraryShell><main className="flow-page"><div className="container"><h1>Tài liệu môn {subject.name}</h1><Link href={`/tim-kiem?subject=${encodeURIComponent(slug)}`}>Tìm kiếm và lọc toàn bộ tài liệu môn này →</Link>{items.length?<DiscoveryItems title="Tài liệu mới cập nhật" items={items}/>:<p>Chưa có tài liệu công khai cho môn học này.</p>}</div></main></LibraryShell>;}
