import Link from 'next/link';
import LibraryShell from '@/components/LibraryShell';
import {getCollections} from '@/lib/catalog';
import {publicMetadata} from '@/lib/public-metadata';
export const dynamic='force-dynamic';
export const metadata=publicMetadata({title:'Bộ sưu tập thư viện',path:'/bo-suu-tap',description:'Các bộ sưu tập tài liệu do thư viện nhà trường tuyển chọn theo chủ đề và nhu cầu học tập.'});
export default async function Page(){const collections=await getCollections();return <LibraryShell><main className="flow-page"><div className="container results-card"><h1>Bộ sưu tập thư viện</h1>{collections.length?<div className="result-grid">{collections.map(collection=><Link className="result-card" href={`/bo-suu-tap/${collection.slug}`} key={collection.id}><h2>{collection.title}</h2><p>{collection.description}</p><p>{collection.item_count||0} tài liệu công khai</p></Link>)}</div>:<p>Các bộ sưu tập sẽ xuất hiện khi được thư viện xuất bản.</p>}</div></main></LibraryShell>;}
