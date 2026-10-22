// Cuts FF8's pointing hand out of a reference capture of the game's menus and puts it into
// app/style.css as the --hand image (a PNG data URI). Needs ffmpeg (brew install ffmpeg).
//
// The capture (~/projects/ff8-references/menuanimations.mov, outside the repo: it's the game's
// artwork) never shows the hand over plain background: every copy crosses some window edge. So it
// takes two copies from one frame whose stray lines fall in different places (one crosses a tab's
// bottom border, the other a window's left edge):
// 1. Line the two copies up (the shift where their white gloves overlap most).
// 2. At each pixel take the lighter of the two copies. The hand's outline is dark in both, so it
//    stays dark; a stray line is dark in only one, so the other copy's background shows instead.
//    That leaves one closed dark ring around the hand: flood the background in from the edges up
//    to it, and everything inside (ring, glove, thumb, creases) is the hand.
// 3. Average the two copies' colors there.
// 4. Crop to the hand and bake in its drop shadow (down and to the right, like FF8's text shadows)
//    rather than using a CSS filter, whose spill Safari didn't always wipe when the hand moved.
// Usage: npm run hand   (writes debug images to tests/output/hand/ too)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VIDEO = path.join(os.homedir(), 'projects/ff8-references/menuanimations.mov');
const AT = '8.6';                     // seconds into the capture: the "Choose GF to junction" screen
const COPIES = [                      // [x, y, width, height] around each copy of the hand
  [462, 50, 92, 66],                  // by "GF" in the top bar (crosses the tab's bottom border)
  [670, 228, 92, 66],                 // by "Quezacotl" (crosses the GF window's left edge)
];
const CSS = path.join(__dirname, '../../app/style.css');
const DEBUG = path.join(__dirname, '../output/hand');

(async () => {
  const frame = path.join(os.tmpdir(), 'bgt-j-hand-frame.png');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', AT, '-i', VIDEO, '-frames:v', '1', frame]);
  const data = fs.readFileSync(frame).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const result = await page.evaluate(async ({ data, COPIES }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const lum = (px, i) => (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;

    // Each copy's pixels.
    const copies = COPIES.map(([x, y, w, h]) => {
      const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const at = (cx, cy) => (cx >= 0 && cy >= 0 && cx < w && cy < h ? lum(px, cy * w + cx) : 128);
      return { w, h, px, at };
    });
    const [a, b] = copies;

    // 1. Line the second copy up with the first: the shift where their white gloves overlap most.
    let best = { dx: 0, dy: 0, score: -1 };
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        let score = 0;
        for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (a.at(x, y) > 190 && b.at(x + dx, y + dy) > 190) score++;
        if (score > best.score) best = { dx, dy, score };
      }
    }

    // 2. The ring: dark even in the lighter of the two copies. Flood the outside up to it.
    const { w, h } = a;
    const ring = (x, y) => Math.max(a.at(x, y), b.at(x + best.dx, y + best.dy)) < 60;
    const outside = new Uint8Array(w * h);
    const stack = [];
    for (let i = 0; i < w; i++) stack.push(i, (h - 1) * w + i);
    for (let j = 0; j < h; j++) stack.push(j * w, j * w + w - 1);
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      if (outside[i] || ring(x, y)) continue;
      outside[i] = 1;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - w);
      if (y < h - 1) stack.push(i + w);
    }

    // 3. The hand: average the two copies.
    const out = new ImageData(w, h);
    let [x0, y0, x1, y1] = [w, h, 0, 0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (outside[i]) continue;
        const j = (y + best.dy) * b.w + (x + best.dx);
        for (let c = 0; c < 3; c++) out.data[i * 4 + c] = (a.px[i * 4 + c] + b.px[j * 4 + c]) / 2;
        out.data[i * 4 + 3] = 255;
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
    }

    // 4. Crop, and bake in the shadow: 1px right and 2px down when shown 32px wide.
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d').putImageData(out, 0, 0);
    const [hw, hh] = [x1 - x0 + 1, y1 - y0 + 1];
    const shadow = { x: Math.round(hw / 32), y: Math.round((2 * hw) / 32) };
    const final = Object.assign(document.createElement('canvas'), { width: hw + shadow.x, height: hh + shadow.y });
    const fctx = final.getContext('2d');
    fctx.filter = `drop-shadow(${shadow.x}px ${shadow.y}px 0 rgba(0, 0, 0, 0.75))`;
    fctx.drawImage(canvas, x0, y0, hw, hh, 0, 0, hw, hh);
    const debug = COPIES.map(([x, y, cw, ch]) => {
      const c = Object.assign(document.createElement('canvas'), { width: cw, height: ch });
      c.getContext('2d').drawImage(img, x, y, cw, ch, 0, 0, cw, ch);
      return c.toDataURL('image/png');
    });
    return { uri: final.toDataURL('image/png'), width: final.width, height: final.height, shift: best, debug };
  }, { data, COPIES });
  await browser.close();
  fs.rmSync(frame);

  fs.mkdirSync(DEBUG, { recursive: true });
  const save = (name, uri) => fs.writeFileSync(path.join(DEBUG, name), Buffer.from(uri.split(',')[1], 'base64'));
  result.debug.forEach((uri, i) => save(`copy-${i + 1}.png`, uri));
  save('hand.png', result.uri);

  const css = fs.readFileSync(CSS, 'utf8');
  const updated = css.replace(/--hand: url\("data:image\/[^"]*"\);/, `--hand: url("${result.uri}");`);
  if (updated === css && !css.includes(result.uri)) throw new Error('Could not find --hand in style.css');
  fs.writeFileSync(CSS, updated);
  console.log(`hand: ${result.width}×${result.height}px (copies lined up with a shift of ${result.shift.dx},${result.shift.dy}), ${Math.round(result.uri.length / 1024)} KB`);
})();
