import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';

// Use a fresh Chrome profile. Never attach to the administrator's existing browser.
// Credentials are runtime-only; do not enable HAR, tracing, request-body or cookie logging.
const env = { ...(process.env.TEST_ENV_FILE ? dotenv.parse(await readFile(process.env.TEST_ENV_FILE)) : {}), ...process.env };
const base = new URL(env.TEST_BASE_URL || 'http://127.0.0.1:3107');
assert.ok(!base.username && !base.password && ['http:', 'https:'].includes(base.protocol), 'Valid TEST_BASE_URL required.');
assert.ok(env.ADMIN_USERNAME && env.ADMIN_PASSWORD, 'ADMIN_USERNAME and ADMIN_PASSWORD required.');
const origin = new URL(env.TEST_ORIGIN || base.origin);
const localSelfSigned = env.TEST_ALLOW_LOCAL_SELF_SIGNED === 'true';
if (localSelfSigned) assert.ok(base.protocol === 'https:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Self-signed browser exception is restricted to local HTTPS QA.');
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(env.TEST_PLAYWRIGHT_MODULE || 'test-results/production-tools/node_modules/playwright'));
const resume = env.TEST_RESUME_REPORT ? JSON.parse(await readFile(env.TEST_RESUME_REPORT, 'utf8')) : null;
if (resume) assert.ok(/^[0-9a-f-]{36}$/i.test(resume.runId) && resume.owned?.documents?.length === 6, 'Resume requires this harness manifest with all six own QA documents.');
const runId = resume?.runId || randomUUID();
const prefix = `QA BROWSER ${runId}`;
const directory = path.join('test-results', `browser-production-${runId}`);
await mkdir(directory, { recursive: true });
const fixtureDirectory = path.resolve(env.TEST_FIXTURE_DIR || 'tests/browser-fixtures');
const evidence = [];
const owned = { documents: [], comments: [], borrows: [], news: [], banners: [], uploads: [] };
const requestFailures = [];
const browserErrors = [];
const transfers = [];
const mediaResponses = [];
let signingRequests = 0;
let currentStep = 'browser startup';
let failure;
let result = 'FAIL';
let browser;
let desktop;
let mobile;
if (resume) {
  for (const key of Object.keys(owned)) owned[key].push(...(resume.owned[key] || []));
  evidence.push(...resume.evidence); transfers.push(...resume.transfers); mediaResponses.push(...resume.mediaResponses);
  for (const item of owned.documents) assert.ok(item.title.startsWith(prefix), 'Resume document ownership prefix mismatch.');
}

async function persist() {
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({
    runId, result, failedStep: result === 'FAIL' ? currentStep : null, baseHost: base.host,
    scope: 'Real isolated Google Chrome desktop/mobile clicks; only newly-created manifest-owned QA records are changed. Uploaded files retained.',
    evidence, owned, browserErrors, requestFailures, transfers, mediaResponses, failure,
  }, null, 2));
}
async function step(name, action) {
  if (resume && !name.startsWith('resume ') && evidence.some(row => row.name === name && row.result === 'PASS')) {
    console.log(`REUSE completed own-manifest step: ${name}`); return;
  }
  currentStep = name;
  console.log(`RUN ${name}`); await persist();
  let timer;
  try { await Promise.race([action(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser step exceeded 180 seconds.')), 180000); })]); }
  finally { clearTimeout(timer); }
  evidence.push({ name, result: 'PASS' }); await persist();
}
const appResponse = (page, route, method, status = 200) => page.waitForResponse(response => {
  const url = new URL(response.url());
  return url.origin === base.origin && url.pathname === route && response.request().method() === method;
}, { timeout: route.startsWith('/api/admin/comments/') ? 15000 : 120000 }).then(response => { assert.equal(response.status(), status, `${method} ${route} response status`); return response; });
async function jsonAfter(page, route, method, action, status = 200) {
  const waiting = appResponse(page, route, method, status); await action();
  const response = await waiting;
  // Moderation/borrow mutations return no data used by this harness. Their
  // rendered state and stock are checked separately after the real click.
  return method === 'POST' ? response.json() : {};
}
async function goto(page, route) {
  const adminData = route === '/admin' ? '/api/admin/documents' : route === '/admin/news' ? '/api/admin/news' : route === '/admin/operations' ? '/api/admin/borrows' : null;
  // A visible streamed server shell does not yet guarantee React has attached
  // button handlers. Its client-only initial data fetch proves hydration.
  const ready = adminData ? appResponse(page, adminData, 'GET') : null;
  const response = await page.goto(new URL(route, base).toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(response.status(), 200, `Page ${route}`);
  await page.locator('body').waitFor();
  // App Router streams loading.tsx before the real page. Wait for its layout
  // instead of recording an empty loading screen as a responsive-page PASS.
  await page.locator(route.startsWith('/admin') ? '.admin-topbar, .admin-login-card' : '.main-header').waitFor();
  if (ready) await ready;
}
async function responsive(page, label) {
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(overflow.scroll <= overflow.width + 2, `${label}: viewport overflow ${overflow.scroll}/${overflow.width}`);
  await page.screenshot({ path: path.join(directory, `${label}.png`), fullPage: true, timeout: 15000, animations: 'disabled' });
}
async function configure(context) {
  if (origin.origin !== base.origin) {
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Forwarded-header simulation is local QA only.');
    await context.route(`${base.origin}/**`, async route => {
      const response = await route.fetch({ maxRedirects: 0, headers: {
        ...route.request().headers(), 'x-forwarded-host': origin.host,
        'x-forwarded-proto': origin.protocol.slice(0, -1), origin: origin.origin,
      } });
      const headers = response.headers();
      if (headers.location) {
        const redirected = new URL(headers.location, base);
        if (redirected.origin === origin.origin) headers.location = new URL(`${redirected.pathname}${redirected.search}`, base).toString();
      }
      // Preserve production response/cookie validation while keeping local QA navigation local.
      await route.fulfill({ response, headers });
    });
  }
  context.on('page', page => {
    page.on('pageerror', () => browserErrors.push({ page: new URL(page.url()).pathname, category: 'uncaught-browser-error' }));
    page.on('requestfailed', request => {
      // Redirected/cancelled navigation and media downloads can legitimately be aborted.
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      requestFailures.push({ host: new URL(request.url()).host, method: request.method(), category: 'network-failure' });
    });
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === base.origin && url.pathname === '/api/admin/upload/sign' && request.method() === 'POST') signingRequests++;
      if (request.method() === 'PATCH' && url.origin === base.origin && url.pathname.startsWith('/api/admin/comments/')) console.log(`RUN browser moderation PATCH ${url.pathname}`);
      if (['POST', 'PATCH'].includes(request.method()) && url.pathname.includes('/storage/v1/upload/resumable')) {
        transfers.push({ host: url.host, method: request.method(), bypassesApplication: url.origin !== base.origin });
      }
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (response.request().method() === 'PATCH' && url.origin === base.origin && url.pathname.startsWith('/api/admin/comments/')) console.log(`RESPONSE browser moderation ${response.status()} ${url.pathname}`);
      const type = response.headers()['content-type'] || '';
      if (/^(audio|video)\//.test(type) || type.startsWith('application/pdf')) {
        mediaResponses.push({ host: new URL(response.url()).host, status: response.status(), type, range: response.status() === 206 });
      }
    });
  });
}
async function login(page) {
  await goto(page, '/');
  await page.getByRole('link', { name: 'Đăng nhập', exact: true }).click();
  await page.waitForURL('**/admin/login');
  await page.getByLabel('Tài khoản', { exact: true }).fill(env.ADMIN_USERNAME);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(env.ADMIN_PASSWORD);
  const network = page.waitForRequest(request => new URL(request.url()).pathname === '/api/admin/login');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const request = await network;
  assert.equal(request.method(), 'POST');
  assert.match(request.headers()['content-type'], /^application\/x-www-form-urlencoded/);
  const body = new URLSearchParams(request.postData() || '');
  assert.equal(body.get('username'), env.ADMIN_USERNAME); assert.equal(body.get('password'), env.ADMIN_PASSWORD);
  await page.waitForURL('**/admin', { timeout: 60000 });
  await page.getByRole('heading', { name: 'Quản trị nội dung' }).waitFor();
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/admin/session')).json()).authenticated), true);
  await page.reload(); await page.getByRole('button', { name: 'Thêm nội dung', exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/admin/session')).json()).authenticated), true);
}
async function upload(page, input, filenames, expectedPreviews) {
  const files = Array.isArray(filenames) ? filenames : [filenames];
  const response = appResponse(page, '/api/admin/upload', 'POST', 201);
  await input.setInputFiles(files.map(name => path.resolve(fixtureDirectory, name)));
  const record = await (await response).json();
  owned.uploads.push({ url: record.url, size: record.size, retained: true }); await persist();
  if (expectedPreviews) await page.waitForFunction(count => document.querySelectorAll('.admin-gallery-item').length === count, expectedPreviews);
  else await page.waitForFunction(url => [...document.querySelectorAll('form.admin-form input')].some(input => input.value === url), record.url);
  await page.waitForFunction(() => !document.querySelector('.admin-form-actions button.admin-primary')?.disabled);
}
async function createDocument(page, type) {
  await goto(page, '/admin');
  await page.getByRole('button', { name: 'Thêm nội dung', exact: true }).click();
  const form = page.locator('form.admin-form');
  const title = `${prefix} ${type}`;
  await form.getByLabel('Tiêu đề *', { exact: true }).fill(title);
  await form.getByLabel('Loại nội dung').selectOption(type);
  await form.getByLabel('Tác giả / đơn vị', { exact: true }).fill('Temporary browser QA');
  await form.getByLabel('Thể loại', { exact: true }).fill('QA');
  if (type === 'sach-giay') await form.getByLabel('Số lượng sách').fill('2');
  if (type === 'album') await upload(page, form.locator('input[type="file"][multiple]'), ['test-1.jpg', 'test-2.jpg'], 2);
  else {
    await upload(page, form.locator('input[type="file"]').first(), 'test-1.jpg');
    if (type !== 'sach-giay') {
      const input = form.locator('input[type="file"]').nth(1);
      if (type === 'video') {
        const source = await readFile(path.join(fixtureDirectory, 'test.mp4'));
        const bytes = Buffer.alloc(16 * 1024 ** 2); source.copy(bytes);
        bytes.writeUInt32BE(bytes.length - source.length, source.length); bytes.write('free', source.length + 4);
        const filename = path.join(directory, 'browser-direct-16mib.mp4'); await writeFile(filename, bytes);
        const signed = appResponse(page, '/api/admin/upload/sign', 'POST', 201);
        const final = appResponse(page, '/api/admin/upload/finalize', 'POST', 200);
        await input.setInputFiles(filename); await signed;
        const record = await (await final).json();
        assert.equal(record.size, bytes.length); owned.uploads.push({ url: record.url, size: record.size, retained: true });
        assert.ok(transfers.some(request => request.method === 'PATCH' && request.bypassesApplication), 'Real Chrome TUS PATCH bypasses app.');
        await page.waitForFunction(() => !document.querySelector('.admin-form-actions button.admin-primary')?.disabled);
      } else await upload(page, input, type === 'sach-noi' ? 'test.wav' : 'test.pdf');
    }
  }
  const created = await jsonAfter(page, '/api/admin/documents', 'POST', () => form.getByRole('button', { name: 'Thêm nội dung', exact: true }).click(), 201);
  assert.equal(created.title, title); assert.equal(created.type, type);
  owned.documents.push({ id: created.id, title: created.title, type, retained: true }); await persist();
  return created;
}
async function openOwnDetail(page, item) {
  await goto(page, `/tai-lieu/${item.type}?q=${encodeURIComponent(prefix)}`);
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: item.title, exact: true }) }).click();
  await page.getByRole('heading', { name: item.title, exact: true, level: 1 }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.detail-actions-row button')?.disabled);
}
async function playMedia(page, selector) {
  const player = page.locator(selector); await player.waitFor();
  const box = await player.boundingBox();
  await player.click({ position: { x: 22, y: Math.max(10, box.height - 25) } });
  await player.evaluate(async media => { media.muted = true; await media.play(); });
  await page.waitForFunction(selector => document.querySelector(selector)?.currentTime > 0.05, selector, { timeout: 30000 });
  await player.evaluate(media => media.pause());
}

try {
  browser = await chromium.launch({ executablePath: env.TEST_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: env.TEST_HEADED !== 'true', args: ['--autoplay-policy=no-user-gesture-required'] });
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: localSelfSigned }); await configure(desktopContext); desktop = await desktopContext.newPage();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, ignoreHTTPSErrors: localSelfSigned }); await configure(mobileContext); mobile = await mobileContext.newPage();
  desktop.setDefaultTimeout(30000); mobile.setDefaultTimeout(30000);

  const items = [];
  if (!resume) {
  await step('desktop/mobile homepage navigation, search and responsive branding', async () => {
    for (const [page, label] of [[desktop, 'desktop'], [mobile, 'mobile']]) {
      await goto(page, '/'); await page.locator('.school-brand').waitFor();
      await page.waitForFunction(() => { const image = document.querySelector('.school-logo img'); return image?.complete && image.naturalWidth > 0; });
      await responsive(page, `${label}-home`);
      if (label === 'mobile') await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.locator('.main-nav').getByRole('link', { name: 'Sách mới', exact: true }).click();
      await page.getByRole('heading', { name: 'Sách mới thêm', exact: true }).waitFor(); await responsive(page, `${label}-newest`);
      await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
      await page.locator('.search-box input').fill('thư'); await page.locator('.search-box button').click();
      await page.getByRole('heading', { name: 'Tìm kiếm tài liệu' }).waitFor();
      for (const route of ['/tai-lieu/thinh-hanh', '/tai-lieu/sach-giay', '/tai-lieu/sach-dien-tu', '/tai-lieu/sach-noi', '/tai-lieu/video', '/tai-lieu/album', '/tai-lieu/tai-lieu-khac', '/tin-tuc']) {
        await goto(page, route); await responsive(page, `${label}-${route.split('/').at(-1)}`);
      }
    }
  });
  await step('real Admin form login POST, redirect, session refresh and desktop dashboard', async () => { await login(desktop); await responsive(desktop, 'desktop-admin'); });
  for (const type of ['sach-giay', 'sach-dien-tu', 'sach-noi', 'video', 'album', 'tai-lieu-khac']) await step(`Admin create ${type} via form and real file picker upload`, async () => items.push(await createDocument(desktop, type)));
  await step('Admin rejects over-limit video before signing or transmitting file bytes', async () => {
    await goto(desktop, '/admin'); await desktop.getByRole('button', { name: 'Thêm nội dung', exact: true }).click();
    const form = desktop.locator('form.admin-form'); await form.getByLabel('Loại nội dung').selectOption('video');
    const limits = await desktop.evaluate(async () => (await (await fetch('/api/admin/upload/limits')).json()));
    const filename = path.join(directory, 'oversized.mp4'); const file = await open(filename, 'w');
    try { await file.truncate(limits.maxBytes.video + 1); } finally { await file.close(); }
    const before = signingRequests; await form.locator('input[type="file"]').nth(1).setInputFiles(filename);
    await desktop.locator('.admin-message').filter({ hasText: /nén|Storage plan|giới hạn|vượt/i }).waitFor();
    assert.equal(signingRequests, before, 'Over-limit file must not request a signed capability.');
    await form.getByRole('button', { name: 'Hủy', exact: true }).click();
  });
  for (const page of [desktop, mobile]) for (const item of items) {
    const label = page === desktop ? 'desktop' : 'mobile';
    await step(`${label} detail/card click ${item.type} and working viewer`, async () => {
      await openOwnDetail(page, item);
      if (['sach-dien-tu', 'tai-lieu-khac'].includes(item.type)) await page.locator('.pdf-canvas-host[aria-busy="false"] canvas').waitFor({ timeout: 60000 });
      if (item.type === 'sach-noi') await playMedia(page, 'audio.media-audio');
      if (item.type === 'video') await playMedia(page, 'video.media-video');
      if (item.type === 'album') {
        await page.getByRole('button', { name: 'Ảnh tiếp theo', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'Chọn ảnh 2', exact: true }).getAttribute('aria-pressed'), 'true');
        await page.getByRole('button', { name: 'Phóng to ảnh album' }).click(); await page.locator('.lightbox').waitFor();
        await page.getByRole('button', { name: 'Đóng ảnh phóng to' }).click();
      }
      await responsive(page, `${label}-detail-${item.type}`);
    });
  }
  const paper = items.find(item => item.type === 'sach-giay');
  await step('real visitor likes, comment and borrow forms on own paper fixture', async () => {
    await openOwnDetail(desktop, paper);
    const liked = await jsonAfter(desktop, `/api/library/${paper.id}/like`, 'POST', () => desktop.getByRole('button', { name: /^Yêu thích/ }).click()); assert.equal(liked.liked, true);
    const unliked = await jsonAfter(desktop, `/api/library/${paper.id}/like`, 'POST', () => desktop.getByRole('button', { name: /^Đã yêu thích/ }).click()); assert.equal(unliked.liked, false);
    await desktop.getByPlaceholder('Tên của bạn', { exact: true }).fill(prefix); await desktop.getByPlaceholder('Nhập bình luận...', { exact: true }).fill('Temporary browser QA comment');
    const comment = await jsonAfter(desktop, `/api/library/${paper.id}/comments`, 'POST', () => desktop.getByRole('button', { name: 'Gửi bình luận' }).click(), 201); owned.comments.push({ id: comment.id, itemId: paper.id }); await persist();
    await desktop.getByRole('button', { name: 'Đăng ký mượn sách', exact: true }).click();
    await desktop.getByPlaceholder('Họ và tên *', { exact: true }).fill(prefix); await desktop.getByPlaceholder('Lớp (VD: 12A1)', { exact: true }).fill('QA');
    await jsonAfter(desktop, `/api/library/${paper.id}/borrow`, 'POST', () => desktop.getByRole('button', { name: 'Gửi yêu cầu mượn' }).click(), 400);
    await desktop.getByPlaceholder('Email', { exact: true }).fill('qa@example.invalid');
    const borrow = await jsonAfter(desktop, `/api/library/${paper.id}/borrow`, 'POST', () => desktop.getByRole('button', { name: 'Gửi yêu cầu mượn' }).click(), 201); owned.borrows.push({ id: borrow.id, itemId: paper.id }); await persist();
  });
  } else {
    items.push(...owned.documents);
    await step('resume own manifest with fresh real Admin login', async () => { await login(desktop); });
  }
  const paper = items.find(item => item.type === 'sach-giay');
  await step('Admin approve/return and comment moderation by real buttons, stock restored', async () => {
    const loaded = appResponse(desktop, '/api/admin/borrows', 'GET');
    await goto(desktop, '/admin/operations');
    await loaded;
    console.log('PASS operations initial borrow API loaded');
    let row = desktop.locator('tr').filter({ hasText: prefix }).filter({ hasText: paper.title });
    await row.waitFor();
    console.log('PASS operations own borrower row visible');
    if (await row.getByRole('button', { name: 'Duyệt', exact: true }).count()) {
      await jsonAfter(desktop, `/api/admin/borrows/${owned.borrows[0].id}`, 'PATCH', () => row.getByRole('button', { name: 'Duyệt', exact: true }).click());
      // The response precedes the Operations list reload. Wait for its rendered
      // next action so a slower public network cannot silently skip return.
      await row.getByRole('button', { name: 'Đã trả', exact: true }).waitFor();
    }
    if (await row.getByRole('button', { name: 'Đã trả', exact: true }).count()) {
      await jsonAfter(desktop, `/api/admin/borrows/${owned.borrows[0].id}`, 'PATCH', () => row.getByRole('button', { name: 'Đã trả', exact: true }).click());
    }
    await row.locator('td').nth(3).getByText('returned', { exact: true }).waitFor();
    console.log('PASS operations own borrow already returned or returned by UI');
    await desktop.getByRole('button', { name: /^Bình luận \(/ }).click(); row = desktop.locator('tr').filter({ hasText: prefix }).filter({ hasText: 'Temporary browser QA comment' });
    console.log('PASS operations comments tab clicked');
    if (await row.getByRole('button', { name: 'Hiện', exact: true }).count()) await jsonAfter(desktop, `/api/admin/comments/${owned.comments[0].id}`, 'PATCH', () => row.getByRole('button', { name: 'Hiện', exact: true }).click());
    await jsonAfter(desktop, `/api/admin/comments/${owned.comments[0].id}`, 'PATCH', () => row.getByRole('button', { name: 'Ẩn', exact: true }).click());
    await row.locator('td').nth(3).getByText('hidden', { exact: true }).waitFor();
    console.log('PASS operations own comment moderation');
    const stock = await desktop.evaluate(async id => (await (await fetch(`/api/library/${id}`, { signal: AbortSignal.timeout(10000) })).json()).stock, paper.id); assert.equal(stock, 2);
    console.log('PASS operations own paper stock=2');
    await responsive(desktop, 'desktop-operations');
  });
  await step('Admin edit own document and mobile Admin session/form responsive', async () => {
    await goto(desktop, '/admin'); await desktop.getByLabel('Tìm nội dung', { exact: true }).fill(paper.title);
    await desktop.locator('tr').filter({ hasText: paper.title }).getByRole('button', { name: 'Sửa', exact: true }).click();
    await desktop.locator('form.admin-form').getByLabel(/^Mô tả/).fill('Edited from real Chrome browser');
    await jsonAfter(desktop, `/api/admin/documents/${paper.id}`, 'PUT', () => desktop.locator('form.admin-form').getByRole('button', { name: 'Cập nhật', exact: true }).click());
    const edited = await desktop.evaluate(async id => (await (await fetch('/api/admin/documents', {signal:AbortSignal.timeout(10000)})).json()).find(item => item.id === id), paper.id); assert.equal(edited.description, 'Edited from real Chrome browser');
    await login(mobile); await responsive(mobile, 'mobile-admin');
    await mobile.getByRole('button', { name: 'Thêm nội dung', exact: true }).click(); await responsive(mobile, 'mobile-admin-form'); await mobile.getByRole('button', { name: 'Hủy', exact: true }).click();
  });
  await step('real news form create/image/edit/public article and wall banner image/form', async () => {
    let news = owned.news[0];
    let form;
    if (!news) {
    await goto(desktop, '/admin/news'); await desktop.getByRole('button', { name: 'Thêm bài viết', exact: true }).click();
    form = desktop.locator('form.admin-form');
    await form.getByLabel('Tiêu đề *', { exact: true }).fill(`${prefix} news`);
    await form.getByLabel('Nội dung *', { exact: true }).fill('Temporary real browser QA article.');
    await form.getByPlaceholder('Đoạn giới thiệu hiển thị ở danh sách tin tức.').fill('Temporary real browser QA.');
    await upload(desktop, form.locator('input[type="file"]'), 'test-2.jpg');
    news = await jsonAfter(desktop, '/api/admin/news', 'POST', () => form.getByRole('button', { name: 'Đăng bài', exact: true }).click(), 201);
    owned.news.push({ id: news.id, title: news.title, slug: news.slug, retained: true }); await persist();
    } else assert.ok(news.title.startsWith(prefix), 'Resume news ownership prefix mismatch.');
    await goto(mobile, '/tin-tuc'); await mobile.getByRole('link').filter({ has: mobile.getByRole('heading', { name: news.title, exact: true }) }).click();
    await mobile.getByRole('heading', { name: news.title, exact: true }).waitFor(); await responsive(mobile, 'mobile-news-detail');
    await goto(desktop, '/admin/news'); await desktop.getByLabel('Tìm tin', { exact: true }).fill(news.title);
    await desktop.locator('tr').filter({ hasText: news.title }).getByRole('button', { name: 'Sửa', exact: true }).click(); form = desktop.locator('form.admin-form');
    await form.getByPlaceholder('Đoạn giới thiệu hiển thị ở danh sách tin tức.').fill('Updated from real browser');
    await jsonAfter(desktop, `/api/admin/news/${news.id}`, 'PUT', () => form.getByRole('button', { name: 'Cập nhật', exact: true }).click());
    const updated = await desktop.evaluate(async id => (await (await fetch('/api/admin/news', {signal:AbortSignal.timeout(10000)})).json()).find(item => item.id === id), news.id); assert.equal(updated.excerpt, 'Updated from real browser');
    let banner = owned.banners[0];
    await goto(desktop, '/admin/operations'); await desktop.getByRole('button', { name: /^Báo tường \(/ }).click(); form = desktop.locator('form.admin-form');
    if (!banner) {
    await form.getByLabel('Tiêu đề', { exact: true }).fill(`${prefix} wall`);
    await upload(desktop, form.locator('input[type="file"]'), 'test-1.jpg');
    banner = await jsonAfter(desktop, '/api/admin/banners', 'POST', () => form.getByRole('button', { name: 'Thêm báo tường', exact: true }).click(), 201);
    owned.banners.push({ id: banner.id, title: banner.title, retained: true }); await persist();
    } else assert.ok(banner.title.startsWith(prefix), 'Resume banner ownership prefix mismatch.');
    const card = desktop.locator('.admin-banner-card').filter({ hasText: banner.title });
    await card.waitFor();
    if (await card.getByRole('button', { name: 'Ẩn', exact: true }).count()) await jsonAfter(desktop, `/api/admin/banners/${banner.id}`, 'PUT', () => card.getByRole('button', { name: 'Ẩn', exact: true }).click());
    owned.banners[0].hidden = true;
  });
  await step('archive only own QA content; optional delete confirmation on own disposable document', async () => {
    for (const item of items) {
      if (item.deleted || item.archived) continue;
      await goto(desktop, '/admin'); await desktop.getByLabel('Tìm nội dung', { exact: true }).fill(item.title);
      const row = desktop.locator('tr').filter({ hasText: item.title });
      if (item.type === 'tai-lieu-khac' && env.TEST_DELETE_OWN_QA === 'true') {
        await row.getByRole('button', { name: 'Xóa', exact: true }).click();
        await jsonAfter(desktop, `/api/admin/documents/${item.id}`, 'DELETE', () => desktop.getByRole('alertdialog').getByRole('button', { name: 'Xác nhận xóa', exact: true }).click());
        owned.documents.find(record => record.id === item.id).deleted = true;
      } else {
        await row.getByRole('button', { name: 'Sửa', exact: true }).click(); const form = desktop.locator('form.admin-form');
        await form.getByLabel('Trạng thái').selectOption('archived');
        await jsonAfter(desktop, `/api/admin/documents/${item.id}`, 'PUT', () => form.getByRole('button', { name: 'Cập nhật', exact: true }).click());
        owned.documents.find(record => record.id === item.id).archived = true;
      }
      await persist();
    }
    await goto(desktop, '/admin/news'); const news = owned.news[0]; await desktop.getByLabel('Tìm tin', { exact: true }).fill(news.title);
    await desktop.locator('tr').filter({ hasText: news.title }).getByRole('button', { name: 'Sửa', exact: true }).click(); const form = desktop.locator('form.admin-form');
    await form.getByLabel('Trạng thái').selectOption('archived');
    await jsonAfter(desktop, `/api/admin/news/${news.id}`, 'PUT', () => form.getByRole('button', { name: 'Cập nhật', exact: true }).click()); news.archived = true;
  });
  await step('real logout clears session on desktop and mobile', async () => {
    for (const page of [desktop, mobile]) {
      if (!await page.evaluate(async () => (await (await fetch('/api/admin/session')).json()).authenticated)) await login(page);
      await goto(page, '/admin'); await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click(); await page.waitForURL('**/admin/login');
      assert.equal(await page.evaluate(async () => (await (await fetch('/api/admin/session')).json()).authenticated), false);
    }
  });
  assert.equal(browserErrors.length, 0, 'No uncaught browser errors.');
  assert.ok(mediaResponses.some(response => response.range && response.type.startsWith('video/')), 'Real browser video Range response.');
  result = 'PASS'; await persist(); console.log(`PASS isolated real Chrome browser regression (${evidence.length} flows). Report: ${path.join(directory, 'report.json')}`);
} catch (error) {
  // Only selector/assertion context, scrubbed of runtime credentials. Never
  // persist request bodies, cookies, signed upload query strings or headers.
  let message = String(error?.message || error).split('\n').slice(0, 4).join('\n');
  for (const value of [env.ADMIN_PASSWORD, env.ADMIN_USERNAME, env.SESSION_SECRET, env.SUPABASE_SECRET_KEY, env.DATABASE_URL]) if (value) message = message.replaceAll(value, '[redacted]');
  failure = { category: error?.name || 'Error', message: message.replace(/https?:\/\/[^\s"']+\?[^\s"']*/g, '[URL query redacted]') };
  await persist();
  if (desktop && !desktop.isClosed()) await desktop.screenshot({ path: path.join(directory, 'failure-desktop.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  if (mobile && !mobile.isClosed()) await mobile.screenshot({ path: path.join(directory, 'failure-mobile.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  await persist(); console.error(`FAIL real Chrome browser regression at ${currentStep}. Report: ${path.join(directory, 'report.json')}`); process.exitCode = 1;
} finally { await Promise.race([browser?.close(), new Promise(resolve => setTimeout(resolve, 5000))]); }
