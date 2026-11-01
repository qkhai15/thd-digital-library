import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Public, read-only UI checks in an isolated Chrome profile. No auth, detail
// pages, request-body capture, HAR or traces: existing counters/data stay intact.
const base = new URL(process.env.TEST_BASE_URL || 'http://127.0.0.1:3107');
assert.ok(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password, 'Valid public TEST_BASE_URL required.');
const localSelfSigned = process.env.TEST_ALLOW_LOCAL_SELF_SIGNED === 'true';
if (localSelfSigned) assert.ok(base.protocol === 'https:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Self-signed exception is restricted to local HTTPS QA.');
const require = createRequire(import.meta.url);
const { chromium } = require(path.resolve(process.env.TEST_PLAYWRIGHT_MODULE || 'test-results/production-tools/node_modules/playwright'));
const directory = path.join('test-results', `browser-smoke-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const evidence = [];
const errors = [];
const assetFailures = [];
let currentStep = 'Chrome startup';
let result = 'FAIL';
let failure;
let browser;
let currentPage;

function safeURL(value) {
  try { const url = new URL(value); return { host: url.host, path: url.pathname }; }
  catch { return { host: 'invalid', path: '' }; }
}
async function persist() {
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({
    result, baseHost: base.host, scope: 'Read-only real isolated Google Chrome desktop/mobile public lists. No detail pages, authentication or database mutations.',
    failedStep: result === 'FAIL' ? currentStep : null, evidence, errors, assetFailures, failure,
  }, null, 2));
}
async function step(label, action) {
  currentStep = label;
  console.log(`RUN ${label}`);
  await persist();
  const details = await action();
  evidence.push({ label, result: 'PASS', ...details });
  await persist();
}
async function publicReady(page) {
  await page.locator('.main-header').waitFor({ timeout: 60000 });
  await page.locator('main').waitFor({ timeout: 60000 });
  // A streamed loading skeleton is not evidence that a list has rendered.
  await page.locator('main h1, main h2').first().waitFor({ timeout: 60000 });
}
async function clickLink(page, route) {
  const nav = page.locator('.main-nav');
  if (!await nav.locator(`a[href="${route}"]`).first().isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const link = nav.locator(`a[href="${route}"]`).first();
  await link.click();
  await page.waitForURL(url => url.pathname === route, { timeout: 60000 });
  await publicReady(page);
}
async function imageEvidence(page) {
  // Trigger lazy loading through real viewport scrolling, including long mobile
  // pages. Horizontal carousel items are checked when visible to the user.
  await page.evaluate(() => window.scrollTo(0, 0));
  const checked = new Map();
  for (let position = 0, passes = 0; passes < 70; passes++) {
    await page.evaluate(y => window.scrollTo(0, y), position);
    await page.waitForTimeout(140);
    const images = page.locator('img');
    const count = await images.count();
    for (let index = 0; index < count; index++) {
      const image = images.nth(index);
      const visible = await image.evaluate(el => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
        let parent = el.parentElement;
        while (parent) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
          if (['hidden', 'scroll', 'auto', 'clip'].includes(style.overflowX)) {
            const box = parent.getBoundingClientRect();
            if (r.right <= box.left || r.left >= box.right) return false;
          }
          parent = parent.parentElement;
        }
        return true;
      });
      if (!visible) continue;
      const key = await image.getAttribute('src');
      if (checked.has(key)) continue;
      await image.evaluate(async el => {
        await Promise.race([
          el.decode().catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 20000)),
        ]);
      });
      const state = await image.evaluate(el => ({ src: el.currentSrc || el.src, complete: el.complete, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, alt: el.alt }));
      assert.ok(state.complete && state.naturalWidth > 0 && state.naturalHeight > 0, `Broken/undecoded visible image: ${JSON.stringify(safeURL(state.src))}`);
      checked.set(key, { ...safeURL(state.src), naturalWidth: state.naturalWidth, naturalHeight: state.naturalHeight, alt: state.alt });
    }
    const metrics = await page.evaluate(() => ({ y: scrollY, height: innerHeight, full: document.documentElement.scrollHeight }));
    if (metrics.y + metrics.height >= metrics.full - 3) break;
    position = metrics.y + Math.max(250, Math.floor(metrics.height * 0.8));
    assert.ok(passes < 69, 'Lazy image scroll exceeded bounded page limit.');
  }
  assert.ok(checked.size > 0, 'No real decoded images found.');
  await page.evaluate(() => window.scrollTo(0, 0));
  return [...checked.values()];
}
async function videoEvidence(page) {
  const videos = page.locator('video');
  const result = [];
  for (let index = 0; index < Math.min(await videos.count(), 4); index++) {
    const video = videos.nth(index);
    await video.scrollIntoViewIfNeeded();
    await video.evaluate(el => el.play().catch(() => {}));
    await page.waitForFunction(index => {
      const el = document.querySelectorAll('video')[index];
      return el && (el.error || (el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0));
    }, index, { timeout: 45000 });
    const state = await video.evaluate(el => {
      el.pause();
      return { src: el.currentSrc || el.src, readyState: el.readyState, videoWidth: el.videoWidth, videoHeight: el.videoHeight, error: el.error?.code || null };
    });
    assert.ok(!state.error && state.readyState >= 2 && state.videoWidth > 0, `Video preview did not decode a frame: ${JSON.stringify(safeURL(state.src))}; media error ${state.error}`);
    result.push({ ...safeURL(state.src), readyState: state.readyState, videoWidth: state.videoWidth, videoHeight: state.videoHeight });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  return result;
}
async function capture(page, label) {
  const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(overflow.scrollWidth <= overflow.width + 2, `Horizontal viewport overflow: ${overflow.scrollWidth}/${overflow.width}`);
  const images = await imageEvidence(page);
  const videos = await videoEvidence(page);
  await page.screenshot({ path: path.join(directory, `${label}-viewport.png`), fullPage: false, animations: 'disabled', timeout: 15000 });
  await page.screenshot({ path: path.join(directory, `${label}-full.png`), fullPage: true, animations: 'disabled', timeout: 15000 });
  return { viewport: overflow, images, videos, cards: await page.locator('.book-card, .result-card, .video-card, .album-home-card, .news-list-card').count() };
}

try {
  browser = await chromium.launch({ executablePath: process.env.TEST_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const device of [{ name: 'desktop', viewport: { width: 1440, height: 1000 } }, { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }]) {
    const { name, ...options } = device;
    const context = await browser.newContext({ ...options, ignoreHTTPSErrors: localSelfSigned });
    const page = await context.newPage();
    currentPage = page;
    page.on('pageerror', () => errors.push({ category: 'uncaught-browser-error', page: safeURL(page.url()).path }));
    page.on('response', response => {
      const type = response.request().resourceType();
      if (response.status() >= 400 && ['image', 'media', 'script', 'stylesheet'].includes(type)) assetFailures.push({ ...safeURL(response.url()), status: response.status(), type });
    });
    await step(`${name} home images/video/album and responsive`, async () => {
      const response = await page.goto(base.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
      assert.equal(response.status(), 200, 'Home status');
      await publicReady(page);
      await page.getByRole('heading', { name: 'Tài liệu thịnh hành', exact: true }).waitFor();
      const proof = await capture(page, `${name}-home`);
      assert.ok(proof.images.some(item => item.path.includes('/uploads/') || item.path.includes('/storage/')), 'Home must show at least one actual Storage/legacy content image.');
      const albumImages = await page.locator('.album-home-slider img').count();
      if (albumImages) assert.ok(proof.images.some(item => /ảnh \d+/.test(item.alt)), 'Visible album gallery image decoded.');
      return proof;
    });
    await step(`${name} popular selection and wall lightbox real buttons`, async () => {
      const choices = page.locator('.popular-list-item');
      if (await choices.count() > 1) {
        await choices.nth(1).click();
        assert.ok((await choices.nth(1).getAttribute('class')).includes('active'), 'Popular selected card changes.');
        await page.locator('.popular-main-cover img').evaluate(el => el.decode());
      }
      const wall = page.locator('.wall-slide').first();
      let wallImage = false;
      if (await wall.count()) {
        await wall.scrollIntoViewIfNeeded();
        await wall.click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        const image = dialog.locator('img');
        await image.evaluate(el => el.decode());
        wallImage = await image.evaluate(el => el.naturalWidth > 0);
        assert.ok(wallImage, 'Wall lightbox image decoded.');
        await page.screenshot({ path: path.join(directory, `${name}-wall-lightbox.png`), fullPage: false, timeout: 15000 });
        await page.getByRole('button', { name: 'Đóng', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
      }
      return { wallImage };
    });
    await step(`${name} popular list via real view-all link`, async () => {
      await page.locator('.popular-heading a[href="/tai-lieu/thinh-hanh"]').click();
      await page.waitForURL('**/tai-lieu/thinh-hanh');
      await publicReady(page);
      return capture(page, `${name}-popular`);
    });
    for (const route of ['moi-nhat', 'sach-giay', 'sach-dien-tu', 'sach-noi', 'video', 'album', 'tai-lieu-khac']) {
      await step(`${name} navigation/list ${route}`, async () => {
        await clickLink(page, `/tai-lieu/${route}`);
        const proof = await capture(page, `${name}-${route}`);
        if (route === 'video' && await page.locator('video').count()) assert.ok(proof.videos.length > 0, 'Actual video preview frame decoded.');
        return proof;
      });
    }
    await step(`${name} news list navigation and images`, async () => {
      await clickLink(page, '/tin-tuc');
      return capture(page, `${name}-news`);
    });
    await step(`${name} search header button and real form`, async () => {
      await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
      await page.locator('.search-box input').fill('sách');
      await page.locator('.search-box').getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/tim-kiem' && url.searchParams.get('q') === 'sách', { timeout: 60000 });
      await publicReady(page);
      await page.locator('.search-page').waitFor();
      return capture(page, `${name}-search`);
    });
    await context.close();
  }
  assert.equal(errors.length, 0, 'No uncaught browser errors.');
  assert.equal(assetFailures.length, 0, 'No failed image/media/script/style responses.');
  result = 'PASS';
  await persist();
  console.log(`PASS real Chrome read-only visual smoke (${evidence.length} flows). Report: ${path.join(directory, 'report.json')}`);
} catch (error) {
  failure = { category: error?.name || 'Error', message: String(error?.message || error).split('\n').slice(0, 4).join('\n').replace(/https?:\/\/[^\s"']+\?[^\s"']*/g, '[URL query redacted]') };
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(directory, 'failure-viewport.png'), fullPage: false, timeout: 10000 }).catch(() => {});
  await persist();
  console.error(`FAIL real Chrome read-only visual smoke at ${currentStep}. Report: ${path.join(directory, 'report.json')}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
