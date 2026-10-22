// Writes the launch screens iOS shows while a home-screen app starts (before the page has loaded):
// plain black, like the app's background, so starting up goes black to black instead of flashing
// iOS's default. iOS needs one image per screen size, in pixels. Writes app/icons/launch-*.png and
// prints the <link> tags for index.html. Usage: node tools/make-splash.js
const { chromium } = require('playwright');
const path = require('path');

// width x height in points, and pixels per point: the iPhones of the last several years.
const SCREENS = [
  [375, 667, 2],  // SE (2nd/3rd gen), 8
  [375, 812, 3],  // 12/13 mini, X, XS, 11 Pro
  [390, 844, 3],  // 12, 13, 14
  [393, 852, 3],  // 14 Pro, 15, 15 Pro, 16
  [402, 874, 3],  // 16 Pro
  [414, 896, 2],  // XR, 11
  [414, 896, 3],  // XS Max, 11 Pro Max
  [428, 926, 3],  // 12/13 Pro Max, 14 Plus
  [430, 932, 3],  // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  [440, 956, 3],  // 16 Pro Max
];

(async () => {
  const browser = await chromium.launch();
  const links = [];
  for (const [w, h, dpr] of SCREENS) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    await page.setContent('<body style="margin:0;background:#000"></body>');
    const file = `launch-${w * dpr}x${h * dpr}.png`;
    await page.screenshot({ path: path.join(__dirname, '../../app/icons', file) });
    await page.close();
    links.push(`  <link rel="apple-touch-startup-image" href="icons/${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)">`);
  }
  await browser.close();
  console.log(links.join('\n'));
})();
