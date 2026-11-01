import LibraryShell from '@/components/LibraryShell';
import {GradeLinks,SubjectLinks} from '@/components/DiscoverySections';
import {getSubjects} from '@/lib/catalog';
import {publicMetadata} from '@/lib/public-metadata';
export const dynamic='force-dynamic';
export const metadata=publicMetadata({title:'Khám phá theo môn học và khối lớp',path:'/kham-pha'});
export default async function Page(){return <LibraryShell><main className="flow-page"><div className="container"><h1>Khám phá tài liệu</h1><GradeLinks/><SubjectLinks subjects={await getSubjects()}/></div></main></LibraryShell>;}
