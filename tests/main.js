// Main pass: the core flow from first launch through entering, editing, summaries, periods,
// categories and backups.
const { chromium, webkit, devices } = require('playwright');
const ENGINE = process.env.ENGINE || 'chromium';
const fs = require('fs');
const { fakeShareSheet, grabFile, spentText, titleText, openSummary, openMenu, asInstalledApp, mockRates, readPalette, categoryRows, categoryDotColors, check, saved, localToday } = require('./helpers');
const OUT = require('path').join(__dirname, 'output', process.env.ENGINE || 'chromium'); // screenshots and exported files, one folder per engine so runs can overlap (not committed)

// FF8's six party members, one of whom wanders the main screen.
const PARTY = ['Squall', 'Zell', 'Irvine', 'Quistis', 'Rinoa', 'Selphie'];

// The summary's spending ring: each wave's color and start and end angles (clockwise from 12
// o'clock), how much of the ring the waves cover (0–1), and whether it's over budget.
const ringWaves = (page) => page.evaluate(() => {
  const ring = document.querySelector('.ring-chart');
  const waves = [...ring.querySelectorAll('.wave')].map((w) => ({
    color: w.style.getPropertyValue('--c').trim(),
    from: parseFloat(w.style.getPropertyValue('--from')),
    to: parseFloat(w.style.getPropertyValue('--from')) + parseFloat(w.style.getPropertyValue('--len')),
  }));
  return { waves, drawn: ((waves.at(-1)?.to ?? 0) / 360).toFixed(2), over: ring.classList.contains('over') };
});

(async () => {
  const browser = asInstalledApp(ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch());
  const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'light' });
  await fakeShareSheet(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await mockRates(page, JSON.stringify({ amount: 1, base: 'USD', date: localToday(), rates: { MXN: 20 } })); // today's, so no "rate from" date
  await page.goto('http://localhost:8765/');

  const sheetKey = (k) => page.locator('#page .key', { hasText: new RegExp(`^${k === '⌫' ? '⌫' : k}$`) }).first().tap();
  const mainKey = (k) => page.locator('#view-input .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();

  // First budget
  check('first-launch budget screen', await titleText(page), 'First Budget');
  for (const k of '200000') await sheetKey(k);
  check('budget display', await page.locator('.budget-amount').textContent(), '$2,000.00');
  await page.locator('#page .primary').tap();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${ENGINE}-1-main-empty.png` });

  // A party member, one of FF8's six, wanders along the top of Note and Date; taps go through it.
  const member = await page.evaluate(() => {
    const m = document.querySelector('.details .party-member');
    const box = m.getBoundingClientRect(), details = m.parentElement.getBoundingClientRect();
    return { name: m.dataset.member, sheet: getComputedStyle(m).backgroundImage.includes('sprites/party.png'), through: getComputedStyle(m).pointerEvents, standsOnTop: Math.abs(box.bottom - details.top) <= 3 };
  });
  check('party member: one of the six, from the sprite sheet, standing on Note and Date, taps go through',
    PARTY.includes(member.name) && member.sheet && member.through === 'none' && member.standsOnTop, true);
  // Its walking, standing and cheering, and the whole party assembling for a new period (on now), are
  // timed on a fake clock in more.js. The one who stays on is the first.
  // Coming back to the main screen from another, a different party member takes over.
  const before = await page.locator('.party-member').first().getAttribute('data-member');
  await openSummary(page);
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  const after = await page.locator('.party-member').first().getAttribute('data-member');
  check('back on the main screen, a different party member', after !== before && PARTY.includes(after), true);

  // USD entry with implied cents
  for (const k of '51050') await mainKey(k);
  check('USD 5-1-0-5-0', await page.locator('.amount').textContent(), '$510.50');
  await page.locator('.add-btn').tap();
  check('spent after $510.50', await spentText(page), '$510.50');
  check('toast', await page.locator('#help .text').first().textContent(), 'Added $510.50 · Groceries');

  // Currency switch: tap the choices
  await page.locator('.currency-opts').tap();
  for (const k of '250') await mainKey(k);
  check('MXN 2-5-0', await page.locator('.amount').textContent(), 'MX$250');
  check('conversion line', (await page.locator('.amount-sub span').allTextContents()).join(' | '), '≈ $12.82 | 1 USD = 19.50 MXN');
  // A tap anywhere in the Amount window (here, on the amount itself) picks the next currency,
  // wrapping around.
  await page.locator('.amount').tap();
  check('tap the amount -> USD (wraps around)', await page.locator('.currency-opts .on').textContent(), 'USD');
  const zoneBox = await page.locator('.currency-zone').boundingBox();
  await page.locator('.currency-zone').tap({ position: { x: 16, y: zoneBox.height - 16 } }); // an empty corner
  check('tap an empty corner -> MXN', await page.locator('.currency-opts .on').textContent(), 'MXN');
  // FF8's junction icon marks the chosen currency, in place of the hand, clear of its name.
  check('chosen currency marked with the junction icon', await page.evaluate(() => {
    const on = document.querySelector('.currency-opts .on');
    const mark = getComputedStyle(on, '::after');
    return [mark.backgroundImage.includes('svg'), parseFloat(mark.left) + parseFloat(mark.width) <= -4].join(' ');
  }), 'true true');
  check('digits kept after switching', await page.locator('.amount').textContent(), 'MX$250');
  check('the amount floats on black with FF8\'s dark grey shadow', await page.evaluate(() => {
    const zone = getComputedStyle(document.querySelector('.currency-zone'));
    return `${zone.backgroundColor} | ${getComputedStyle(document.querySelector('.amount')).textShadow.split(' ').slice(0, 3).join(' ')}`;
  }), 'rgba(0, 0, 0, 0) | rgb(58, 58, 58)');

  // Category: tap the third chip, wait for the snap
  check('strip is alphabetical', (await page.locator('.strip .chip').allTextContents()).join(','), 'Bills,Dining,Fun,Groceries,Health,Housing,Other,Shopping,Transport');
  await page.locator('.strip .chip', { hasText: 'Transport' }).tap();
  await page.waitForTimeout(700);
  check('selected category after tap', await page.locator('.strip .chip.selected').textContent(), 'Transport');
  // Category: scroll the strip by hand one chip to the left (chips vary in width, so measure)
  await page.locator('.strip').evaluate((s) => {
    const [a, b] = ['Shopping', 'Transport'].map((n) => [...s.children].find((c) => c.textContent === n));
    s.scrollBy({ left: (a.offsetLeft + a.offsetWidth / 2) - (b.offsetLeft + b.offsetWidth / 2) });
  });
  await page.waitForTimeout(500);
  check('selected category after scroll', await page.locator('.strip .chip.selected').textContent(), 'Shopping');
  await page.locator('.strip .chip', { hasText: 'Transport' }).tap();
  await page.waitForTimeout(700);
  await page.locator('.note').fill('Uber');
  await page.locator('.add-btn').tap();
  check('spent after MX$250', await spentText(page), '$523.32');
  check('currency remembered', await page.locator('.currency-opts .on').textContent(), 'MXN');
  check('note cleared', await page.locator('.note').inputValue(), '');
  await page.screenshot({ path: `${OUT}/${ENGINE}-2-main-mxn.png` });

  // Undo works
  for (const k of '100') await mainKey(k);
  await page.locator('.add-btn').tap();
  await page.locator('#undo-btn').tap();
  check('spent after undo', await spentText(page), '$523.32');
  check('undo stays on the main screen', await page.locator('#page').isHidden(), true);

  // Empty Add nudges, adds nothing
  await page.locator('.add-btn').tap();
  check('empty add ignored', await spentText(page), '$523.32');

  // Summary
  await openSummary(page);
  check('summary title', await titleText(page), 'Current Period');
  // Nothing of the main screen can show if iOS bounces this screen: it's hidden, and the page
  // itself can't bounce.
  const bounce = await page.evaluate(() => [
    getComputedStyle(document.getElementById('view-input')).visibility,
    getComputedStyle(document.body).overscrollBehaviorY,
    getComputedStyle(document.getElementById('page')).overscrollBehaviorY,
  ].join(' '));
  check('main screen hidden behind other screens, no page bounce', bounce, 'hidden none contain');
  check('ring center', await page.locator('.ring-center strong').textContent(), '$523.32');
  // The ring is drawn against the budget: $523 of $2,000 fills about a quarter of it, the rest
  // left black for what's unspent. Largest wave first, so the smallest comes last; each rises
  // from black to its color at its clockwise end.
  const ring = await ringWaves(page);
  check('ring: one wave per category', ring.waves.length, 2);
  check('ring leaves the unspent share black', ring.drawn, '0.26');
  check('ring: smallest wave first, largest last (so the first to fire is the largest)', ring.waves[0].to - ring.waves[0].from < ring.waves[1].to - ring.waves[1].from, true);
  check('ring: waves rise from black to their color', await page.evaluate(() => /conic-gradient\(rgb\(0, 0, 0\) 0deg, rgb\(\d+, \d+, \d+\) [\d.]+deg, rgba\(0, 0, 0, 0\)/.test(getComputedStyle(document.querySelector('.ring-chart .wave')).backgroundImage)), true);
  // Arriving, the furthest wave fires first (Transport, the smallest, ends furthest round); the next fires
  // when it's 85% of the way to its place; the whole is its natural length (0.43s at FF8's speed
  // here) to the power 0.3, times 0.85, so about 0.66s. Smooth, not stepped; the tick flashes as each fires.
  const cascade = await page.evaluate(() => {
    const timing = (el) => el.getAnimations()[0]?.effect.getComputedTiming();
    const [transport, groceries] = [...document.querySelectorAll('.ring-chart .wave')].map(timing);
    const flashes = [...document.querySelectorAll('.ring-chart .flash')].map((f) => Math.round(timing(f).delay));
    const easing = document.querySelector('.ring-chart .wave').getAnimations()[0].effect.getKeyframes()[0].easing;
    return {
      order: groceries.delay === 0 && transport.delay > 0, // Groceries, the largest, is furthest along
      handOff: Math.abs(transport.delay - 0.85 * groceries.duration) < 2,
      total: Math.abs(Math.max(groceries.delay + groceries.duration, transport.delay + transport.duration) - 551) < 10, // 0.85 * natural ^ 0.3 (was 660 with the largest first)
      smooth: !easing.startsWith('steps('),
      flashes: flashes.join(',') === [Math.round(transport.delay), 0].join(','),
    };
  });
  check('ring: furthest fires first, next at 85%, length squeezed toward 1s, smooth, tick flashes', JSON.stringify(cascade),
    JSON.stringify({ order: true, handOff: true, total: true, smooth: true, flashes: true }));
  check('ring: FF8 tick at 12 o\'clock, plain rim under budget', await page.evaluate(() => {
    const ring = document.querySelector('.ring-chart').getBoundingClientRect();
    const tick = document.querySelector('.ring-chart .tick').getBoundingClientRect();
    return Math.abs(tick.left + tick.width / 2 - (ring.left + ring.width / 2)) < 1 && tick.top - ring.top < ring.height * 0.1;
  }) && !ring.over, true);
  // The gauges' shares are out of 1000, like FF8's compatibility numbers: $510.50 and $12.50 of $523.
  check('gauge numbers out of 1000', (await page.locator('.gauge .number').allTextContents()).join(','), '976,24');
  check('window labels white, gauge numbers light grey', await page.evaluate(() => [
    getComputedStyle(document.querySelector('.window[data-label]'), '::before').color,
    getComputedStyle(document.querySelector('.gauge .number')).color,
  ].join(' ')), 'rgb(255, 255, 255) rgb(207, 207, 207)');
  // Every gauge's end shows: dark fills are lifted and end in a light tip, so the tip is always
  // well above the trough's lightness (OKLab L of #323232 is about 0.32).
  check('gauge fills end in a light tip', await page.evaluate(() => [...document.querySelectorAll('.gauge .bar span')].every((s) => {
    const tip = getComputedStyle(s).backgroundImage.match(/to left, (oklab|color)\(([^)]*)\)/);
    return tip && parseFloat(tip[2].replace(/^oklab /, '')) >= 0.7;
  })), true);
  check('diff', await page.locator('.stat.diff .value').textContent(), '+$1,476.68');
  await page.locator('.cat-head', { hasText: 'Transport' }).tap();
  await page.evaluate(() => window.dispatchEvent(new Event('budget:change'))); // a redraw (as when a save elsewhere lands)
  check('ring: a redraw doesn\'t replay the cascade', await page.evaluate(() => [...document.querySelectorAll('.ring-chart .wave')].every((w) => w.getAnimations().length === 0)), true);
  check('itemized MXN line', await page.locator('.item .orig').textContent(), 'from MX$250');
  check('itemized note', await page.locator('.item .what').first().textContent(), 'Uber');
  await page.screenshot({ path: `${OUT}/${ENGINE}-3-summary.png`, fullPage: true });
  await page.locator('.ring-chart').screenshot({ path: `${OUT}/${ENGINE}-ring.png` });

  // Edit the expense: 250 -> 300 pesos
  await page.locator('.item').first().tap();
  await page.waitForTimeout(300);
  await page.locator('#sheet input').first().fill('300');
  await page.locator('#sheet .primary').tap();
  check('edited MXN converts at saved rate', await page.locator('.ring-center strong').textContent(), '$525.88');

  // Edit budget
  await page.locator('.edit-budget').tap();
  await page.waitForTimeout(300);
  check('edit budget prefilled', await page.locator('.budget-amount').textContent(), '$2,000.00');
  await sheetKey('⌫');
  await page.locator('#page .primary').tap();
  check('budget edited', await page.locator('.stat .value').first().textContent(), '$200.00');
  check('over budget shown', await page.locator('.stat.diff .value').textContent(), '−$325.88');
  const overRing = await ringWaves(page);
  check('ring full when over budget, in trigger yellow', `${overRing.drawn} ${overRing.over}`, '1.00 true');
  await page.locator('#nav-btn').tap();
  check('menu shows what\'s spent, in red when over', `${await spentText(page)} ${await page.locator('#stat-spent').evaluate((e) => e.classList.contains('bad'))}`, '$525.88 true');
  await page.waitForSelector('#help:not(.message)', { timeout: 8000 });
  check('status row: HP in red and the bar empty when over', await page.evaluate(() => [
    document.querySelector('#help .hp').className, document.querySelector('#help .hp-bar span').style.width, document.querySelector('#help .hp b').textContent].join(' | ')),
    'stat hp over | 0% | −$325.88');

  // New Period
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  check('menu labels', (await page.locator('#menu button').allTextContents()).map((t) => t.replace(/Backup.*/, 'Backup')).join(','), 'Backup,Categories,New Period,Past Periods,Current Period'); // setup on top, periods nearest the thumb
  check('menu backup line', await page.locator('#backup-status').textContent(), 'never');
  check('backup line red', await page.locator('#backup-status.bad').count(), 1);
  check('dot on menu button', await page.locator('#nav-btn.alert').count(), 1);
  await page.locator('#menu button', { hasText: 'New Period' }).tap();
  await page.waitForTimeout(300);
  check('new period title', await titleText(page), 'New Period');
  const backupFile = await grabFile(page, ENGINE, () => page.locator('#page .wide-btn', { hasText: 'Back up first' }).tap());
  check('backup file name', /^bgt-j-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backupFile.name), true);
  fs.writeFileSync(`${OUT}/backup.json`, backupFile.text);
  await page.waitForTimeout(200);
  check('back up first button', await page.locator('#page .wide-btn').textContent(), 'Backed up ✓');
  check('dot cleared', await page.locator('#nav-btn.alert').count(), 0);
  check('menu backup line after', await page.locator('#backup-status').textContent(), 'today');
  for (const k of '150000') await sheetKey(k);
  await page.locator('#page .primary').tap();
  await page.waitForTimeout(300);
  check('nothing spent in new period', await spentText(page), '$0.00');
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  await page.locator('#menu button', { hasText: 'Past Periods' }).tap();
  check('period rows', await page.locator('.period-row').count(), 2);
  await page.locator('.period-row').nth(1).tap();
  check('past period title', await titleText(page), 'Period 1');
  check('past period has no Edit', await page.locator('.edit-budget').count(), 0);
  await page.locator('#nav-btn').tap();
  check('back to periods', await titleText(page), 'Past Periods');
  await page.locator('#nav-btn').tap();

  // Categories: edits are a draft until Save, which sorts them; colors always follow GF order down
  // the list. Add one, archive a used one, save.
  const gfOrder = readPalette().map((c) => c.hex);
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  await page.locator('#menu button', { hasText: 'Categories' }).tap();
  check('no color picker', await page.locator('.swatch, .palette').count(), 0);
  check('colors follow GF order alphabetically', await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('budget-tracker'));
    return s.categories.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 3).map((c) => c.color).join(',');
  }), '#94cc3a,#8fd0f5,#e2682b');
  check('no reorder arrows', await page.locator('.mini', { hasText: '↑' }).count(), 0);
  const saveButton = page.locator('#page .actions .primary', { hasText: 'Save' });
  check('Save is off until something changes', await saveButton.isDisabled(), true);
  // A slot for each of the 16 colors: the nine named, then seven empty ones (no gem yet) to fill in.
  check('16 slots: 9 named, 7 empty', `${await page.locator('.cat-row').count()} ${await page.locator('.cat-row.slot').count()} ${await page.locator('.cat-row.slot .dot.empty').count()}`, '16 7 7');
  check('an empty slot says so', await page.locator('.cat-row.slot input').first().getAttribute('placeholder'), 'Empty');
  await page.locator('.cat-row.slot input').first().tap();
  await page.keyboard.type('Coffee');
  await page.keyboard.press('Enter');
  check('unsaved: new one stays at the bottom', (await categoryRows(page)).join(','), 'Bills,Dining,Fun,Groceries,Health,Housing,Other,Shopping,Transport,Coffee');
  check('unsaved: colors still in GF order down the list', (await categoryDotColors(page)).join(','), gfOrder.slice(0, 10).join(','));
  const transportRow = (await categoryRows(page)).indexOf('Transport');
  await page.locator('.cat-row').nth(transportRow).locator('.mini', { hasText: '✕' }).tap();
  check('Transport archived', await page.locator('#help .text').first().textContent(), 'Transport archived');
  check('colors in GF order after removing one', (await categoryDotColors(page)).join(','), gfOrder.slice(0, 10).join(','));
  await saveButton.tap();
  await page.waitForTimeout(300);
  check('saved message', await page.locator('#help .text').first().textContent(), 'Categories saved');
  check('Save sorts them right away', (await categoryRows(page)).join(','), 'Bills,Coffee,Dining,Fun,Groceries,Health,Housing,Other,Shopping');
  check('colors in GF order after saving', (await categoryDotColors(page)).join(','), gfOrder.slice(0, 10).join(','));
  check('each gem has its GF\'s accent as its glint', (await page.locator('.cat-row .dot:not(.empty)').evaluateAll((ds) => ds.map((d) => d.style.getPropertyValue('--c2')))).join(','),
    readPalette().map((c) => c.accent).slice(0, 10).join(','));
  await page.screenshot({ path: `${OUT}/${ENGINE}-4-categories.png`, fullPage: true });
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  check('strip excludes archived', await page.locator('.strip .chip', { hasText: 'Transport' }).count(), 0);

  check('strip includes new category', await page.locator('.strip .chip', { hasText: 'Coffee' }).count(), 1);

  // Backup screen: status, storage line, restore from the file made earlier
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  await page.locator('#menu button', { hasText: 'Backup' }).tap();
  check('backup page status', await page.locator('.backup-status').textContent(), 'Backed up today');
  await page.waitForTimeout(200);
  check('storage line shown', (await page.locator('.page-body .empty-note').last().textContent()).startsWith('Storage:'), true);
  page.once('dialog', (d) => d.accept());
  await page.locator('.page-body input[type=file]').setInputFiles(`${OUT}/backup.json`);
  await page.waitForTimeout(400);
  check('restore toast', await page.locator('#help .text').first().textContent(), 'Backup restored');
  check('restored: back to one period with Transport active', await page.locator('.strip .chip', { hasText: 'Transport' }).count(), 1);
  check('restored spent amount', await spentText(page), '$525.88');
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);

  // Dark mode look
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const k of '1299') await mainKey(k);
  await page.screenshot({ path: `${OUT}/${ENGINE}-5-main-dark.png` });

  // Reload keeps data
  await page.reload();
  await page.waitForTimeout(300);
  check('persists after reload', await spentText(page), '$525.88');
  check('no first-budget screen after reload', await page.locator('#page').isHidden(), true);

  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No console errors');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e.message); process.exit(1); });
