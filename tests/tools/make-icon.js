// Renders the app icon: the first four category colors (Quezacotl, Shiva, Ifrit, Siren) as diamonds
// spiralling counter-clockwise from 12 o'clock into the distance, the first closest, on a dark charcoal glow (FF8's dark menu
// backdrop, without hard corners, since iOS rounds the icon itself). Colors come from the app's
// palette. Usage: npm run icon
const { webkit } = require('playwright');
const path = require('path');
const { readPalette } = require('../helpers');

const OUT = path.join(__dirname, '../../app/icons');

// The diamonds sit on a spiral around a vanishing point: the first at 12 o'clock and closest,
// the rest curling counter-clockwise (12 → 9 → 6 → 3) as they shrink into the distance, each
// a little dimmer and softer (kept light, so the GF colors stay true). Fractions of the icon.
const CENTER = { x: 0.52, y: 0.53 };
const TURN = 95;            // degrees between diamonds, counter-clockwise
const SPIRAL = [
  { radius: 0.255, size: 0.40, light: 1, blur: 0 },
  { radius: 0.215, size: 0.27, light: 0.95, blur: 0 },
  { radius: 0.165, size: 0.175, light: 0.9, blur: 0.0012 },
  { radius: 0.115, size: 0.11, light: 0.85, blur: 0.0024 },
].map((d, i) => {
  const angle = ((90 + i * TURN) * Math.PI) / 180; // 90° = 12 o'clock; increasing = counter-clockwise
  return { ...d, x: CENTER.x + d.radius * Math.cos(angle), y: CENTER.y - d.radius * Math.sin(angle) };
});

(async () => {
  const colors = readPalette().slice(0, 4).map((c) => c.hex);
  const b = await webkit.launch();
  for (const size of [512, 180]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const px = (f) => Math.round(f * size);
    // Drawn farthest first, so nearer diamonds overlap the ones behind them.
    const diamonds = SPIRAL.map((d, i) => ({ ...d, color: colors[i] })).reverse().map((d) => {
      const side = px(d.size) / Math.SQRT2; // the rotated square's side, so its point-to-point size is d.size
      const outline = Math.max(1.5, side / 26);
      return `<div style="position:absolute;left:${px(d.x) - side / 2}px;top:${px(d.y) - side / 2}px;width:${side}px;height:${side}px;
        transform:rotate(45deg);background:${d.color};filter:brightness(${d.light}) blur(${d.blur * size}px);
        box-shadow:0 0 0 ${outline}px #0d0d0d, inset ${side / 9}px ${side / 9}px 0 rgba(255,255,255,.38),
          inset -${side / 12}px -${side / 12}px 0 rgba(0,0,0,.28), ${side / 14}px ${side / 9}px ${side / 10}px rgba(0,0,0,.6)"></div>`;
    }).join('');
    await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">
      <div style="position:relative;width:${size}px;height:${size}px;overflow:hidden;
        background:radial-gradient(circle at 52% 53%, #575757 0%, #383838 26%, #1b1b1b 60%, #070707 100%)">${diamonds}</div></body>`);
    await p.screenshot({ path: path.join(OUT, `icon-${size}.png`) });
    await p.close();
  }
  await b.close();
  console.log(`Icons written to ${OUT}`);
})();
