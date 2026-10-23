// Renders the app icon: the first category color's gem (Quezacotl), exactly as the app draws it
// (style.css's .dot: FF8's item gem with its glint), scaled up with CSS zoom so it's drawn sharp at
// size, on the app's window fill (--window-fill: shaded left to right, flat grey in the middle),
// without the windows' bevel (the user's choice; iOS rounds the corners itself). Also writes a
// preview at home-screen size with iOS's rounded corners (tests/output/icon-preview.png).
// Usage: npm run icon
//
// (Earlier versions: the first four colors' diamonds spiralling into the distance, then one diamond
// on a dark charcoal glow.)
const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');
const { readPalette } = require('../helpers');

const OUT = path.join(__dirname, '../../app/icons');
const PREVIEW = path.join(__dirname, '../output/icon-preview.png');
// The app's stylesheet, inlined (a page set with setContent can't load files).
const CSS = fs.readFileSync(path.join(__dirname, '../../app/style.css'), 'utf8');

const HEIGHT = 0.56;                         // the gem's height as a share of the icon
const OPTICAL_CENTER = { x: 0.5, y: 0.49 };  // a hair above the middle, where a centered shape looks centered
const GEM = { width: 11, height: 13 };       // .dot's size in style.css

function iconHtml(px, { hex, accent }) {
  const zoom = (HEIGHT * px) / GEM.height;
  const left = OPTICAL_CENTER.x * px - (GEM.width * zoom) / 2;
  const top = OPTICAL_CENTER.y * px - (GEM.height * zoom) / 2;
  return `<div style="position:relative;width:${px}px;height:${px}px;overflow:hidden;background:var(--window-fill)">
    <span class="dot" style="position:absolute;margin:0;zoom:${zoom};left:${left / zoom}px;top:${top / zoom}px;--c:${hex};--c2:${accent}"></span></div>`;
}

const page = (body) => `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
  <style>html, body { height: auto; overflow: visible; margin: 0; background: transparent; }</style><body>${body}</body>`;

(async () => {
  const [first] = readPalette();
  const browser = await webkit.launch();
  for (const size of [512, 180]) {
    const tab = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await tab.setContent(page(iconHtml(size, first)), { waitUntil: 'load' });
    await tab.screenshot({ path: path.join(OUT, `icon-${size}.png`) });
    await tab.close();
  }
  // Preview: large, then at home-screen size (180px = 60pt at 3x) on light and dark wallpaper.
  fs.mkdirSync(path.dirname(PREVIEW), { recursive: true });
  const masked = (px) => `<div style="width:${px}px;height:${px}px;border-radius:${px * 0.2237}px;overflow:hidden">${iconHtml(px, first)}</div>`;
  // Taller than it's shown, so the app's sideways-phone rule (landscape and short) doesn't hide it.
  const tab = await browser.newPage({ viewport: { width: 760, height: 600 } });
  await tab.setContent(page(`<div style="display:flex">
    <div style="padding:20px;background:#fff">${masked(290)}</div>
    <div style="padding:20px;background:#cfd6e2">${masked(180)}</div>
    <div style="padding:20px;background:#1c1c1e;flex:1">${masked(180)}</div></div>`), { waitUntil: 'load' });
  await tab.screenshot({ path: PREVIEW, clip: { x: 0, y: 0, width: 760, height: 330 } });
  await browser.close();
  console.log(`Icons written to ${OUT}; preview at ${PREVIEW}`);
})();
