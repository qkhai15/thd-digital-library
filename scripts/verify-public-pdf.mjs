import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Read real published content. Never upload a fixture or log credentials/cookies.
const base = new URL(process.env.TEST_BASE_URL || "https://thuvien.tranhungdaothanhxuan-hanoi.edu.vn");
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(path.resolve(process.env.TEST_PLAYWRIGHT_MODULE || "test-results/production-tools/node_modules/playwright"));
const directory = path.join("test-results", `pdf-public-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const report = { result: "FAIL", baseHost: base.host, scope: "Real Ngữ văn 12 PDF; Chromium/WebKit desktop/mobile emulation, not physical phones.", checks: [] };
const list = await (await fetch(new URL(`/api/library?q=${encodeURIComponent("Ngữ văn 12")}`, base))).json();
const item = list.items.find(item => item.title === "Ngữ văn 12 - Chuyên đề ôn tập");
assert.ok(item?.file_url, "Required real production document must exist.");
report.item = { id: item.id, title: item.title, fileUrl: item.file_url };
const inline = new URL(item.file_url, base); inline.searchParams.set("inline", "1");

async function painted(page, pageNumber) {
  const selector = `.pdf-canvas-host[data-rendered-page="${pageNumber}"][aria-busy="false"] canvas`;
  await page.waitForFunction(selector => {
    const canvas = document.querySelector(selector);
    return canvas && canvas.width > 0 && canvas.height > 0;
  }, selector, { timeout: 90000 });
  return page.locator(selector).evaluate(canvas => {
    const sample = document.createElement("canvas"); sample.width = 64; sample.height = 64;
    const context = sample.getContext("2d"); context.drawImage(canvas, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    let ink = 0; let fingerprint = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 200 && pixels[i + 3] > 0) ink++;
      fingerprint = (Math.imul(fingerprint, 31) + pixels[i] + pixels[i + 1] * 3 + pixels[i + 2] * 7) >>> 0;
    }
    return { width: canvas.width, height: canvas.height, cssWidth: parseFloat(canvas.style.width), ink, fingerprint };
  });
}

try {
  const range = await fetch(inline, { headers: { Range: "bytes=0-63" } });
  assert.equal(range.status, 206); assert.match(range.headers.get("content-type"), /^application\/pdf/);
  assert.equal(range.headers.get("accept-ranges"), "bytes"); assert.match(range.headers.get("content-disposition"), /^inline;/);
  assert.equal((await range.arrayBuffer()).byteLength, 64);
  report.headers = { status: range.status, type: range.headers.get("content-type"), range: range.headers.get("content-range"), disposition: range.headers.get("content-disposition") };

  const cases = [
    { name: "desktop-chromium", engine: chromium, width: 1440, height: 1000 },
    { name: "android-chromium", engine: chromium, width: 412, height: 915 },
    { name: "iphone-webkit", engine: webkit, width: 390, height: 844 },
    { name: "older-webview-missing-map-api", engine: chromium, width: 390, height: 844, compatibility: true },
  ];
  for (const testCase of cases.filter(testCase => !process.env.TEST_PDF_CASE || testCase.name === process.env.TEST_PDF_CASE)) {
    const { name, engine, width, height, compatibility } = testCase;
    const browser = await engine.launch({ ...(engine === chromium ? { executablePath: process.env.TEST_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe" } : {}), headless: true });
    try {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500, deviceScaleFactor: width < 500 ? 3 : 1, timezoneId: "Asia/Ho_Chi_Minh", acceptDownloads: true });
      if (compatibility) await context.addInitScript(() => { delete Map.prototype.getOrInsertComputed; delete WeakMap.prototype.getOrInsertComputed; });
      const page = await context.newPage(); page.setDefaultTimeout(30000);
      report.activeCase = name;
      const errors = []; page.on("pageerror", error => errors.push(error.message.slice(0, 200)));
      const ranges = [];
      page.on("response", response => {
        if (new URL(response.url()).searchParams.get("inline") === "1" && response.status() === 206) ranges.push(response.headers()["content-range"]);
      });
      if (compatibility) {
        let firstRead = true;
        await context.route("**/uploads/**", route => {
          if (firstRead && new URL(route.request().url()).searchParams.get("inline") === "1") {
            firstRead = false; return route.fulfill({ status: 503, body: "" });
          }
          return route.continue();
        });
      }
      if (name === "android-chromium" && process.env.TEST_PDF_THROTTLE === "true") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: 1_500_000, uploadThroughput: 750_000 });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      await page.goto(new URL(`/tai-lieu/${item.type}/qa-${item.id}`, base).href, { waitUntil: "domcontentloaded" });
      if (compatibility) {
        await page.getByRole("alert").filter({ hasText: "Không thể tải tài liệu" }).waitFor();
        assert.equal(await page.locator(".pdf-file-actions a").count(), 2);
        await page.getByRole("button", { name: "Thử lại PDF", exact: true }).click();
      }
      const first = await painted(page, 1); assert.ok(first.ink > 20, `${name}: page 1 must contain painted ink`);
      await page.getByRole("button", { name: "Trang tiếp", exact: true }).click();
      const second = await painted(page, 2); assert.ok(second.ink > 20); assert.notEqual(second.fingerprint, first.fingerprint);
      await page.getByRole("button", { name: "Trang trước", exact: true }).click();
      assert.equal((await painted(page, 1)).fingerprint, first.fingerprint);
      await page.getByRole("button", { name: "Trang tiếp", exact: true }).click(); await painted(page, 2);
      await page.getByRole("button", { name: "Phóng to PDF", exact: true }).click();
      await page.getByLabel("Mức thu phóng").filter({ hasText: "125%" }).waitFor();
      const zoomed = await painted(page, 2); assert.ok(zoomed.cssWidth > second.cssWidth);
      await page.getByRole("button", { name: "Thu nhỏ PDF", exact: true }).click();
      await page.getByLabel("Mức thu phóng").filter({ hasText: "100%" }).waitFor(); await painted(page, 2);
      await page.getByRole("button", { name: "Phóng to PDF", exact: true }).click();
      await page.getByLabel("Mức thu phóng").filter({ hasText: "125%" }).waitFor(); await painted(page, 2);
      await page.getByRole("button", { name: "Vừa chiều rộng", exact: true }).click();
      await page.getByLabel("Mức thu phóng").filter({ hasText: "100%" }).waitFor(); await painted(page, 2);
      await page.setViewportSize({ width: height, height: width }); await painted(page, 2);
      await page.setViewportSize({ width, height }); await painted(page, 2);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no body horizontal overflow`);
      if (name === "desktop-chromium" && process.env.TEST_PDF_DOWNLOAD !== "false") {
        const downloaded = page.waitForEvent("download"); await page.getByRole("link", { name: "Tải xuống", exact: true }).click();
        const download = await downloaded; const filename = await download.path(); assert.ok((await stat(filename)).size > 1_000_000);
        report.download = { succeeded: true, filename: download.suggestedFilename() };
        const popupPromise = page.waitForEvent("popup"); await page.getByRole("link", { name: "Mở file trong tab mới", exact: true }).click();
        const popup = await popupPromise; await popup.waitForURL(/\.pdf(?:\?|$)/); report.openInNewTab = true; await popup.close();
      }
      await page.reload({ waitUntil: "domcontentloaded" }); await painted(page, 1);
      assert.equal(await page.locator(".pdf-viewer [role=alert]").count(), 0);
      assert.deepEqual(errors, [], `${name}: no hydration/browser error`);
      assert.ok(ranges.length > 0, `${name}: viewer uses actual partial Range reads`);
      await page.locator(".pdf-viewer").screenshot({ path: path.join(directory, `${name}.png`) });
      report.checks.push({ name, result: "PASS", first, second, zoomed, rangeResponses: ranges, browserErrors: errors });
      console.log(`PASS real PDF ${name}: page1/page2/zoom/fit/orientation/reload`);
    } finally { await browser.close(); }
  }
  report.result = "PASS";
} catch (error) {
  report.failure = String(error.message).split("\n").slice(0, 3).join("\n").slice(0, 600);
  process.exitCode = 1;
} finally {
  await writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(`${report.result} real PDF public regression. Report: ${path.join(directory, "report.json")}`);
}
