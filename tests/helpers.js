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
// The menu's SPENT stat: the current period's spending (what's left is the status row's HP).
exports.spentText = (page) => page.locator('#stat-spent').textContent();
exports.titleText = (page) => page.locator('#title').textContent();
// Opens a menu command and waits until its screen is showing and has finished fading in (every
// screen's title is its menu command's name).
exports.openMenu = async (page, item) => {
  await page.locator('#nav-btn').tap();
  await page.waitForSelector('#menu-backdrop.open');
  await page.locator('#menu button', { hasText: item }).tap();
  await page.waitForFunction((title) => document.getElementById('title').textContent === title
    && !document.getElementById('page').hidden
    && !document.getAnimations().some((a) => a.animationName === 'fade-in' && a.playState === 'running'), item);
};
exports.openSummary = (page) => exports.openMenu(page, 'Current Period');

// Waits until the app has finished starting: built, with a help line, and revealed.
exports.appReady = (page) => page.waitForFunction(() => document.getElementById('help').textContent && !document.body.classList.contains('starting'));

// Independent scenarios: scenario(name, async (open) => ...) runs one on its own; open(options)
// makes it a phone-sized browser context, closed afterwards. A crash fails just that scenario (a
// FAIL line naming it) and the rest still run, so one problem can't hide the checks after it.
// Today in the phone's local time zone, as the app keeps days: "YYYY-MM-DD" (a date, or today).
exports.localToday = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

exports.scenarios = (browser) => async (name, run) => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return; // ONLY=<part of a name>: run just those
  const { devices } = require('playwright');
  const contexts = [];
  const open = async (options = {}) => {
    const context = await browser.newContext({ ...devices['iPhone 13'], ...options });
    contexts.push(context);
    return context;
  };
  try {
    await run(open);
  } catch (error) {
    console.log(`FAIL  ${name}: CRASHED: ${error.message.split('\n')[0]}`);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
  }
};

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

// The category palette from app/js/palette.js, in order: [{ hex, accent, name }] (name = its GF).
exports.readPalette = () => {
  const source = fs.readFileSync(require('path').join(__dirname, '..', 'app', 'js', 'palette.js'), 'utf8');
  const start = source.indexOf('const PALETTE = [');
  const block = source.slice(start, source.indexOf('];', start));
  const palette = [...block.matchAll(/\['(#[0-9a-f]{6})', '(#[0-9a-f]{6})'\], \/\/ ([^:]+):/gi)].map(([, hex, accent, name]) => ({ hex, accent, name }));
  if (palette.length === 0) throw new Error('No colors found in PALETTE');
  return palette;
};

// The app's safety snapshots (in IndexedDB), newest first: their reasons.
exports.snapshotReasons = (page) => page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open('budget-tracker'); // whatever version the app has made it
  open.onupgradeneeded = () => open.result.createObjectStore('snapshots', { keyPath: 'at' }); // not made yet: an empty list
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
// (Empty slots left empty don't count; their gems are empty sockets.)
exports.categoryRows = (page) => page.locator('.cat-row input').evaluateAll((ns) => ns.filter((n) => n.value || !n.closest('.slot')).map((n) => n.value));
exports.categoryDotColors = (page) => page.locator('.cat-row .dot:not(.empty)').evaluateAll((ds) => ds.map((d) => d.style.getPropertyValue('--c')));

// Waits until a message (like "Added ...") has left the HELP window, so it can be tapped again.
exports.messageCleared = (page) => page.waitForSelector('#help:not(.message)', { timeout: 8000 });
