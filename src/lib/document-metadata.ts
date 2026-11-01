import { cleanText } from '@/lib/backend-utils';

function optionalInt(value: unknown, max: number) {
  if(value === undefined || value === null || value === '') return null;
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<1||number>max) throw new Error('Metadata số không hợp lệ.');
  return number;
}
export function metadataTerms(value: unknown): string[] {
  if(value == null) return [];
  if(!Array.isArray(value)||value.length>30||value.some(term=>typeof term!=='string'||term.length>100)) throw new Error('Chủ đề/từ khóa tối đa 30 mục, mỗi mục 100 ký tự.');
  return [...new Map(value.map(term=>cleanText(term,100)).filter(Boolean).map(term=>[term.toLocaleLowerCase('vi-VN'),term])).values()];
}
export function documentMetadata(body: Record<string,unknown>) {
  return {
    publisher:cleanText(body.publisher,255)||null,publication_year:optionalInt(body.publication_year,9999),
    isbn:cleanText(body.isbn,32)||null,language:cleanText(body.language,80)||null,page_count:optionalInt(body.page_count,1000000),
    subject_id:optionalInt(body.subject_id,2147483647),topics:metadataTerms(body.topics),tags:metadataTerms(body.tags),
    source:cleanText(body.source,2000)||null,rights:cleanText(body.rights,2000)||null,
  };
}
export const metadataColumns=['publisher','publication_year','isbn','language','page_count','subject_id','topics','tags','source','rights'] as const;
