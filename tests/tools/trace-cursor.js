// Traces the reference cursor's true outline:
// 1. flood-fill the near-white background from the image edges (so the pocket under the finger,
//    which opens to the outside, counts as background, while the white glove inside the black
//    outline does not);
// 2. walk the boundary of what's left (Moore-neighbour tracing);
// 3. simplify it (Douglas-Peucker) into a short path.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  // The reference capture of FF8's cursor lives outside the project (it's the game's artwork).
  const data = fs.readFileSync(path.join(__dirname, '../../../ff8-references/cursor.png')).toString('base64');
  const b = await chromium.launch();
  const p = await b.newPage();
  const { w, h, mask } = await p.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const W = img.width, H = img.height;
    const light = (i) => px[i * 4 + 3] < 128 || (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3 > 215;
    const bg = new Uint8Array(W * H);
    const stack = [];
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) {
      const i = stack.pop();
      if (bg[i] || !light(i)) continue;
      bg[i] = 1;
      const x = i % W, y = (i / W) | 0;
      if (x > 0) stack.push(i - 1);
      if (x < W - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - W);
      if (y < H - 1) stack.push(i + W);
    }
    return { w: W, h: H, mask: Array.from(bg, (v) => (v ? 0 : 1)) };
  }, data);
  await b.close();

  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Start at the top-most, then left-most hand pixel.
  let start = null;
  for (let y = 0; y < h && !start; y++) for (let x = 0; x < w; x++) if (inside(x, y)) { start = [x, y]; break; }
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const contour = [start];
  let [cx, cy] = start, dir = 6; // came from above
  for (let guard = 0; guard < 100000; guard++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8; // search clockwise starting left of the incoming direction
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (inside(nx, ny)) { cx = nx; cy = ny; dir = d; found = true; break; }
    }
    if (!found || (cx === start[0] && cy === start[1])) break;
    contour.push([cx, cy]);
  }
  const simplify = (pts, tol) => {
    if (pts.length < 3) return pts;
    const [a, z] = [pts[0], pts[pts.length - 1]];
    let maxD = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i];
      const num = Math.abs((z[1] - a[1]) * x - (z[0] - a[0]) * y + z[0] * a[1] - z[1] * a[0]);
      const d = num / (Math.hypot(z[0] - a[0], z[1] - a[1]) || 1);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= tol) return [a, z];
    return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
  };
  const simple = simplify(contour, 2.2);
  const xs = contour.map((q) => q[0]), ys = contour.map((q) => q[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  console.log(`traced ${contour.length} boundary pixels -> ${simple.length} points; box ${box.join(',')}`);
  fs.writeFileSync(path.join(__dirname, 'data/cursor-outline.json'), JSON.stringify({ box, points: simple }));
})();
