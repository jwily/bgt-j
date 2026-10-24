// Category colors. Categories never pick one: they take them in turn (see assignColors in store.js).

// 16 colors, each loosely after one of FF8's Guardian Force portraits, in the order the GFs appear
// in the game's GF menu: [base, accent]. Categories take them in turn. The base is the category's
// color everywhere (gauges, the spending ring, ...); the accent, a second color from the same portrait, is
// only the glint on its gem, so it's always a light one: where the portrait's color is dark (a red
// eye, a ruby), it's that color lit. (Cerberus is steel grey: a true near-black would vanish in
// the gauges.) (Every pair is at least 10 apart in OKLab
// distance x100, where under ~10 starts to look alike; check with npm run palette.)
const PALETTE = [
  ['#94cc3a', '#ffd43f'], // Quezacotl: yellow-green, the yellow its tail fades to
  ['#8fd0f5', '#f7dc7a'], // Shiva: ice blue, golden hair
  ['#e2682b', '#f6c445'], // Ifrit: burnt orange, gold earring
  ['#f2bd33', '#ffc4cc'], // Siren: gold, rose lips
  ['#6250d0', '#e2c26a'], // Brothers: indigo, horns
  ['#b3173c', '#f2d043'], // Diablos: crimson, yellow eye
  ['#45d6a8', '#ffbccb'], // Carbuncle: mint, ruby (lit)
  ['#1f8e9e', '#a6ead9'], // Leviathan: deep teal, pale fins
  ['#a64ee0', '#f2d443'], // Pandemona: violet, yellow eyes
  ['#8a93a3', '#ff9a88'], // Cerberus: steel grey, red eyes (lit)
  ['#e0a2d8', '#f6d65a'], // Alexander: lavender-pink, gold trim
  ['#7d4a28', '#a77be8'], // Doomtrain: dark bronze, purple glow
  ['#253f84', '#bfcbe8'], // Bahamut: dark steel blue, silver
  ['#3aa64a', '#ffad6b'], // Cactuar: cactus green, spikes
  ['#6f7e1c', '#ffd84a'], // Tonberry: olive, lantern
  ['#28b4ff', '#d7c2ff'], // Eden: electric blue, violet streaks
];

// The color for the category in position i (alphabetical, active first), wrapping after 16.
export const paletteColor = (i) => PALETTE[i % PALETTE.length][0];

// The accent that goes with a palette color (the color itself for any other color).
export const accentFor = (color) => PALETTE.find(([base]) => base === color)?.[1] ?? color;
