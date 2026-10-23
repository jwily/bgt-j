// Gem design samples over the current palette, beside FF8's item gem (gem-ref.png, linked from
// ~/projects/ff8-references, never copied), into tests/output/gem-samples.html. Kept as a reference
// for the gem designs considered: the app uses B (Glint); B2 and B3 were tried alongside it.
// Usage: npm run gems [-- accents.json], where accents.json ({ "GF name": "#accent", ... }) proposes
// new accents: B, B2 and F are then shown again with them, changed gems marked *.
const fs = require('fs');
const path = require('path');
const palette = require('../helpers').readPalette();
const REF = 'file://' + path.join(require('os').homedir(), 'projects', 'ff8-references', 'gem-ref.png');
const FONT = 'file://' + path.join(__dirname, '..', '..', 'app', 'fonts', 'nunito-latin.woff2');
const OUT = path.join(__dirname, '..', 'output', 'gem-samples.html');
const VARIANTS = [
  ['plain', 'A. Plain FF8', 'The measured gem in the base color only, no accent. For comparison.'],
  ['glint', 'B. Glint', 'The accent tints the top-left highlight facet, where the light hits.'],
  ['glint2', 'B2. Glint, stronger', 'B with more of the accent in the highlight, spilling into the two facets beside it.'],
  ['swapped', 'B3. B2, swapped where the accent is darker', 'Where the accent is darker than the base, the gem swaps them (accent stone, base glint); gauges and the donut would keep the base. Swapped gems are marked *.'],
  ['heart', 'C. Heart', 'The accent is the center facet: color seen through the table, like today\'s core.'],
  ['luster', 'D. Luster', 'The accent glows in the shadowed lower-right facets, as light bouncing back through the stone.'],
  ['sheen', 'E. Sheen', 'A diagonal streak of the accent across the facets, top-left to center.'],
  ['gleam', 'F. Gleam (E, softened)', 'A narrower, fainter streak of the accent with a white hot spot where it crosses the top-left facet; the facets stay readable.'],
];
// Relative luminance, to find accents darker than their base.
const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const swapped = palette.map((p) => (lum(p.accent) < lum(p.hex) ? { ...p, hex: p.accent, accent: p.hex, name: `${p.name} *` } : p));
const proposed = process.argv[2] && JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const withProposed = proposed && palette.map((p) => (proposed[p.name] ? { ...p, accent: proposed[p.name], name: `${p.name} *` } : p));
const runs = VARIANTS.flatMap(([id, title, text]) => [[id, title, text, id === 'swapped' ? swapped : palette],
  ...(proposed && ['glint', 'glint2', 'gleam'].includes(id) ? [[id, `${title}: proposed accents`, 'The same, with the proposed accents (changed ones marked *).', withProposed]] : [])]);
const row = (p) => `<div class="cat" style="--c:${p.hex};--a:${p.accent}"><span class="gem"></span>${p.name}</div>`;
const big = (p) => `<span class="gem zoom" style="--c:${p.hex};--a:${p.accent}" title="${p.name}"></span>`;
const sections = runs.map(([id, title, text, list]) => `
<section class="window v-${id}"><h2>${title}</h2><p>${text}</p>
  <div class="zooms">${list.map(big).join('')}</div>
  <div class="cats">${list.map(row).join('')}</div>
  <div class="strip">${list.slice(0, 4).map((p, i) => `<span class="chip${i === 0 ? ' sel' : ''}" style="--c:${p.hex};--a:${p.accent}"><span class="gem"></span>${['Bills','Dining','Fun','Groceries'][i]}</span>`).join('')}</div>
</section>`).join('');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `<!doctype html><meta charset="utf-8"><title>Gem samples</title>
<style>
@font-face { font-family: Nunito; src: url('${FONT}') format('woff2'); font-weight: 400 800; }
body { margin: 0; padding: 24px; background: #000; color: #ededed; font: 600 17px Nunito, sans-serif; text-shadow: 2px 2px 2px rgba(0,0,0,.38); }
h1 { font-size: 22px; } h2 { margin: 0 0 4px; font-size: 18px; } p { margin: 0 0 14px; color: #cfcfcf; font-size: 14px; }
.window { max-width: 1100px; margin: 0 0 8px; padding: 16px 18px; background: linear-gradient(90deg, #3d3d3d 0%, #474747 10%, #525252 22%, #5f5f5f 34%, #646464 44%, #646464 78%, #5d5d5d 87%, #535353 100%); box-shadow: inset 2px 2px 0 #747474, inset -2px -2px 0 #323232; outline: 1px solid #111; }
.ref { display: flex; gap: 24px; align-items: center; }
.ref img { width: 338px; } .ref .zoomref { background: url('${REF}') -88px -44px / 1352px 400px; width: 128px; height: 148px; image-rendering: pixelated; }
.zooms { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 14px; }
.cats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 16px; margin-bottom: 12px; }
.cat { display: flex; align-items: center; gap: 9px; }
.strip { display: flex; gap: 8px; } .chip { display: flex; align-items: center; gap: 7px; } .chip.sel { color: #f2e34c; }

/* The gem, measured from gem-ref.png: 11x13, a 1px rim, a 3x3 grid of flat facets lit from the
   top-left (each a mix of the base with white or black), slightly rounded corners. */
.gem {
  --k: 1;
  flex: none; display: inline-block; width: calc(11px * var(--k)); height: calc(13px * var(--k)); border-radius: calc(3px * var(--k));
  --tl: color-mix(in srgb, var(--c) 41%, white); --tc: color-mix(in srgb, var(--c) 58%, white); --tr: color-mix(in srgb, var(--c) 88%, black);
  --ml: color-mix(in srgb, var(--c) 58%, white); --mc: var(--c);                                --mr: color-mix(in srgb, var(--c) 73%, black);
  --bl: color-mix(in srgb, var(--c) 88%, black); --bc: color-mix(in srgb, var(--c) 73%, black); --br: color-mix(in srgb, var(--c) 53%, black);
  --rim: color-mix(in srgb, var(--c) 35%, black);
  --x1: calc(3.5px * var(--k)); --x2: calc(7.5px * var(--k)); --w1: calc(3.5px * var(--k)); --w2: calc(4px * var(--k));
  --y1: calc(4px * var(--k)); --y2: calc(8.5px * var(--k)); --h1: calc(4px * var(--k)); --h2: calc(4.5px * var(--k));
  background:
    var(--over, linear-gradient(transparent, transparent)),
    linear-gradient(var(--br), var(--br)) var(--x2) var(--y2) / 100% 100% no-repeat,
    linear-gradient(var(--bc), var(--bc)) var(--x1) var(--y2) / 100% 100% no-repeat,
    linear-gradient(var(--mr), var(--mr)) var(--x2) var(--y1) / 100% 100% no-repeat,
    linear-gradient(var(--bl), var(--bl)) 0 var(--y2) / 100% 100% no-repeat,
    linear-gradient(var(--mc), var(--mc)) var(--x1) var(--y1) / 100% 100% no-repeat,
    linear-gradient(var(--tr), var(--tr)) var(--x2) 0 / 100% 100% no-repeat,
    linear-gradient(var(--ml), var(--ml)) 0 var(--y1) / 100% 100% no-repeat,
    linear-gradient(var(--tc), var(--tc)) var(--x1) 0 / 100% 100% no-repeat,
    var(--tl);
  box-shadow: inset 0 0 0 calc(0.75px * var(--k)) var(--rim), calc(2px * var(--k)) calc(2px * var(--k)) calc(2px * var(--k)) rgba(0,0,0,.38);
}
.gem.zoom { --k: 5; }
.v-glint .gem { --tl: color-mix(in srgb, var(--a) 55%, white); --tc: color-mix(in srgb, color-mix(in srgb, var(--a) 35%, var(--c)) 58%, white); }
.v-glint2 .gem { --tl: color-mix(in srgb, var(--a) 80%, white); --tc: color-mix(in srgb, color-mix(in srgb, var(--a) 50%, var(--c)) 62%, white); --ml: var(--tc); }
.v-swapped .gem { --tl: color-mix(in srgb, var(--a) 80%, white); --tc: color-mix(in srgb, color-mix(in srgb, var(--a) 50%, var(--c)) 62%, white); --ml: var(--tc); }
.v-heart .gem { --mc: var(--a); }
.v-luster .gem { --mr: color-mix(in srgb, var(--a) 80%, black); --bc: color-mix(in srgb, var(--a) 80%, black); --br: color-mix(in srgb, var(--a) 60%, black); }
.v-gleam .gem { --over: radial-gradient(circle at 22% 18%, rgba(255,255,255,.75) 0, rgba(255,255,255,0) 18%), linear-gradient(135deg, transparent 30%, color-mix(in srgb, var(--a) 55%, transparent) 40%, color-mix(in srgb, var(--a) 55%, transparent) 46%, transparent 56%); }
.v-sheen .gem { --over: linear-gradient(135deg, transparent 28%, color-mix(in srgb, var(--a) 75%, transparent) 40%, color-mix(in srgb, var(--a) 75%, transparent) 50%, transparent 62%); }
</style>
<h1>Gem samples (current palette)</h1>
<section class="window ref"><div><h2>FF8 reference</h2><p>gem-ref.png at 1x, and its gem zoomed.</p><img src="${REF}"></div><div class="zoomref"></div></section>
${sections}`);
console.log(`Wrote ${OUT}`);
