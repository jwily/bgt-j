// Third pass: layout checks that used to be one-off measurements, now pass/fail.
// Runs on the shortest current iPhone (13 mini), an iPhone SE (3rd gen), an iPhone 13, and the
// user's own iPhone 14 Pro.
// (Sizes are Safari's visible area; as a home-screen app the screen is taller still.)
const { chromium, webkit, devices } = require('playwright');
const { asInstalledApp } = require('./helpers');
const ENGINE = process.env.ENGINE || 'chromium';
let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
};

(async () => {
  const browser = asInstalledApp(ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch());
  const errors = [];
  for (const [name, device] of [['13 mini', devices['iPhone 13 Mini']], ['SE 3', devices['iPhone SE (3rd gen)']], ['13', devices['iPhone 13']], ['14 Pro', devices['iPhone 14 Pro']]]) {
    const context = await browser.newContext(device);
    await context.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"date":"2026-10-20","rates":{"MXN":18.5}}' }));
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8765/');
    // The budget screen covers the main keypad, so tap whichever keypad is showing.
    const key = async (k) => {
      const scope = (await page.locator('#page').isVisible()) ? '#page' : '#view-input';
      await page.locator(`${scope} .key`).filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
    };

    // Budget screen: the confirm label is centered despite the hand beside it.
    for (const k of '200000') await key(k);
    const labelOffset = await page.locator('#page .primary').evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect(), box = button.getBoundingClientRect();
      return Math.round((text.left + text.width / 2) - (box.left + box.width / 2));
    });
    check(`${name}: budget confirm label centered`, Math.abs(labelOffset) <= 1, `${labelOffset}px`);
    await page.locator('#page .primary').tap();
    await page.waitForTimeout(400);

    // USD/MXN: centered as a pair (the hand doesn't count), and no vertical shift when switching.
    const opts = () => page.evaluate(() => {
      const [usd, mxn] = document.querySelectorAll('.currency-opts span');
      const zone = document.querySelector('.currency-zone').getBoundingClientRect();
      const a = usd.getBoundingClientRect(), b = mxn.getBoundingClientRect();
      return { top: Math.round(a.top * 10) / 10, offset: Math.round((a.left + b.right) / 2 - (zone.left + zone.width / 2)) };
    });
    const usd = await opts();
    await page.locator('.currency-opts').tap();
    await page.waitForTimeout(300);
    const mxn = await opts();
    check(`${name}: USD/MXN pair centered`, Math.abs(mxn.offset) <= 1, `${mxn.offset}px`);
    check(`${name}: no vertical shift switching currency`, usd.top === mxn.top, `${usd.top} -> ${mxn.top}`);

    // Worst-case amount fits on one line; nothing scrolls off the page.
    for (let i = 0; i < 7; i++) await key('9');
    const fit = await page.evaluate(() => ({
      amountFits: document.querySelector('.amount').scrollWidth <= document.querySelector('.currency-zone').clientWidth,
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
    }));
    check(`${name}: MX$9,999,999 fits`, fit.amountFits);
    check(`${name}: main screen doesn't scroll`, !fit.pageScrolls);

    // Every category: no name cut off, [gem] Name centered when selected, hand clear of the gem.
    const names = await page.locator('.strip .chip').allTextContents();
    const cut = await page.evaluate(() => [...document.querySelectorAll('.strip .chip span')].filter((s) => s.scrollWidth > s.clientWidth).map((s) => s.textContent));
    check(`${name}: no category names cut off`, cut.length === 0, cut);
    let worstOffset = 0, smallestGap = Infinity;
    for (const n of names) {
      await page.locator('.strip .chip', { hasText: n }).first().tap();
      await page.waitForTimeout(650);
      const m = await page.evaluate(() => {
        const strip = document.querySelector('.strip').getBoundingClientRect();
        const chip = document.querySelector('.strip .chip.selected');
        const box = chip.getBoundingClientRect();
        const gemLeft = box.left + parseFloat(getComputedStyle(chip, '::before').left) - 2; // the rotated diamond pokes out ~2px
        const textRight = chip.querySelector('span').getBoundingClientRect().right;
        const hand = getComputedStyle(chip, '::after');
        const handRight = box.left + parseFloat(hand.left) + parseFloat(hand.width);
        return { offset: Math.round((gemLeft + textRight) / 2 - (strip.left + strip.width / 2)), gap: Math.round(gemLeft - handRight) };
      });
      if (Math.abs(m.offset) > Math.abs(worstOffset)) worstOffset = m.offset;
      smallestGap = Math.min(smallestGap, m.gap);
    }
    check(`${name}: every category centered when selected`, Math.abs(worstOffset) <= 2, `worst ${worstOffset}px`);
    check(`${name}: hand stays clear of the diamond`, smallestGap >= 8, `${smallestGap}px`);

    // A long note must not make the summary wider than the screen (it ends in "…" instead).
    await key('⌫'); // clear the 9s typed above (hold ⌫)
    const back = page.locator('#view-input .key').filter({ hasText: /^⌫$/ });
    await back.hover();
    await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
    await key('5');
    await page.locator('.note').fill('A very long note that goes on and on well past the width of any phone screen');
    await page.locator('.add-btn').tap();
    await page.waitForSelector('#help:not(.message)', { timeout: 6000 });
    await page.locator('#help').click({ position: { x: 20, y: 30 } });
    await page.waitForTimeout(300);
    await page.locator('.cat-head').first().tap();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.getElementById('page').scrollWidth - document.getElementById('page').clientWidth);
    check(`${name}: summary never wider than the screen`, overflow <= 0, `${overflow}px too wide`);
    await context.close();
  }
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No console errors');
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e.message); process.exit(1); });
