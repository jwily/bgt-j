// Cuts the six party members' walk cycles out of the FF Record Keeper sprite sheets in
// ~/projects/ff8-references (the sheets themselves never go in the app) into app/sprites/party.png:
// a row per character, in PARTY order, each two 20x26 cells, the sprite's feet on the cell's bottom
// edge, centered across it. Each walk is two frames, alternating every half second, found by
// matching every frame of walk.mov (FFRK's title screen, the six walking on the spot) against every
// sprite on the sheets: frame 0 is the stride, frame 1 feet together (also the standing pose).
// Each frame is its rectangle on the sheet: [x, y, w, h]. Usage: npm run party
const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SHEET = (name) => path.join(os.homedir(), 'projects', 'ff8-references', `Mobile - Final Fantasy_ Record Keeper - Playable Characters_ Final Fantasy VIII - ${name}.png`);
const OUT = path.join(__dirname, '../../app/sprites/party.png');
const CELL = { w: 20, h: 26 };
const PARTY = {
  Squall: [[228, 119, 15, 23], [180, 73, 15, 24]],
  Zell: [[202, 59, 15, 23], [203, 34, 15, 24]],
  Irvine: [[161, 26, 16, 23], [1, 145, 16, 24]],
  Quistis: [[185, 16, 15, 23], [219, 9, 15, 24]],
  Rinoa: [[110, 101, 14, 23], [17, 129, 14, 24]],
  Selphie: [[135, 46, 15, 23], [34, 43, 15, 24]],
};

(async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage();
  const sheets = Object.fromEntries(Object.keys(PARTY).map((name) => [name, 'data:image/png;base64,' + fs.readFileSync(SHEET(name)).toString('base64')]));
  const png = await page.evaluate(async ({ sheets, PARTY, CELL }) => {
    const names = Object.keys(PARTY);
    const out = document.createElement('canvas');
    out.width = CELL.w * 2;
    out.height = CELL.h * names.length;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (const [row, name] of names.entries()) {
      const img = new Image();
      img.src = sheets[name];
      await img.decode();
      PARTY[name].forEach(([x, y, w, h], col) => {
        g.drawImage(img, x, y, w, h, col * CELL.w + Math.floor((CELL.w - w) / 2), row * CELL.h + CELL.h - h, w, h);
      });
    }
    return out.toDataURL('image/png');
  }, { sheets, PARTY, CELL });
  fs.writeFileSync(OUT, Buffer.from(png.split(',')[1], 'base64'));
  await browser.close();
  console.log(`Wrote ${OUT} (${Object.keys(PARTY).join(', ')})`);
})();
