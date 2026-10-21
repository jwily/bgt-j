// Renders the app icon: the hand cursor on an FF8-style grey window, full-bleed (iOS rounds the corners).
const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '../../app/icons');
(async () => {
  const hand = `data:image/svg+xml;base64,${fs.readFileSync(path.join(__dirname, 'data/hand.svg')).toString('base64')}`;
  const b = await webkit.launch();
  for (const size of [512, 180]) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const edge = Math.max(2, Math.round(size / 64)); // bevel thickness scales with the icon
    await p.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">
      <div style="width:${size}px;height:${size}px;box-sizing:border-box;display:grid;place-items:center;
        background:linear-gradient(90deg,#3d3d3d 0%,#474747 10%,#525252 22%,#5f5f5f 34%,#646464 44%,#646464 78%,#5d5d5d 87%,#535353 100%);
        border:${edge}px solid;border-color:#2a2a2a #1c1c1c #1c1c1c #2a2a2a;
        box-shadow:inset ${edge}px ${edge}px 0 #747474,inset -${edge}px -${edge}px 0 #323232">
        <img src="${hand}" style="width:${Math.round(size * 0.74)}px;transform:translateX(-${Math.round(size * 0.015)}px);filter:drop-shadow(${Math.round(size / 90)}px ${Math.round(size / 60)}px 0 rgba(0,0,0,.7))">
      </div></body>`);
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/icon-${size}.png`, omitBackground: false });
    await p.close();
  }
  await b.close();
})();
