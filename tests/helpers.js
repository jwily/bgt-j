// Shared test helpers.
//
// Captures exported files on either path the app uses:
// WebKit has the share sheet (like iPhone), so we stand in for it; Chromium falls back to a download.
const fs = require('fs');
exports.fakeShareSheet = (context) => context.addInitScript(() => {
  window.__shared = [];
  window.__shareMode = 'save';
  if (!navigator.canShare) return;
  navigator.share = async ({ files }) => {
    if (window.__shareMode === 'cancel') throw new DOMException('cancelled', 'AbortError');
    window.__shared.push({ name: files[0].name, text: await files[0].text() });
  };
});
exports.grabFile = async (page, engine, action) => {
  if (engine === 'webkit') {
    await action();
    await page.waitForTimeout(300);
    return page.evaluate(() => window.__shared.at(-1));
  }
  const [download] = await Promise.all([page.waitForEvent('download'), action()]);
  return { name: download.suggestedFilename(), text: fs.readFileSync(await download.path(), 'utf8') };
};

// FF8 layout helpers: "left" lives in the menu's stats box; the screen name is in the title window.
exports.leftText = async (page) => `${await page.locator('#stat-left').textContent()} ${(await page.locator('#stat-left-label').textContent()).toLowerCase()}`;
exports.titleText = async (page) => (await page.locator('#nav-btn').textContent()).replace(/^‹ /, '');
exports.openSummary = async (page) => {
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(250);
  await page.locator('#menu button', { hasText: 'Current Period' }).tap();
  await page.waitForTimeout(250);
};
