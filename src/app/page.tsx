import LibraryShell from "@/components/LibraryShell";
import { DocumentSection, Popular, WallSlider } from "@/components/HomeClient";
import {
  getItemsByType,
  getLatestItems,
  getPopularItems,
  getWallBanners,
} from "@/lib/library-repository";
import type { LibraryType } from "@/lib/library-types";
import {homepageDiscovery} from '@/lib/site-settings';
import {getCollections,getSubjects} from '@/lib/catalog';
import {getRecommendedItems} from '@/lib/discovery';
import {CollectionCards,GradeLinks,SubjectLinks,DiscoveryItems} from '@/components/DiscoverySections';

export const dynamic = "force-dynamic";

const sections: { title: string; type: LibraryType }[] = [
  { title: "Sách giấy", type: "sach-giay" },
  { title: "Sách điện tử", type: "sach-dien-tu" },
  { title: "Sách nói", type: "sach-noi" },
  { title: "Video", type: "video" },
  { title: "Album ảnh", type: "album" },
  { title: "Tài liệu khác", type: "tai-lieu-khac" },
];

export default async function HomePage() {
  const [discovery,popular,latest,banners,...groups]=await Promise.all([
    homepageDiscovery(),getPopularItems(8),getLatestItems(10),getWallBanners(),
    ...sections.map(section=>getItemsByType(section.type,10)),
  ]);
  const [collections,subjects,recommended]=await Promise.all([
    discovery.collections?getCollections({featured:!discovery.featured_collection_ids.length,limit:discovery.featured_collection_ids.length?500:6}):Promise.resolve([]),
    discovery.subjects?getSubjects():Promise.resolve([]),
    discovery.recommended?getRecommendedItems():Promise.resolve([]),
  ]);
  const selectedCollections=discovery.featured_collection_ids.length?discovery.featured_collection_ids.flatMap(id=>collections.filter(collection=>collection.id===id)):collections;
  return (
    <LibraryShell>
      <main>
        <h1 className="screen-reader-heading">Thư viện điện tử THPT Trần Hưng Đạo - Thanh Xuân</h1>
        <Popular items={popular} />

        <div className="container content-container">
          <DocumentSection
            title="Sách mới thêm"
            type="sach-dien-tu"
            items={latest}
            href="/tai-lieu/moi-nhat"
          />

          <WallSlider banners={banners} />
          <CollectionCards collections={selectedCollections}/>
          {discovery.grades&&<GradeLinks/>}
          <SubjectLinks subjects={subjects}/>
          <DiscoveryItems title="Thư viện đề xuất" items={recommended}/>

          {sections.map((section, index) => (
            <DocumentSection
              key={section.type}
              title={section.title}
              type={section.type}
              items={groups[index] ?? []}
            />
          ))}
        </div>
      </main>
    </LibraryShell>
  );
}
