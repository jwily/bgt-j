// Renders the app icon: the first four category colors (Quezacotl, Shiva, Ifrit, Siren) as diamonds
// on a golden spiral, curling clockwise from 12 o'clock into the distance, on a dark charcoal glow
// (FF8's dark menu backdrop, without hard corners, since iOS rounds the icon itself). Colors come
// from the app's palette. Also writes a preview at home-screen size with iOS's rounded corners
// (tests/output/icon-preview.png). Usage: npm run icon
//
// Design rules:
// - One proportion: each diamond is the previous one scaled by RATIO, in size and in distance from
//   the spiral's center, at exact quarter turns (12 → 3 → 6 → 9). (The golden ratio, 0.618, was
//   tried: it left the last diamond too small to see at home-screen size.)
// - Clear gaps, no near-misses: neighbours are separated by the same share of the smaller one's size,
//   so every diamond stays whole and the gaps trace the spiral.
// - Balance: the group fills a fixed share of the icon, centered on its bounds at the optical
//   center (a little above the middle), so the margins are even.
// - One light source, top-left: highlights top-left, shadows down-right, longest under the nearest.
// - Depth without losing color: farther diamonds are slightly softer and lower in contrast, same hue.
const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');
const { readPalette } = require('../helpers');

const OUT = path.join(__dirname, '../../app/icons');
const PREVIEW = path.join(__dirname, '../output/icon-preview.png');

const RATIO = 0.7;          // each diamond relative to the one before
const GAP = 0.12;           // space between neighbours, as a share of the smaller one's size
const EXTENT = 0.68;        // the group's larger dimension, as a share of the icon
const OPTICAL_CENTER = { x: 0.5, y: 0.48 };

// Diamond i sits at 90° − 90°·i (clockwise from 12), at a distance shrinking by RATIO each step.
// Diamonds are |x| + |y| ≤ size/2, so two touch when |dx| + |dy| = (size_a + size_b) / 2; for
// neighbours a quarter turn apart, |dx| + |dy| = r_i + r_{i+1} = r_i·(1 + RATIO). Laid out with
// the first diamond 1 unit across, then scaled to fit.
function layout() {
  const sizes = [0, 1, 2, 3].map((i) => RATIO ** i);
  const reach = ((sizes[0] + sizes[1]) / 2 + GAP * sizes[1]) / (1 + RATIO);
  const diamonds = sizes.map((size, i) => {
    const angle = ((90 - 90 * i) * Math.PI) / 180;
    const radius = reach * RATIO ** i;
    return { size, depth: i, x: radius * Math.cos(angle), y: -radius * Math.sin(angle) };
  });
  const edge = (axis, sign) => Math.max(...diamonds.map((d) => sign * d[axis] + d.size / 2));
  const [left, right, top, bottom] = [edge('x', -1), edge('x', 1), edge('y', -1), edge('y', 1)];
  const scale = EXTENT / Math.max(left + right, top + bottom);
  const cx = (right - left) / 2;
  const cy = (bottom - top) / 2;
  return diamonds.map((d) => ({
    ...d,
    size: d.size * scale,
    x: (d.x - cx) * scale + OPTICAL_CENTER.x,
    y: (d.y - cy) * scale + OPTICAL_CENTER.y,
  }));
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
  const colors = readPalette().slice(0, 4);
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
