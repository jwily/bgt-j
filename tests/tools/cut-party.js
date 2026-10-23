// Cuts the six party members' walking and victory frames out of the FF Record Keeper sprite sheets
// in ~/projects/ff8-references (the sheets themselves never go in the app) into app/sprites/party.png:
// a row per character, in PARTY order, each six 20x26 cells, the sprite's feet on the cell's bottom
// edge, centered across it. Frames, chosen by eye from the sheets (no animations came with them):
//   0 stand (side, facing left), 1 stride (the walk alternates the two),
//   2 victory start, 3 arms up, 4 cheer, 5 final pose (the victory runs 2 3 4 3 4 5).
// Each frame is its rectangle on the sheet: [x, y, w, h]. Usage: npm run party
const { webkit } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SHEET = (name) => path.join(os.homedir(), 'projects', 'ff8-references', `Mobile - Final Fantasy_ Record Keeper - Playable Characters_ Final Fantasy VIII - ${name}.png`);
const OUT = path.join(__dirname, '../../app/sprites/party.png');
const CELL = { w: 20, h: 26 };
const PARTY = {
  Squall: [[114, 23, 16, 24], [103, 48, 15, 23], [1, 51, 16, 24], [1, 176, 16, 24], [1, 151, 16, 24], [1, 201, 16, 24]],
  Zell: [[1, 1, 16, 24], [52, 41, 14, 23], [1, 51, 16, 24], [1, 101, 16, 24], [1, 126, 16, 24], [1, 226, 16, 24]],
  Irvine: [[1, 145, 16, 24], [93, 26, 16, 23], [76, 1, 16, 24], [93, 1, 16, 24], [1, 45, 16, 24], [1, 20, 16, 24]],
  Quistis: [[1, 151, 16, 24], [185, 16, 15, 23], [1, 201, 16, 24], [1, 1, 16, 24], [1, 201, 16, 24], [1, 26, 16, 24]],
  Rinoa: [[79, 116, 14, 23], [48, 132, 14, 23], [67, 1, 16, 24], [49, 22, 16, 24], [64, 105, 14, 24], [1, 87, 15, 24]],
  Selphie: [[1, 1, 16, 24], [118, 59, 15, 23], [1, 101, 16, 24], [1, 201, 16, 24], [1, 176, 16, 24], [1, 151, 16, 24]],
};

(async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage();
  const sheets = Object.fromEntries(Object.keys(PARTY).map((name) => [name, 'data:image/png;base64,' + fs.readFileSync(SHEET(name)).toString('base64')]));
  const png = await page.evaluate(async ({ sheets, PARTY, CELL }) => {
    const names = Object.keys(PARTY);
    const out = document.createElement('canvas');
    out.width = CELL.w * 6;
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
