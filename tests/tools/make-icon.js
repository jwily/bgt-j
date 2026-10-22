// Renders the app icon: the first category color (Quezacotl) as a single gem, its accent at the
// core like the gems in the app, on a dark charcoal glow (FF8's dark menu backdrop, without hard
// corners, since iOS rounds the icon itself). Colors come from the app's palette. Also writes a
// preview at home-screen size with iOS's rounded corners (tests/output/icon-preview.png).
// Usage: npm run icon
//
// (Earlier versions spiralled the first four colors' gems into the distance; the user preferred
// just the first.)
const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');
const { readPalette } = require('../helpers');

const OUT = path.join(__dirname, '../../app/icons');
const PREVIEW = path.join(__dirname, '../output/icon-preview.png');

const SIZE = 0.58;                           // the gem, point to point, as a share of the icon
const OPTICAL_CENTER = { x: 0.5, y: 0.49 };  // a hair above the middle, where a centered shape looks centered

function layout() {
  return [{ size: SIZE, depth: 0, x: OPTICAL_CENTER.x, y: OPTICAL_CENTER.y }];
}

// color: { hex, accent } from the palette. Like the app's gems, the accent is a diamond at the core.
function diamondHtml(d, color, px) {
  const side = (d.size * px) / Math.SQRT2; // the rotated square's side, so point to point is d.size
  const lift = 1 - d.depth * 0.22;         // nearer = higher off the backdrop = longer shadow
  const blur = d.depth * 0.0016 * px;      // a touch of haze with distance
  const contrast = 1 - d.depth * 0.06;
  // Rotated 45°, the square's own top-left corner is the diamond's top point, so light from the
  // top-left falls on the box's top and left edges: shadow offsets (x, y) become (diagonal, 0).
  const shade = (x) => `${x}px ${x}px`;
  return `<div style="position:absolute;left:${d.x * px - side / 2}px;top:${d.y * px - side / 2}px;
    width:${side}px;height:${side}px;transform:rotate(45deg);
    background:linear-gradient(${color.accent},${color.accent}) center / 42% 42% no-repeat, ${color.hex};
    filter:contrast(${contrast}) blur(${blur}px);
    box-shadow:0 0 0 ${Math.max(1.5, side * 0.035)}px #0d0d0d,
      inset ${side * 0.1}px 0 0 rgba(255,255,255,.34),
      inset ${shade(-side * 0.07)} 0 rgba(0,0,0,.22),
      ${side * 0.13 * lift}px 0 ${side * 0.14 * lift}px rgba(0,0,0,${(0.4 + 0.3 * lift).toFixed(2)})"></div>`;
}

function iconHtml(px, colors) {
  const glow = `radial-gradient(circle at ${OPTICAL_CENTER.x * 100}% ${OPTICAL_CENTER.y * 100}%,
    #4f4f4f 0%, #343434 30%, #1a1a1a 64%, #0a0a0a 100%)`;
  // Drawn farthest first, so nearer diamonds overlap the ones behind them.
  const diamonds = layout().map((d, i) => diamondHtml(d, colors[i], px)).reverse().join('');
  return `<div style="position:relative;width:${px}px;height:${px}px;overflow:hidden;background:${glow}">${diamonds}</div>`;
}

(async () => {
  const colors = readPalette().slice(0, 1);
  const browser = await webkit.launch();
  for (const size of [512, 180]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${iconHtml(size, colors)}</body>`);
    await page.screenshot({ path: path.join(OUT, `icon-${size}.png`) });
    await page.close();
  }
  // Preview: large, then at home-screen size (180px = 60pt at 3x) on light and dark wallpaper.
  fs.mkdirSync(path.dirname(PREVIEW), { recursive: true });
  const masked = (px) => `<div style="width:${px}px;height:${px}px;border-radius:${px * 0.2237}px;overflow:hidden">${iconHtml(px, colors)}</div>`;
  const page = await browser.newPage({ viewport: { width: 760, height: 330 } });
  await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex">
    <div style="padding:20px;background:#fff">${masked(290)}</div>
    <div style="padding:20px;background:#cfd6e2">${masked(180)}</div>
    <div style="padding:20px;background:#1c1c1e;flex:1">${masked(180)}</div></body>`);
  await page.screenshot({ path: PREVIEW });
  await browser.close();
  console.log(`Icons written to ${OUT}; preview at ${PREVIEW}`);
})();
