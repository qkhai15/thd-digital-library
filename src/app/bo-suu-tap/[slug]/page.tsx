import Link from 'next/link';
import {cache} from 'react';
import {notFound} from 'next/navigation';
import LibraryShell from '@/components/LibraryShell';
import ContentThumbnail from '@/components/ContentThumbnail';
import Image from '@/components/ContentImage';
import {getCollection} from '@/lib/catalog';
import {getItemHref} from '@/lib/library-url';
import {publicMetadata} from '@/lib/public-metadata';
export const dynamic='force-dynamic';
const load=cache(async(slug:string)=>{if(!/^[a-z0-9-]{1,280}$/.test(slug))notFound();const collection=await getCollection(slug);if(!collection)notFound();return collection;});
type Props={params:Promise<{slug:string}>};
export async function generateMetadata({params}:Props){const collection=await load((await params).slug);return publicMetadata({title:collection.title,path:`/bo-suu-tap/${collection.slug}`,description:collection.description,image:collection.cover_url});}
export default async function Page({params}:Props){const collection=await load((await params).slug);return <LibraryShell><main className="flow-page"><div className="container results-card"><nav className="breadcrumb"><Link href="/">Trang chủ</Link><span>/</span><Link href="/bo-suu-tap">Bộ sưu tập</Link></nav><h1>{collection.title}</h1>{collection.description&&<p>{collection.description}</p>}{collection.cover_url&&<Image src={collection.cover_url} alt={collection.title} width={900} height={300} style={{maxWidth:'100%',height:'auto'}}/>}<p>{collection.items.length} tài liệu công khai</p><div className="result-grid">{collection.items.map(item=><Link className="result-card" key={item.id} href={getItemHref(item)}><div className="result-cover real-cover-wrap"><ContentThumbnail item={item}/></div><h2>{item.title}</h2><p>{item.author}</p></Link>)}</div>{!collection.items.length&&<p>Bộ sưu tập đang cập nhật tài liệu.</p>}</div></main></LibraryShell>;}
