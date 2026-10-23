// Main pass: the core flow from first launch through entering, editing, summaries, periods,
// categories and backups.
const { chromium, webkit, devices } = require('playwright');
const ENGINE = process.env.ENGINE || 'chromium';
const fs = require('fs');
const { fakeShareSheet, grabFile, leftText, titleText, openSummary, openMenu, asInstalledApp, mockRates, readPalette, categoryRows, categoryDotColors, check, saved } = require('./helpers');
const OUT = require('path').join(__dirname, 'output', process.env.ENGINE || 'chromium'); // screenshots and exported files, one folder per engine so runs can overlap (not committed)

(async () => {
  const browser = asInstalledApp(ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch());
  const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'light' });
  await fakeShareSheet(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await mockRates(page, '{"amount":1,"base":"USD","date":"2026-10-20","rates":{"MXN":20}}');
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

  // USD entry with implied cents
  for (const k of '51050') await mainKey(k);
  check('USD 5-1-0-5-0', await page.locator('.amount').textContent(), '$510.50');
  await page.locator('.add-btn').tap();
  check('left after $510.50', await leftText(page), '$1,489.50 left');
  check('toast', await page.locator('#help .text').first().textContent(), 'Added $510.50 · Groceries');

  // Currency switch: tap the choices
  await page.locator('.currency-opts').tap();
  for (const k of '250') await mainKey(k);
  check('MXN 2-5-0', await page.locator('.amount').textContent(), 'MX$250');
  check('conversion line', (await page.locator('.amount-sub span').allTextContents()).join(' | '), '≈ $12.50 | 1 USD = 20.00 MXN');
  // A tap anywhere in the Amount window (here, on the amount itself) picks the next currency,
  // wrapping around.
  await page.locator('.amount').tap();
  check('tap the amount -> USD (wraps around)', await page.locator('.currency-opts .on').textContent(), 'USD');
  const zoneBox = await page.locator('.currency-zone').boundingBox();
  await page.locator('.currency-zone').tap({ position: { x: 16, y: zoneBox.height - 16 } }); // an empty corner
  check('tap an empty corner -> MXN', await page.locator('.currency-opts .on').textContent(), 'MXN');
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
  check('left after MX$250', await leftText(page), '$1,477.00 left');
  check('currency remembered', await page.locator('.currency-opts .on').textContent(), 'MXN');
  check('note cleared', await page.locator('.note').inputValue(), '');
  await page.screenshot({ path: `${OUT}/${ENGINE}-2-main-mxn.png` });

  // Undo works
  for (const k of '100') await mainKey(k);
  await page.locator('.add-btn').tap();
  await page.locator('#undo-btn').tap();
  check('left after undo', await leftText(page), '$1,477.00 left');
  check('undo stays on the main screen', await page.locator('#page').isHidden(), true);

  // Empty Add nudges, adds nothing
  await page.locator('.add-btn').tap();
  check('empty add ignored', await leftText(page), '$1,477.00 left');

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
  check('donut center', await page.locator('.donut-center strong').textContent(), '$523.00');
  check('donut slices', await page.locator('.donut circle.slice').count(), 2);
  check('window labels and gauge numbers white', await page.evaluate(() => [
    getComputedStyle(document.querySelector('.window[data-label]'), '::before').color,
    getComputedStyle(document.querySelector('.gauge .number')).color,
  ].join(' ')), 'rgb(255, 255, 255) rgb(255, 255, 255)');
  // The donut's colors match the gauges': translucent over the same dark trough.
  check('donut colored like the gauges', await page.evaluate(() => [
    getComputedStyle(document.querySelector('.donut .slice')).strokeOpacity,
    getComputedStyle(document.querySelector('.donut .ring')).stroke,
    getComputedStyle(document.querySelector('.gauge .bar')).backgroundImage.includes('rgb(50, 50, 50)'),
  ].join(' ')), '0.72 rgb(50, 50, 50) true');
  check('diff', await page.locator('.stat.diff .value').textContent(), '+$1,477.00');
  await page.locator('.cat-head', { hasText: 'Transport' }).tap();
  check('itemized MXN line', await page.locator('.item .orig').textContent(), 'from MX$250');
  check('itemized note', await page.locator('.item .what').first().textContent(), 'Uber');
  await page.screenshot({ path: `${OUT}/${ENGINE}-3-summary.png`, fullPage: true });
  await page.locator('.donut').screenshot({ path: `${OUT}/${ENGINE}-donut.png` });

  // Edit the expense: 250 -> 300 pesos
  await page.locator('.item').first().tap();
  await page.waitForTimeout(300);
  await page.locator('#sheet input').first().fill('300');
  await page.locator('#sheet .primary').tap();
  check('edited MXN converts at saved rate', await page.locator('.donut-center strong').textContent(), '$525.50');

  // Edit budget
  await page.locator('.edit-budget').tap();
  await page.waitForTimeout(300);
  check('edit budget prefilled', await page.locator('.budget-amount').textContent(), '$2,000.00');
  await sheetKey('⌫');
  await page.locator('#page .primary').tap();
  check('budget edited', await page.locator('.stat .value').first().textContent(), '$200.00');
  check('over budget shown', await page.locator('.stat.diff .value').textContent(), '−$325.50');
  await page.locator('#nav-btn').tap();
  check('main shows over', await leftText(page), '$325.50 over');
  await page.waitForSelector('#help:not(.message)', { timeout: 8000 });
  check('status row: HP in red and the bar empty when over', await page.evaluate(() => [
    document.querySelector('#help .hp').className, document.querySelector('#help .hp-bar span').style.width, document.querySelector('#help .hp b').textContent].join(' | ')),
    'stat hp over | 0% | −$325.50');

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
  check('left in new period', await leftText(page), '$1,500.00 left');
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
  await page.locator('.wide-btn', { hasText: 'Add category' }).tap();
  check('category added', await page.locator('.cat-row input').count(), 10);
  check('a new category starts blank and ready to type', await page.evaluate(() => `${document.activeElement.value}|${document.activeElement.placeholder}`), '|New category');
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
  check('each diamond has its GF\'s accent at the core', (await page.locator('.cat-row .dot').evaluateAll((ds) => ds.map((d) => d.style.getPropertyValue('--c2')))).join(','),
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
  check('restored left amount', await leftText(page), '$325.50 over');
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);

  // Dark mode look
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const k of '1299') await mainKey(k);
  await page.screenshot({ path: `${OUT}/${ENGINE}-5-main-dark.png` });

  // Reload keeps data
  await page.reload();
  await page.waitForTimeout(300);
  check('persists after reload', await leftText(page), '$325.50 over');
  check('no first-budget screen after reload', await page.locator('#page').isHidden(), true);

  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No console errors');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e.message); process.exit(1); });
