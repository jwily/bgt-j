// Samples for replacing the summary's donut with a bar after Squall's Renzokuken limit break
// (renzo.mov): spending as colored "waves" in a black lane, unspent left black. Measured from the
// clip (1402px wide): the lane is black, 78px tall in a light grey bevel (#8f8f8f, a dark line
// inside); its left end is a black box (9.5% of the lane) and the grey trigger box (#545454, 14.8%),
// each closed by an I-beam tick (#c0c0c0, flared top and bottom); a wave is flat top to bottom,
// brightest at its hard leading edge (#4c44a5, a 1px darker line just before it) and fades evenly to
// black over about a fifth of the lane; the frame turns #d0da00 on a trigger. Each style is shown in
// a grey window and on the black, with the app's own window CSS, at phone width.
// Usage: npm run waves
const fs = require('fs');
const path = require('path');
const palette = require('../helpers').readPalette();
const CSS = 'file://' + path.join(__dirname, '..', '..', 'app', 'style.css');
const OUT = path.join(__dirname, '..', 'output', 'wave-samples.html');
const byName = Object.fromEntries(palette.map((p) => [p.name, p.hex]));
// Spending as shares of the budget, in category order.
const SCENARIOS = [
  ['A typical period: 9 categories, 60% spent', palette.slice(0, 9).map((p, i) => [p.hex, [18, 9, 4.5, 15.5, 2, 6, 1, 3, 1][i]])],
  ['The test data: $510.50 and $12.50 of $2,000', [[palette[0].hex, 25.5], [palette[1].hex, 0.6]]],
  ['The darkest colors, 65% spent', ['Bahamut', 'Doomtrain', 'Tonberry', 'Leviathan', 'Brothers'].map((n, i) => [byName[n], [20, 15, 12, 10, 8][i]])],
  ['Over budget: 115% spent', palette.slice(0, 6).map((p, i) => [p.hex, [40, 25, 20, 15, 10, 5][i]])],
];
const STYLES = [
  ['w1', 'W1. Faithful', 'Each category is one wave: hard leading edge, fading all the way to black, as in FF8.'],
  ['w2', 'W2. Partial fade', 'Each wave fades only to 40%, so its full length (and the end of spending) stays readable.'],
  ['w3', 'W3. Wave train', 'Each category is a run of short FF8 waves in its color, closest to the clip, but one category reads as several.'],
];
function bar([title, chunks]) {
  const spent = chunks.reduce((s, [, v]) => s + v, 0);
  const whole = Math.max(100, spent);
  let at = 0;
  const waves = chunks.map(([color, v], i) => {
    const w = `<span class="wave" style="--c:${color};left:${(at / whole) * 100}%;width:${(v / whole) * 100}%;--i:${i}"></span>`;
    at += v; return w;
  }).join('');
  return `<div class="case"><div class="case-title">${title}</div>
    <div class="lane${spent > 100 ? ' over' : ''}"><span class="box1"></span><span class="box2"></span><span class="track">${waves}</span><span class="tick" style="left:9.5%"></span><span class="tick" style="left:24.3%"></span></div></div>`;
}
const cases = SCENARIOS.map(bar).join('');
// The same waves as a ring: clockwise from 12 o'clock, each wave's hard leading edge first, fading
// to 40% (W2); unspent left black; the total in the middle, as on the donut.
function ring([title, chunks]) {
  const spent = chunks.reduce((s, [, v]) => s + v, 0);
  const whole = Math.max(100, spent);
  let at = 0;
  const stops = chunks.map(([color, v]) => {
    const a = (at / whole) * 360, b = ((at + v) / whole) * 360; at += v;
    return `${color} ${a}deg, color-mix(in oklab, ${color} 40%, black) ${b}deg`;
  }).join(', ');
  const amount = '$' + (spent * 20).toLocaleString('en-US', { minimumFractionDigits: 2 });
  return `<div class="case"><div class="case-title">${title}</div>
    <div class="ring${spent > 100 ? ' over' : ''}" style="--waves: conic-gradient(${stops}, #000 ${(at / whole) * 360}deg 360deg)"><div class="ring-center"><strong>${amount}</strong><span>spent</span></div></div></div>`;
}
const rings = SCENARIOS.map(ring).join('');
const ringSection = `
<section class="v-ring"><h2>R. Ring (W2 waves)</h2><p>The same partial-fade waves around a ring in FF8's bevel, clockwise from 12 o'clock, the total in the middle; it sweeps in instead of sliding.</p>
  <div class="cols">
    <div class="col"><div class="label">In a grey window</div><div class="window" data-label="Spent"><div class="ring-grid">${rings}</div></div></div>
    <div class="col"><div class="label">On the black</div><div class="bare"><div class="ring-grid">${rings}</div></div></div>
  </div>
</section>`;
const sections = STYLES.map(([id, title, text]) => `
<section class="v-${id}"><h2>${title}</h2><p>${text}</p>
  <div class="cols">
    <div class="col"><div class="label">In a grey window</div><div class="window" data-label="Spent">${cases}</div></div>
    <div class="col"><div class="label">On the black</div><div class="bare">${cases}</div></div>
  </div>
</section>`).join('');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `<!doctype html><meta charset="utf-8"><title>Renzokuken bar samples</title>
<link rel="stylesheet" href="${CSS}">
<style>
html, body { height: auto; overflow: auto; }
body { padding: 24px; -webkit-user-select: text; user-select: text; }
h1 { font-size: 22px; margin: 0 0 6px; } h2 { margin: 0 0 4px; font-size: 18px; } p { margin: 0 0 12px; color: var(--soft); font-size: 14px; }
button.replay { margin: 0 0 18px; padding: 8px 14px; font: inherit; color: #000; background: #d0da00; border: 0; cursor: pointer; text-shadow: none; }
section { margin: 0 0 30px; }
.cols { display: flex; flex-wrap: wrap; gap: 24px; }
.col { width: 358px; } /* the summary's content width on a 390px-wide iPhone */
.label { margin: 0 0 6px; color: var(--soft); font-size: 13px; }
.col .window { position: relative; padding: 18px 12px 4px; }
.bare { padding: 6px 0; }
.case { margin-bottom: 14px; }
.case-title { margin-bottom: 5px; font-size: 12px; color: var(--soft); }

/* The lane: black inside a light grey bevel with a dark inner line, as in FF8. */
.lane {
  position: relative; height: 26px; overflow: hidden;
  background: #000;
  border: 2px solid #8f8f8f;
  box-shadow: inset 0 0 0 1px #1f1f1f, 0 0 0 1px #4a4a4a;
}
.lane.over { border-color: #d0da00; }
.box1, .box2 { position: absolute; top: 0; bottom: 0; }
.box1 { left: 0; width: 9.5%; background: #000; }
.box2 { left: 9.5%; width: 14.8%; background: #545454; }
/* The I-beam ticks, over the waves. */
.tick { position: absolute; z-index: 2; top: 0; bottom: 0; width: 1.4px; margin-left: -0.7px; background: #c0c0c0; }
.tick::before, .tick::after { content: ''; position: absolute; left: -1.6px; width: 4.6px; height: 2px; background: #d5d2d1; }
.tick::before { top: 0; } .tick::after { bottom: 0; }
.lane.over .tick, .lane.over .tick::before, .lane.over .tick::after { background: #d0da00; }
/* The waves run in the main lane, right of the trigger box; the budget is its full length. */
.track { position: absolute; top: 0; bottom: 0; left: calc(24.3% + 1px); right: 0; overflow: hidden; }
.lane.over .box2 { background: #6e6e6e; } /* lit, as during a trigger */

/* A wave: flat top to bottom, brightest at its hard leading edge (a 1px darker line just before). */
.wave { position: absolute; z-index: 1; top: 0; bottom: 0; box-shadow: inset 1px 0 0 color-mix(in oklab, var(--c) 65%, black); }
.v-w1 .wave { background: linear-gradient(to right, var(--c), black); }
.v-w2 .wave { background: linear-gradient(to right, var(--c), color-mix(in oklab, var(--c) 40%, black)); }
.v-w3 .wave { background: repeating-linear-gradient(to right, var(--c) 0, color-mix(in oklab, var(--c) 30%, black) 34px); }
/* The ring: the waves in a channel (r 66%-94% of the radius, like the donut's), inside FF8's light
   grey bevel with a dark line along each edge. */
.ring-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; }
.ring { --bevel: #8f8f8f; position: relative; width: 100%; aspect-ratio: 1; border-radius: 50%;
  background: radial-gradient(circle closest-side, transparent 62%, #1f1f1f 62.5%, var(--bevel) 63.5% 66%, #1f1f1f 66.5%, transparent 67%, transparent 93%, #1f1f1f 93.5%, var(--bevel) 94% 97%, #4a4a4a 97.5%, transparent 98%),
    radial-gradient(circle closest-side, transparent 66.5%, #000 66.5% 93.5%, transparent 93.5%); }
.ring.over { --bevel: #d0da00; }
.ring::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: var(--waves);
  -webkit-mask: radial-gradient(circle closest-side, transparent 66.5%, #000 66.5% 93.5%, transparent 93.5%);
  mask: radial-gradient(circle closest-side, transparent 66.5%, #000 66.5% 93.5%, transparent 93.5%); }
.ring-center { position: absolute; z-index: 1; inset: 0; display: grid; place-content: center; text-align: center; }
.ring-center strong { font-size: 0.95rem; font-variant-numeric: tabular-nums; }
.ring-center span { color: var(--soft); font-size: 0.6rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
/* Sweeping in: a black cover over the part of the channel not yet reached, shrinking clockwise. */
@property --sweep { syntax: '<angle>'; inherits: false; initial-value: 360deg; }
.ring::after { content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(transparent var(--sweep), #000 var(--sweep));
  -webkit-mask: radial-gradient(circle closest-side, transparent 66.5%, #000 66.5% 93.5%, transparent 93.5%);
  mask: radial-gradient(circle closest-side, transparent 66.5%, #000 66.5% 93.5%, transparent 93.5%); }
body.play .ring::after { animation: ring-in 0.9s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
@keyframes ring-in { from { --sweep: 0deg; } }
/* Sliding in from the right, one after another, as the waves come in on Renzokuken. */
body.play .wave { animation: wave-in 0.7s cubic-bezier(0.2, 0.7, 0.3, 1) both; animation-delay: calc(var(--i) * 0.09s); }
@keyframes wave-in { from { left: 100%; } }
</style>
<h1>Renzokuken bar samples (current palette)</h1>
<p>In place of the donut: spending as waves in the main lane (right of the trigger box; the two boxes at the left are FF8's, as decoration), unspent left black. Over budget, the frame and ticks turn trigger yellow and the trigger box lights up, as on a trigger. Each style in a grey window and on the black.</p>
<button class="replay" onclick="document.body.classList.remove('play'); void document.body.offsetWidth; document.body.classList.add('play');">Replay the slide-in</button>
${sections}${ringSection}
<script>document.body.classList.add('play');</script>`);
console.log(`Wrote ${OUT}`);
