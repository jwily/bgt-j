// Cuts the hand cursor straight out of the reference capture of FF8's cursor, so the app shows its
// exact pixels, and puts it into app/style.css as the --hand image (a PNG data URI).
// 1. Flood-fill the near-white background in from the image edges. The pocket under the finger
//    opens to the outside, so it counts as background; the white glove inside the black outline
//    doesn't.
// 2. Make the background transparent (part of it already is). Elsewhere it's white, and the
//    outline is black on white, so a light-grey
//    background pixel at the outline's edge is black blended with white: it becomes black at the
//    matching opacity, which keeps the edge's anti-aliasing without a white halo.
// 3. Crop to the hand plus a 1px margin, and scale it to WIDTH: the app never shows it wider than
//    32px, which is 96 pixels on a 3x screen.
// 4. Bake in its drop shadow (down and to the right, like FF8's text shadows) instead of drawing it
//    with a CSS filter. A filter's shadow paints outside the element's box, and iPhone Safari didn't
//    always wipe that spill when the hand moved between categories in the strip, leaving a dark
//    sliver behind.
// Usage: npm run hand
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '../../../ff8-references/cursor.png'); // outside the repo: it's the game's artwork
const CSS = path.join(__dirname, '../../app/style.css');
const WIDTH = 128;
const SHADOW = { x: 4, y: 8, opacity: 0.75 }; // at WIDTH; 1px × 2px when shown 32px wide

(async () => {
  const data = fs.readFileSync(SOURCE).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const { uri, width, height } = await page.evaluate(async ({ data, WIDTH, SHADOW }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const W = img.width, H = img.height;
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const image = ctx.getImageData(0, 0, W, H);
    const px = image.data;
    const lum = (i) => (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
    const light = (i) => px[i * 4 + 3] < 128 || lum(i) > 215;

    const background = new Uint8Array(W * H);
    const stack = [];
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) {
      const i = stack.pop();
      if (background[i] || !light(i)) continue;
      background[i] = 1;
      const x = i % W, y = (i / W) | 0;
      if (x > 0) stack.push(i - 1);
      if (x < W - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - W);
      if (y < H - 1) stack.push(i + W);
    }

    let [x0, y0, x1, y1] = [W, H, 0, 0];
    for (let i = 0; i < W * H; i++) {
      if (background[i]) {
        // Black over white at opacity a gives a grey of 255·(1 − a). Scaled by the pixel's own
        // opacity, since parts of the capture's background are already transparent.
        const alpha = Math.max(0, Math.min(255, Math.round((255 - lum(i)) * (px[i * 4 + 3] / 255))));
        px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 0;
        px[i * 4 + 3] = alpha < 8 ? 0 : alpha;
      } else {
        const x = i % W, y = (i / W) | 0;
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
    }
    ctx.putImageData(image, 0, 0);
    const [cx, cy, cw, ch] = [x0 - 1, y0 - 1, x1 - x0 + 3, y1 - y0 + 3];
    const handHeight = Math.round((ch * WIDTH) / cw);
    const out = Object.assign(document.createElement('canvas'), { width: WIDTH + SHADOW.x, height: handHeight + SHADOW.y });
    const outCtx = out.getContext('2d');
    outCtx.imageSmoothingQuality = 'high';
    outCtx.filter = `drop-shadow(${SHADOW.x}px ${SHADOW.y}px 0 rgba(0, 0, 0, ${SHADOW.opacity}))`;
    outCtx.drawImage(canvas, cx, cy, cw, ch, 0, 0, WIDTH, handHeight);
    return { uri: out.toDataURL('image/png'), width: out.width, height: out.height };
  }, { data, WIDTH, SHADOW });
  await browser.close();

  const css = fs.readFileSync(CSS, 'utf8');
  const updated = css.replace(/--hand: url\("data:image\/[^"]*"\);/, `--hand: url("${uri}");`);
  if (updated === css && !css.includes(uri)) throw new Error('Could not find --hand in style.css');
  fs.writeFileSync(CSS, updated);
  console.log(`hand: ${width}×${height}px, ${Math.round(uri.length / 1024)} KB as a data URI`);
})();
