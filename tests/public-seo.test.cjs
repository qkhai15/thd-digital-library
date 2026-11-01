const test = require('node:test');
const assert = require('node:assert/strict');
const loader = require('./load-project.cjs');

test('public structured data connects the canonical library website to its school without invented contact details', () => {
  const seo = loader()('src/lib/public-metadata.ts');
  const structured = seo.publicStructuredData();
  assert.equal(structured['@context'], 'https://schema.org');
  const website = structured['@graph'].find(entity => entity['@type'] === 'WebSite');
  const school = structured['@graph'].find(entity => entity['@type'] === 'School');
  assert.equal(website.url, `${seo.PUBLIC_SITE_ORIGIN}/`);
  assert.equal(website.name, seo.PUBLIC_SITE_NAME);
  assert.equal(website.alternateName, 'Thư viện số THPT Trần Hưng Đạo - Thanh Xuân');
  assert.equal(website.publisher['@id'], school['@id']);
  assert.equal(school.name, 'Trường THPT Trần Hưng Đạo - Thanh Xuân');
  assert.equal(school.url, 'https://www.tranhungdaothanhxuan-hanoi.edu.vn/');
  assert.equal(school.logo, `${seo.PUBLIC_SITE_ORIGIN}/logo-thd.png`);
  assert.equal(website.inLanguage, 'vi-VN');
  assert.equal(school.address, undefined);
  assert.equal(school.telephone, undefined);
});

test('the public shell renders JSON-LD and its serializer cannot close the script element', () => {
  const React = require('react');
  const {renderToStaticMarkup} = require('react-dom/server');
  const load = loader({
    '@/components/StorageImage': ({src, alt, width, height}) => React.createElement('img', {src, alt, width, height}),
    '@/components/QuerySuggestions': () => null,
    'next/link': props => React.createElement('a', props),
    'next/navigation': {useRouter: () => ({push: () => {}})},
  });
  const seo = load('src/lib/public-metadata.ts');
  const unsafe = {name: '</script><script>alert("xss")</script>', description: 'Tiếng Việt & <b>thư viện</b>'};
  const encoded = seo.serializeStructuredData(unsafe);
  assert.doesNotMatch(encoded, /</);
  assert.deepEqual(JSON.parse(encoded), unsafe);
  const shell = load('src/components/LibraryShell.tsx').default;
  const markup = renderToStaticMarkup(React.createElement(shell, null, React.createElement('main', null, 'Public content')));
  const scripts = [...markup.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  assert.equal(scripts.length, 1);
  assert.deepEqual(JSON.parse(scripts[0][1]), seo.publicStructuredData());
});

test('public metadata keeps canonical school host independently of previews and sanitizes descriptions/images', () => {
  const seo = loader()('src/lib/public-metadata.ts');
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://preview.example';
  try {
    const metadata = seo.publicMetadata({ title: 'Sách toán', path: '/tai-lieu/sach-dien-tu/sach-toan-12', description: '<b>Tra cứu</b>   sách\n toán', image: '//untrusted.example/image.png' });
    assert.equal(metadata.alternates.canonical, `${seo.PUBLIC_SITE_ORIGIN}/tai-lieu/sach-dien-tu/sach-toan-12`);
    assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
    assert.equal(metadata.description, 'Tra cứu sách toán');
    assert.equal(metadata.openGraph.images[0].url, `${seo.PUBLIC_SITE_ORIGIN}/logo-thd.png`);
    assert.equal(seo.metadataDescription('x'.repeat(500)).length, 180);
    for (const path of ['//evil.example/path', 'https://evil.example/path', '/\\evil.example/path']) assert.throws(() => seo.publicUrl(path));
    assert.equal(seo.publicUrl('/tin-tuc/a?x=1#fragment'), `${seo.PUBLIC_SITE_ORIGIN}/tin-tuc/a?x=1`);
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});

test('robots and response headers exclude Admin and internal APIs from indexing', async () => {
  const robots = loader()('src/app/robots.ts').default();
  assert.equal(robots.rules.allow, '/');
  assert.ok(robots.rules.disallow.includes('/admin'));
  assert.ok(robots.rules.disallow.includes('/api/'));
  assert.match(robots.sitemap, /^https:\/\/thuvien\.tranhungdaothanhxuan-hanoi\.edu\.vn\/sitemap\.xml$/);
  const config = loader()('next.config.ts').default;
  const headers = await config.headers();
  for (const source of ['/admin/:path*', '/api/:path*']) {
    assert.ok(headers.find(rule => rule.source === source).headers.some(header => header.key === 'X-Robots-Tag' && header.value.includes('noindex')));
  }
  assert.ok(headers.find(rule => rule.source === '/:path*').headers.some(header => header.key === 'X-Content-Type-Options'));
});

test('sitemap keyset pagination includes every published active document and news URL, with escaped XML', async () => {
  const calls = [];
  const first = Array.from({length: 1000}, (_, i) => ({id: i + 1, type: 'sach-dien-tu', title: `Tài liệu ${i + 1}`, updated_at: '2026-01-01T00:00:00Z'}));
  const sitemap = loader({'@/lib/db': {
    ensureSchema: async () => {},
    db: { query: async (sql, values) => {
      calls.push({sql, values});
      if (sql.includes('library_items')) return {rows: values[1] === 0 ? first : [{id: 1001, type: 'album', title: 'Album trường', updated_at: '2026-01-02T00:00:00Z'}]};
      return {rows: [{id: 2, slug: 'ngay-sach', updated_at: '2026-01-03T00:00:00Z'}]};
    }},
  }})('src/lib/public-sitemap.ts');
  const xml = await sitemap.getPublicSitemap();
  assert.match(xml, /\/tai-lieu\/sach-dien-tu\/tai-lieu-1000-1000<\/loc>/);
  assert.match(xml, /\/tai-lieu\/album\/album-truong-1001<\/loc>/);
  assert.match(xml, /\/tin-tuc\/ngay-sach<\/loc>/);
  assert.doesNotMatch(xml, /admin|ky-nang-song|bai-giang-dien-tu|localhost/);
  assert.equal(calls.length, 5);
  assert.match(xml,/\/bo-suu-tap\/ngay-sach<\/loc>/);
  assert.match(xml,/\/mon-hoc\/ngay-sach<\/loc>/);
  assert.match(xml,/\/khoi-lop\/12<\/loc>/);
  assert.doesNotMatch(xml,/\/da-luu/);
  assert.equal(calls[1].values[1], 1000);
  assert.match(calls[0].sql, /status='published'.*type=ANY/s);
  assert.match(calls[2].sql, /status='published'/);
  assert.ok(!calls[0].sql.includes('SELECT *'));
  assert.ok(!calls[0].values[0].includes('ky-nang-song'));
  const escaped = sitemap.serializeSitemap([{path: '/tin-tuc?a=1&b=2', lastModified: 'invalid'}]);
  assert.match(escaped, /a=1&amp;b=2/);
  assert.doesNotMatch(escaped, /<lastmod>/);
});

test('sitemap outages return retryable 503 without publishing partial URLs or database details', async () => {
  const route = loader({'@/lib/public-sitemap': {getPublicSitemap: async () => {throw new Error('postgresql://user:private@db.example/postgres');}}})('src/app/sitemap.xml/route.ts');
  const response = await route.GET();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await response.text(), /postgresql|private|db\.example/);
});
