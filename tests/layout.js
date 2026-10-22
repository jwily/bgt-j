// Third pass: layout checks that used to be one-off measurements, now pass/fail.
// Runs on the shortest current iPhone (13 mini), an iPhone SE (3rd gen), an iPhone 13, and the
// user's own iPhone 14 Pro.
// (Sizes are Safari's visible area; as a home-screen app the screen is taller still.)
const { chromium, webkit, devices } = require('playwright');
const { asInstalledApp, mockRates } = require('./helpers');
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
    await mockRates(context, '{"date":"2026-10-20","rates":{"MXN":18.5}}');
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

    // The chosen currency is centered in the Amount window (the hand beside it doesn't count),
    // whichever it is, and switching doesn't shift anything up or down.
    const opts = () => page.evaluate(() => {
      const on = document.querySelector('.currency-opts .on').getBoundingClientRect();
      const zone = document.querySelector('.currency-zone').getBoundingClientRect();
      return { top: Math.round(on.top * 10) / 10, offset: Math.round(on.left + on.width / 2 - (zone.left + zone.width / 2)) };
    });
    const usd = await opts();
    await page.locator('.currency-zone').tap();
    await page.waitForTimeout(350); // the row's 0.2s glide
    const mxn = await opts();
    check(`${name}: chosen currency centered (USD, then MXN)`, Math.abs(usd.offset) <= 1 && Math.abs(mxn.offset) <= 1, `${usd.offset}px, ${mxn.offset}px`);
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

    // Top to bottom: amount, note + date, category strip (changed more often, so nearer the thumb), keypad.
    const order = await page.evaluate(() => ['.currency-zone', '.details', '.strip-window', '#view-input .keypad']
      .map((s) => document.querySelector(s).getBoundingClientRect().top)
      .every((top, i, tops) => i === 0 || top > tops[i - 1]));
    check(`${name}: main screen order is amount, note/date, category, keypad`, order);

    // ADD, Undo and Menu sit side by side in the bottom bar, in that order, and ADD's hand stays
    // clear of its label even when Undo is showing and ADD is at its narrowest.
    const bar = await page.evaluate(() => {
      const undo = document.getElementById('undo-btn');
      undo.hidden = false;
      const u = undo.getBoundingClientRect();
      const add = document.querySelector('.add-btn'), nav = document.getElementById('nav-btn');
      const a = add.getBoundingClientRect(), n = nav.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(add);
      const hand = getComputedStyle(add, '::after');
      const label = range.getBoundingClientRect();
      const handGap = Math.round(label.left - (a.left + parseFloat(hand.left) + parseFloat(hand.width)));
      const labelOffset = Math.round(label.left + label.width / 2 - (a.left + a.width / 2));
      undo.hidden = true;
      return {
        sideBySide: Math.abs(a.top - n.top) < 1 && a.right <= u.left && u.right <= n.left,
        atBottom: a.bottom >= window.innerHeight - 50,
        handGap,
        labelOffset,
      };
    });
    check(`${name}: ADD, Undo, Menu in a row at the bottom`, bar.sideBySide && bar.atBottom, bar);
    check(`${name}: ADD's hand clear of its label`, bar.handGap >= 6, `${bar.handGap}px`);
    check(`${name}: ADD's label centered despite the hand`, Math.abs(bar.labelOffset) <= 1, `${bar.labelOffset}px`);

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
    // The gauge's number sits under the bar's right end, lined up with the amount above it; the
    // gem keeps clear of the window's edge and the name.
    const gauge = await page.evaluate(() => {
      const head = document.querySelector('.cat-head');
      const box = (sel) => head.querySelector(sel).getBoundingClientRect();
      const [bar, number, value, dot, label] = ['.gauge .bar', '.gauge .number', '.value', '.dot', '.name'].map(box);
      return { top: number.top - bar.top, height: bar.height, offset: number.right - value.right, edge: dot.left - head.getBoundingClientRect().left, room: label.left - dot.right };
    });
    check(`${name}: gauge number under the bar's end, lined up with the amount`,
      gauge.top > gauge.height / 3 && gauge.top < gauge.height && Math.abs(gauge.offset) <= 4, JSON.stringify(gauge));
    check(`${name}: summary gem has room on both sides`, gauge.edge >= 2 && gauge.room >= 12, JSON.stringify(gauge));
    // Edit Expense: every field the same width, inside the sheet, and the same height (the date
    // field used to stick out past the sheet on iOS).
    await page.locator('.item').first().tap();
    await page.waitForSelector('#sheet-backdrop.open');
    const fields = await page.evaluate(() => {
      const sheet = document.getElementById('sheet').getBoundingClientRect();
      const inputs = [...document.querySelectorAll('#sheet .field input')].map((n) => n.getBoundingClientRect());
      return { inside: inputs.every((r) => r.left >= sheet.left && r.right <= sheet.right),
        same: new Set(inputs.map((r) => `${r.left},${r.right},${r.height}`)).size };
    });
    check(`${name}: Edit Expense fields line up inside the sheet`, fields.inside && fields.same === 1, JSON.stringify(fields));
    await context.close();
  }
  // The user's iPhone 14 Pro as the installed app (the full 393×852 screen, taller than Safari's
  // visible area above): the main screen fits without scrolling.
  {
    const context = await browser.newContext({ ...devices['iPhone 14 Pro'], viewport: { width: 393, height: 852 } });
    await mockRates(context, '{"date":"2026-10-20","rates":{"MXN":18.5}}');
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8765/');
    for (const k of '200000') await page.locator('#page .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
    await page.locator('#page .primary').tap();
    await page.waitForTimeout(400);
    check('14 Pro installed: the main screen fits without scrolling', await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1));
    // Categories: each remove button's ✕ has the same space on both sides (to the name field, to
    // the window's inner edge).
    await page.locator('#nav-btn').tap();
    await page.waitForSelector('#menu-backdrop.open');
    await page.locator('#menu button', { hasText: 'Categories' }).tap();
    await page.waitForTimeout(400);
    const x = await page.evaluate(() => {
      const row = document.querySelector('.cat-row'), input = row.querySelector('input').getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(row.querySelector('.mini')); const glyph = range.getBoundingClientRect();
      const win = row.closest('.window'), inner = win.getBoundingClientRect().right - parseFloat(getComputedStyle(win).borderRightWidth) - 2;
      return { left: Math.round(glyph.left - input.right), right: Math.round(inner - glyph.right) };
    });
    check('14 Pro installed: the remove ✕ has equal space on both sides', Math.abs(x.left - x.right) <= 1, x);
    await page.screenshot({ path: require('path').join(__dirname, 'output', ENGINE, 'installed-14pro-main.png') });
    await context.close();
  }

  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No console errors');
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e.message); process.exit(1); });
