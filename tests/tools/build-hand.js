// Builds the hand SVG from the traced outline of the reference cursor, then adds the thumb,
// finger crease and shading at their measured positions. The outline stroke is clipped to the
// inside of the traced edge, so the outer shape matches the reference exactly.
const fs = require('fs');
const path = require('path');
const { box: [x0, y0, x1, y1], points } = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/cursor-outline.json'), 'utf8'));
const W = 100, H = 50, PAD = 1;
const sx = (x) => PAD + ((x - x0) / (x1 - x0)) * W;
const sy = (y) => PAD + ((y - y0) / (y1 - y0)) * H;
const outline = `M${points.map(([x, y]) => `${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join('L')}Z`;
const X = (f) => (PAD + f * W).toFixed(1), Y = (f) => (PAD + f * H).toFixed(1);
const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W + 2 * PAD} ${H + 2 * PAD}'>`
  + `<defs><clipPath id='c'><path d='${outline}'/></clipPath>`
  + `<radialGradient id='s' cx='.52' cy='.2' r='.85'><stop offset='0' stop-color='#fff'/><stop offset='.32' stop-color='#f3f3f3'/><stop offset='.68' stop-color='#b4b4b4'/><stop offset='1' stop-color='#717171'/></radialGradient></defs>`
  + `<g clip-path='url(#c)'>`
  + `<path d='${outline}' fill='url(#s)'/>`
  // grey thumb ball tucked under the finger, blending into the fist's shadow
  + `<ellipse cx='${X(0.745)}' cy='${Y(0.665)}' rx='${(0.08 * W).toFixed(1)}' ry='${(0.155 * H).toFixed(1)}' fill='#6c6c6c'/>`
  + `<ellipse cx='${X(0.725)}' cy='${Y(0.6)}' rx='${(0.035 * W).toFixed(1)}' ry='${(0.055 * H).toFixed(1)}' fill='#7e7e7e'/>`
  // soft shading under the finger, separating it from the fist
  + `<path d='M${X(0.48)} ${Y(0.47)}Q${X(0.6)} ${Y(0.43)} ${X(0.72)} ${Y(0.45)}' fill='none' stroke='#a2a2a2' stroke-width='3.4' stroke-linecap='round'/>`
  // short, faint creases of the curled fingers
  + `<path d='M${X(0.4)} ${Y(0.3)}Q${X(0.44)} ${Y(0.45)} ${X(0.47)} ${Y(0.6)}M${X(0.47)} ${Y(0.22)}Q${X(0.5)} ${Y(0.33)} ${X(0.53)} ${Y(0.42)}' fill='none' stroke='#cbcbcb' stroke-width='2' stroke-linecap='round'/>`
  // the black outline, inside the traced edge
  + `<path d='${outline}' fill='none' stroke='#151515' stroke-width='4.6' stroke-linejoin='round'/>`
  + `</g></svg>`;
fs.writeFileSync(path.join(__dirname, 'data/hand.svg'), svg);

// Put it into the app's stylesheet as the --hand cursor image.
const cssPath = path.join(__dirname, '../../app/style.css');
const css = fs.readFileSync(cssPath, 'utf8');
const encoded = svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E');
const updated = css.replace(/--hand: url\("data:image\/svg\+xml,[^"]*"\);/, `--hand: url("data:image/svg+xml,${encoded}");`);
if (updated === css && !css.includes(encoded)) throw new Error('Could not find --hand in style.css');
fs.writeFileSync(cssPath, updated);
console.log('outline points:', points.length, ' svg bytes:', svg.length);
