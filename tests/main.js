// Main pass: the core flow from first launch through entering, editing, summaries, periods,
// categories and backups.
const { chromium, webkit, devices } = require('playwright');
const ENGINE = process.env.ENGINE || 'chromium';
const fs = require('fs');
const { fakeShareSheet, grabFile, leftText, titleText, openSummary, asInstalledApp } = require('./helpers');
const OUT = require('path').join(__dirname, 'output'); // screenshots and exported files (not committed)
const check = (label, actual, expected) => console.log(`${actual === expected ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${actual === expected ? '' : ` (expected ${JSON.stringify(expected)})`}`);

(async () => {
  const browser = asInstalledApp(ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch());
  const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'light' });
  await fakeShareSheet(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"amount":1,"base":"USD","date":"2026-10-20","rates":{"MXN":20}}' }));
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
  check('toast', await page.locator('#help span').first().textContent(), 'Added $510.50 · Groceries');

  // Currency switch by tap, then by swipe (mouse drag fires pointer events)
  await page.locator('.currency-opts').tap();
  for (const k of '250') await mainKey(k);
  check('MXN 2-5-0', await page.locator('.amount').textContent(), 'MX$250');
  check('conversion line', (await page.locator('.amount-sub span').allTextContents()).join(' | '), '≈ $12.50 | 1 USD = 20.00 MXN');
  const zone = await page.locator('.currency-zone').boundingBox();
  const swipe = async (dx) => {
    await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2 + 30);
    await page.mouse.down();
    await page.mouse.move(zone.x + zone.width / 2 + dx, zone.y + zone.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
  };
  await swipe(120);
  check('swipe right -> USD', await page.locator('.currency-opts .on').textContent(), 'USD');
  await swipe(-120);
  check('swipe left -> MXN', await page.locator('.currency-opts .on').textContent(), 'MXN');
  check('digits kept after swipes', await page.locator('.amount').textContent(), 'MX$250');

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
  await page.locator('#help .undo').tap();
  check('left after undo', await leftText(page), '$1,477.00 left');
  check('undo stays on the main screen', await page.locator('#page').isHidden(), true);

  // Empty Add nudges, adds nothing
  await page.locator('.add-btn').tap();
  check('empty add ignored', await leftText(page), '$1,477.00 left');

  // Summary
  await openSummary(page);
  check('summary title', await titleText(page), 'Current Period');
  check('donut center', await page.locator('.donut-center strong').textContent(), '$523.00');
  check('donut slices', await page.locator('.donut circle.slice').count(), 2);
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
  await page.locator('.stat .link').tap();
  await page.waitForTimeout(300);
  check('edit budget prefilled', await page.locator('.budget-amount').textContent(), '$2,000.00');
  await sheetKey('⌫');
  await page.locator('#page .primary').tap();
  check('budget edited', await page.locator('.stat .value').first().textContent(), '$200.00Edit');
  check('over budget shown', await page.locator('.stat.diff .value').textContent(), '−$325.50');
  await page.locator('#nav-btn').tap();
  check('main shows over', await leftText(page), '$325.50 over');

  // New Period
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  check('menu labels', (await page.locator('#menu button').allTextContents()).map((t) => t.replace(/Backup.*/, 'Backup')).join(','), 'Current Period,Past Periods,Categories,New Period,Backup');
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
  check('past period has no Edit', await page.locator('.stat .link').count(), 0);
  await page.locator('#nav-btn').tap();
  check('back to periods', await titleText(page), 'Past Periods');
  await page.locator('#nav-btn').tap();

  // Categories: recolor, add, archive used one
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  await page.locator('#menu button', { hasText: 'Categories' }).tap();
  check('no color picker', await page.locator('.swatch, .palette').count(), 0);
  check('colors follow GF order alphabetically', await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('budget-tracker'));
    return s.categories.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 3).map((c) => c.color).join(',');
  }), '#94cc3a,#8fd0f5,#e2682b');
  check('no reorder arrows', await page.locator('.mini', { hasText: '↑' }).count(), 0);
  await page.locator('.wide-btn', { hasText: 'Add category' }).tap();
  check('category added', await page.locator('.cat-row input').count(), 10);
  check('new category name selected', await page.evaluate(() => document.activeElement.value), 'New Category');
  await page.keyboard.type('Coffee');
  await page.keyboard.press('Enter');
  check('editor alphabetical', (await page.locator('.cat-row input').evaluateAll((ns) => ns.map((n) => n.value))).join(','), 'Bills,Coffee,Dining,Fun,Groceries,Health,Housing,Other,Shopping,Transport');
  const transportRow = await page.locator('.cat-row input').evaluateAll((ns) => ns.findIndex((n) => n.value === 'Transport'));
  await page.locator('.cat-row').nth(transportRow).locator('.mini', { hasText: '✕' }).tap();
  check('Transport archived', await page.locator('#help span').first().textContent(), 'Transport archived');
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
  check('restore toast', await page.locator('#help span').first().textContent(), 'Backup restored');
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
