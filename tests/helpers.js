// Shared test helpers.
//
// Captures exported files on either path the app uses:
// WebKit has the share sheet (like iPhone), so we stand in for it; Chromium falls back to a download.
const fs = require('fs');
exports.fakeShareSheet = (context) => context.addInitScript(() => {
  window.__shared = [];
  window.__shareMode = 'save';
  if (!navigator.canShare) return;
  navigator.share = async ({ files }) => {
    if (window.__shareMode === 'cancel') throw new DOMException('cancelled', 'AbortError');
    window.__shared.push({ name: files[0].name, text: await files[0].text() });
  };
});
exports.grabFile = async (page, engine, action) => {
  if (engine === 'webkit') {
    await action();
    await page.waitForTimeout(300);
    return page.evaluate(() => window.__shared.at(-1));
  }
  const [download] = await Promise.all([page.waitForEvent('download'), action()]);
  return { name: download.suggestedFilename(), text: fs.readFileSync(await download.path(), 'utf8') };
};

// FF8 layout helpers: "left" lives in the menu's stats box; the screen name is in the title window.
exports.leftText = async (page) => `${await page.locator('#stat-left').textContent()} ${(await page.locator('#stat-left-label').textContent()).toLowerCase()}`;
exports.titleText = (page) => page.locator('#title').textContent();
// Opens a menu command and waits until its screen is showing and has finished unfolding (every
// screen's title is its menu command's name).
exports.openMenu = async (page, item) => {
  await page.locator('#nav-btn').tap();
  await page.waitForSelector('#menu-backdrop.open');
  await page.locator('#menu button', { hasText: item }).tap();
  await page.waitForFunction((title) => document.getElementById('title').textContent === title
    && !document.getElementById('page').hidden && !document.getElementById('page-body').classList.contains('unfold'), item);
};
exports.openSummary = (page) => exports.openMenu(page, 'Current Period');

// Waits until the app has finished starting (it shows a help line once it has).
exports.appReady = (page) => page.waitForFunction(() => document.querySelector('#help .text')?.textContent);

// One pass/fail line; the runner counts the FAIL lines.
exports.check = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  return ok;
};

// The app's saved data, parsed.
exports.saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')));

// Serves ../app on http://localhost:8765 (the address the passes and tools use). Resolves to the
// server; call server.close() when done.
const APP = require('path').join(__dirname, '..', 'app');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
};
exports.APP_URL = 'http://localhost:8765/';
// Serves ../app. Options (for tests of caching and updates): port; extra response headers; and
// change(urlPath, data), which can return different file contents (to simulate a deploy).
exports.serveApp = ({ port = 8765, headers = {}, change = null } = {}) => new Promise((resolve) => {
  const path = require('path');
  const server = require('http').createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(APP, urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath);
    if (!file.startsWith(APP)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', ...headers })
        .end(change?.(urlPath, data) ?? data);
    });
  });
  server.listen(port, () => resolve(server));
});

// The category palette from app/js/store.js, in order: [{ hex, name }] (name = its GF).
exports.readPalette = () => {
  const store = fs.readFileSync(require('path').join(__dirname, '..', 'app', 'js', 'store.js'), 'utf8');
  const start = store.indexOf('const PALETTE = [');
  const block = store.slice(start, store.indexOf('];', start));
  const palette = [...block.matchAll(/'(#[0-9a-f]{6})', \/\/ ([^:]+):/gi)].map(([, hex, name]) => ({ hex, name }));
  if (palette.length === 0) throw new Error('No colors found in PALETTE');
  return palette;
};

// The app's safety snapshots (in IndexedDB), newest first: their reasons.
exports.snapshotReasons = (page) => page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open('budget-tracker', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('snapshots', { keyPath: 'at' });
  open.onsuccess = () => {
    const request = open.result.transaction('snapshots').objectStore('snapshots').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.at - a.at).map((s) => s.reason));
  };
}));

// Makes every new context look like the installed home-screen app (navigator.standalone true), the
// way the user runs it. Playwright's WebKit otherwise reports a Safari tab, where the app shows its
// install hint. A test can still opt out by redefining navigator.standalone in its own init script.
exports.asInstalledApp = (browser) => {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
    return context;
  };
  return browser;
};

// Answers the app's exchange-rate requests with `body` (JSON text) instead of the real service.
exports.mockRates = (context, body, status = 200) => context.route('https://api.frankfurter.dev/**', (r) =>
  r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body }));

// On the first-budget screen: type a budget and start the first period.
exports.startFirstPeriod = async (page, digits = '100000') => {
  for (const k of digits) await page.locator('#page .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
  await page.locator('#page .primary').tap();
  await page.waitForTimeout(300);
};

// The Categories screen's rows, top to bottom: names and the colors of their dots.
exports.categoryRows = (page) => page.locator('.cat-row input').evaluateAll((ns) => ns.map((n) => n.value));
exports.categoryDotColors = (page) => page.locator('.cat-row .dot').evaluateAll((ds) => ds.map((d) => d.style.getPropertyValue('--c')));

// Waits until a message (like "Added ...") has left the HELP window, so it can be tapped again.
exports.messageCleared = (page) => page.waitForSelector('#help:not(.message)', { timeout: 8000 });
