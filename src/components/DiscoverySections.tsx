import Link from 'next/link';
import Image from '@/components/ContentImage';
import ContentThumbnail from './ContentThumbnail';
import {getItemHref} from '@/lib/library-url';
import type {LibraryCollection,LibraryItem,LibrarySubject} from '@/lib/library-types';
import styles from './DiscoverySections.module.css';
export function CollectionCards({collections}:{collections:LibraryCollection[]}){
  if(!collections.length)return null;
  return <section className="library-section"><div className="section-header"><h2>Bộ sưu tập nổi bật</h2><Link href="/bo-suu-tap">Xem tất cả →</Link></div><div className={styles.collections}>{collections.map(collection=><Link className={styles.collection} href={`/bo-suu-tap/${collection.slug}`} key={collection.id}>{collection.cover_url&&<div className={styles.cover}><Image src={collection.cover_url} alt="" fill sizes="(max-width: 600px) 90vw, 400px"/></div>}<h3>{collection.title}</h3>{collection.description&&<p>{collection.description.slice(0,180)}</p>}<small>{collection.item_count||0} tài liệu</small></Link>)}</div></section>;
}
export function GradeLinks(){return <section className="library-section"><h2>Theo khối lớp</h2><div className={styles.links}>{['10','11','12','Khác'].map(grade=><Link href={`/khoi-lop/${encodeURIComponent(grade)}`} key={grade}>{grade==='Khác'?'Dùng chung':`Khối ${grade}`}</Link>)}</div></section>;}
export function SubjectLinks({subjects}:{subjects:LibrarySubject[]}){if(!subjects.length)return null;return <section className="library-section"><h2>Theo môn học</h2><div className={styles.links}>{subjects.map(subject=><Link key={subject.id} href={`/mon-hoc/${subject.slug}`}>{subject.name}</Link>)}</div></section>;}
export function DiscoveryItems({items,title}:{items:LibraryItem[];title:string}){if(!items.length)return null;return <section className="library-section"><h2>{title}</h2><div className="result-grid">{items.map(item=><Link className="result-card" key={item.id} href={getItemHref(item)}><div className="result-cover real-cover-wrap"><ContentThumbnail item={item}/></div><h3>{item.title}</h3><p>{item.author}</p></Link>)}</div></section>;}
