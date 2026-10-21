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
exports.titleText = async (page) => (await page.locator('#nav-btn').textContent()).replace(/^‹ /, '');
exports.openSummary = async (page) => {
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(250);
  await page.locator('#menu button', { hasText: 'Current Period' }).tap();
  await page.waitForTimeout(250);
};

// Serves ../app on http://localhost:8765 (the address the passes and tools use). Resolves to the
// server; call server.close() when done.
const APP = require('path').join(__dirname, '..', 'app');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
};
exports.APP_URL = 'http://localhost:8765/';
exports.serveApp = () => new Promise((resolve) => {
  const path = require('path');
  const server = require('http').createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(APP, urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath);
    if (!file.startsWith(APP)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(data);
    });
  });
  server.listen(8765, () => resolve(server));
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
