// Checks the app's category palette (PALETTE in app/js/store.js) for colors that look too alike.
// Categories take colors in order, so it reports the closest pair among the first n colors.
// Distance is OKLab x100; under ~10 starts to look alike. Usage: node tools/check-palette.js

const palette = require('../helpers').readPalette();

const linear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => linear(parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const distance = (a, b) => { const [p, q] = [oklab(a), oklab(b)]; return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

let worst = Infinity;
for (let n = 2; n <= palette.length; n++) {
  let min = Infinity, pair = '';
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const d = distance(palette[a].hex, palette[b].hex);
    if (d < min) { min = d; pair = `${palette[a].name} / ${palette[b].name}`; }
  }
  worst = min;
  console.log(`first ${String(n).padStart(2)} categories: closest pair ${min.toFixed(1)}  (${pair})`);
}
console.log(worst < 10 ? 'WARNING: some colors are close enough to look alike' : 'All colors distinct');
process.exitCode = worst < 10 ? 1 : 0;
