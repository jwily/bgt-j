// Gauge fill samples over the current palette, using the app's own gauge CSS (the metal trim stays
// as it is; only the fill varies), into tests/output/gauge-samples.html. Each GF color at three
// fill levels, so the fill's end can be judged, dark colors especially. FF8's fill, measured from
// compatibility.png and FFVIII_Status_Menu_5.webp: a muted red (#663d37) only a little lighter than
// the #383838 trough, darkest at its top and bottom edges and brightest ~60% down, no sheen, fading
// in over ~4px at its start and out over ~6px at its end. Usage: npm run gauges
const fs = require('fs');
const path = require('path');
const palette = require('../helpers').readPalette();
const CSS = 'file://' + path.join(__dirname, '..', '..', 'app', 'style.css');
const OUT = path.join(__dirname, '..', 'output', 'gauge-samples.html');
const LEVELS = [0.3, 0.65, 0.92];
const VARIANTS = [
  ['now', 'Now', 'Today\'s fill: translucent color over the trough with a glass sheen and a clean end.'],
  ['ff8', 'A. FF8', 'FF8\'s fill: the color mixed down toward the trough, shaded top to bottom, soft ends, no sheen.'],
  ['lift', 'B. FF8, lifted', 'A, with colors too dark to read against the trough raised to a minimum lightness (hue and saturation kept).'],
  ['tip', 'C. FF8 + tip', 'A with a brighter tip where the fill ends, like the HP bar\'s, so every color shows where it stops.'],
  ['both', 'D. B + C', 'Lifted colors and the bright tip.'],
];
const gauge = (p, level) => `<span class="gauge"><span class="bar"><span style="width:${level * 100}%;--c:${p.hex}"></span></span><span class="number">${Math.round(level * 100)}</span></span>`;
const sections = VARIANTS.map(([id, title, text]) => `
<section class="window v-${id}"><h2>${title}</h2><p>${text}</p>
  <div class="rows">${palette.map((p) => `<div class="row"><span class="name">${p.name}</span>${LEVELS.map((l) => gauge(p, l)).join('')}</div>`).join('')}</div>
</section>`).join('');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `<!doctype html><meta charset="utf-8"><title>Gauge samples</title>
<link rel="stylesheet" href="${CSS}">
<style>
html, body { height: auto; overflow: auto; }
body { padding: 24px; -webkit-user-select: text; user-select: text; }
h1 { font-size: 22px; } h2 { margin: 0 0 4px; font-size: 18px; } p { margin: 0 0 14px; color: var(--soft); font-size: 14px; }
section.window { position: relative; max-width: 1100px; margin: 0 0 8px; padding: 16px 18px; }
.row { display: grid; grid-template-columns: 110px repeat(3, 1fr); gap: 0 18px; align-items: center; margin-bottom: 6px; }
.name { font-size: 15px; }

/* FF8's fill: the color 45% over the trough (#663d37 is about red at that mix), shaded top to
   bottom, faded in and out at its ends. --f is the fill's color. */
section:not(.v-now) .gauge .bar::after { display: none; }
section:not(.v-now) .gauge .bar span {
  --f: color-mix(in oklab, var(--c) 45%, #323232);
  background: linear-gradient(180deg,
    color-mix(in oklab, var(--f) 55%, black) 0%, var(--f) 28%,
    color-mix(in oklab, var(--f) 90%, white) 60%, var(--f) 82%,
    color-mix(in oklab, var(--f) 60%, black) 100%);
  -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,.35), #000 4px, #000 calc(100% - 6px), transparent);
  mask-image: linear-gradient(to right, rgba(0,0,0,.35), #000 4px, #000 calc(100% - 6px), transparent);
}
/* Lifted: the fill color brought up to a minimum lightness, its hue and saturation kept. */
section.v-lift .gauge .bar span, section.v-both .gauge .bar span {
  --f: oklch(from color-mix(in oklab, var(--c) 45%, #323232) max(l, 0.5) c h);
}
/* The tip: the last 3px of the fill lighter, with a clean end so the tip stays crisp. */
section.v-tip .gauge .bar span, section.v-both .gauge .bar span {
  background:
    linear-gradient(to left, color-mix(in oklab, var(--f) 45%, white) 0 2px, color-mix(in oklab, var(--f) 70%, white) 2px 3px, transparent 3px),
    linear-gradient(180deg,
      color-mix(in oklab, var(--f) 55%, black) 0%, var(--f) 28%,
      color-mix(in oklab, var(--f) 90%, white) 60%, var(--f) 82%,
      color-mix(in oklab, var(--f) 60%, black) 100%);
  -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,.35), #000 4px);
  mask-image: linear-gradient(to right, rgba(0,0,0,.35), #000 4px);
}
</style>
<h1>Gauge fill samples (current palette)</h1>
${sections}`);
console.log(`Wrote ${OUT}`);
