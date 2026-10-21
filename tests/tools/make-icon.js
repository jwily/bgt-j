// Renders the app icon: the first four category colors (Quezacotl, Shiva, Ifrit, Siren) as
// diamonds forming one larger diamond, on an FF8-style grey window. Full-bleed: iOS rounds the
// corners itself. Colors come from the app's palette. Usage: npm run icon
const { webkit } = require('playwright');
const path = require('path');
const { readPalette } = require('../helpers');

const OUT = path.join(__dirname, '../../app/icons');

(async () => {
  const [top, right, bottom, left] = readPalette().slice(0, 4).map((c) => c.hex);
  const b = await webkit.launch();
  for (const size of [512, 180]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const edge = Math.max(2, Math.round(size / 64)); // bevel thickness scales with the icon
    const gem = Math.round(size * 0.215);            // each small diamond's side, before rotating
    const step = Math.round(gem * 0.78);             // distance from the center to each diamond
    const diamond = (color, dx, dy) => `<div style="position:absolute;left:50%;top:50%;width:${gem}px;height:${gem}px;
      margin:${-gem / 2 + dy}px 0 0 ${-gem / 2 + dx}px;transform:rotate(45deg);background:${color};
      box-shadow:0 0 0 ${Math.max(2, Math.round(size / 85))}px #111, inset ${Math.round(size / 60)}px ${Math.round(size / 60)}px 0 rgba(255,255,255,.4),
        inset -${Math.round(size / 80)}px -${Math.round(size / 80)}px 0 rgba(0,0,0,.25), ${Math.round(size / 90)}px ${Math.round(size / 60)}px 0 ${Math.round(size / 85)}px rgba(0,0,0,.45)"></div>`;
    await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">
      <div style="position:relative;width:${size}px;height:${size}px;box-sizing:border-box;
        background:linear-gradient(90deg,#3d3d3d 0%,#474747 10%,#525252 22%,#5f5f5f 34%,#646464 44%,#646464 78%,#5d5d5d 87%,#535353 100%);
        border:${edge}px solid;border-color:#2a2a2a #1c1c1c #1c1c1c #2a2a2a;
        box-shadow:inset ${edge}px ${edge}px 0 #747474,inset -${edge}px -${edge}px 0 #323232">
        ${diamond(top, 0, -step)}${diamond(right, step, 0)}${diamond(bottom, 0, step)}${diamond(left, -step, 0)}
      </div></body>`);
    await p.screenshot({ path: path.join(OUT, `icon-${size}.png`) });
    await p.close();
  }
  await b.close();
  console.log(`Icons written to ${OUT}`);
})();
