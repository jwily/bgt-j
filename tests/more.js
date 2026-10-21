// Second pass: edge cases and features the main pass doesn't cover (keypad limits, double-tap grid,
// backdating, editing, CSV, restore, deleting periods, offline rates, upgrading old data).
const { chromium, webkit, devices } = require('playwright');
const fs = require('fs');
const ENGINE = process.env.ENGINE || 'chromium';
const OUT = require('path').join(__dirname, 'output'); // screenshots and exported files (not committed)
const URL = 'http://localhost:8765/';
const { fakeShareSheet, grabFile, leftText, titleText, openSummary, snapshotReasons, asInstalledApp, mockRates, startFirstPeriod, messageCleared } = require('./helpers');
let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
const RATE = '{"amount":1,"base":"USD","date":"2026-10-20","rates":{"MXN":20}}';

(async () => {
  const browser = asInstalledApp(ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch());
  const errors = [];
  const newPage = async (context, { rate = 'ok' } = {}) => {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().includes('frankfurter') && errors.push(m.text()));
    return page;
  };
  let rateHits = 0;
  const context = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  await context.route('https://api.frankfurter.dev/**', (r) => { rateHits++; r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: RATE }); });
  await fakeShareSheet(context);
  const page = await newPage(context);
  await page.goto(URL);
  const sheetKey = (k) => page.locator('#page .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
  const mainKey = (k) => page.locator('#view-input .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
  const openMenuItem = async (name) => {
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(250);
    await page.locator('#menu button', { hasText: name }).tap();
    await page.waitForTimeout(300);
  };

  // First-launch sheet can't be dismissed by tapping outside it
  await page.mouse.click(200, 40);
  await page.waitForTimeout(200);
  check('first budget screen stays open', await page.locator('#page').isVisible(), true);
  check('first budget screen has no Back', await page.locator('#nav-btn').isHidden(), true);
  check('start disabled while empty', await page.locator('#page .primary').isDisabled(), true);

  // 00 key in the budget sheet: 1 5 00 00 -> $1,500.00
  for (const k of ['1', '5', '00', '00']) await sheetKey(k);
  check('budget with 00 key', await page.locator('.budget-amount').textContent(), '$1,500.00');
  await page.locator('#page .primary').tap();
  await page.waitForTimeout(300);
  check('rate fetched once on launch', rateHits, 1);

  // Leading 00 / 0 ignored, max 8 digits for USD, hold ⌫ clears
  await mainKey('00');
  await mainKey('0');
  check('leading zeros ignored', await page.locator('.amount').textContent(), '$0.00');
  for (let i = 0; i < 10; i++) await mainKey('9');
  check('USD capped at 8 digits', await page.locator('.amount').textContent(), '$999,999.99');
  await mainKey('⌫');
  check('backspace one', await page.locator('.amount').textContent(), '$99,999.99');
  const back = await page.locator('#view-input .key').filter({ hasText: /^⌫$/ }).boundingBox();
  await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.waitForTimeout(100);
  check('hold backspace clears', await page.locator('.amount').textContent(), '$0.00');

  // MXN capped at 7 digits, switching trims
  await page.locator('.currency-opts').tap();
  for (let i = 0; i < 9; i++) await mainKey('9');
  check('MXN capped at 7 digits', await page.locator('.amount').textContent(), 'MX$9,999,999');
  await page.locator('.currency-opts').tap();
  check('switch back keeps digits', await page.locator('.amount').textContent(), '$99,999.99');
  await page.locator('#view-input .key').filter({ hasText: /^⌫$/ }).hover();
  await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();

  // One tap on the strip doesn't open the grid, nor do two taps far apart in time; a double tap
  // does. Then pick Health.
  const selectedChip = page.locator('.strip .chip.selected');
  await selectedChip.tap();
  await page.waitForTimeout(450);
  await selectedChip.tap();
  await page.waitForTimeout(450);
  check('slow taps on the strip don\'t open the grid', await page.locator('#sheet-backdrop.open').count(), 0);
  await selectedChip.tap();
  await selectedChip.tap();
  await page.waitForSelector('#sheet-backdrop.open', { timeout: 5000 }).catch(() => {}); // wait for it, not a fixed time
  await page.waitForTimeout(200); // let its unfold animation finish before measuring
  check('grid opened', await page.locator('#sheet').getAttribute('data-label'), 'Category');
  check('grid has no duplicate heading', await page.locator('#sheet h2').count(), 0);
  check('grid opens level with the strip', await page.evaluate(() =>
    Math.abs(document.querySelector('#sheet').getBoundingClientRect().top - document.querySelector('.strip-window').getBoundingClientRect().top) < 2), true);
  check('grid alphabetical', (await page.locator('#sheet .grid .chip').allTextContents()).join(','), 'Bills,Dining,Fun,Groceries,Health,Housing,Other,Shopping,Transport');
  check('grid marks current', await page.locator('#sheet .grid .chip.selected').textContent(), 'Groceries');
  // The grid opens like every other window: the same unfold, from its middle
  const gridOpening = await page.locator('#sheet').evaluate((sheet) => {
    const style = getComputedStyle(sheet);
    const [, y] = style.transformOrigin.split(' ').map(parseFloat);
    return `${style.animationName} ${style.animationDuration} ${Math.round(y / sheet.offsetHeight * 100)}%`;
  });
  const unfold = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--unfold').trim());
  check('grid unfolds like other windows', gridOpening, `unfold ${unfold.split(' ')[0]} 50%`);
  await page.screenshot({ path: `${OUT}/${ENGINE}-x1-grid.png` });
  await page.locator('#sheet .grid .chip', { hasText: 'Health' }).tap();
  await page.waitForTimeout(700);
  check('grid pick selects', await page.locator('.strip .chip.selected').textContent(), 'Health');
  check('grid closed', await page.locator('#sheet-backdrop.open').count(), 0);

  // Animations run even with the phone's Reduce Motion on (the user's choice for this app).
  const reduced = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await mockRates(reduced, RATE);
  const calm = await newPage(reduced);
  await calm.goto(URL);
  await startFirstPeriod(calm, '100000');
  check('ADD hand bobs even with Reduce Motion on', await calm.evaluate(() => getComputedStyle(document.querySelector('.add-btn'), '::after').animationName), 'hand-bob');
  await reduced.close();

  // A tap on the "Today" text itself (not the hidden input) still opens the date picker
  await page.evaluate(() => {
    window.pickerOpened = 0;
    HTMLInputElement.prototype.showPicker = function () { window.pickerOpened += 1; };
  });
  await page.locator('.date-btn span').dispatchEvent('click');
  check('tapping the date text opens the picker', await page.evaluate(() => window.pickerOpened), 1);

  // Backdated expense: date label, then resets to Today after adding
  const yesterday = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); });
  await page.locator('.date-btn input').fill(yesterday);
  await page.locator('.date-btn input').dispatchEvent('change');
  const yLabel = await page.locator('.date-btn span').textContent();
  check('date label shows backdate', yLabel !== 'Today', true);
  for (const k of '4250') await mainKey(k);
  await page.locator('.add-btn').tap();
  check('date resets to Today', await page.locator('.date-btn span').textContent(), 'Today');

  // A peso expense so the CSV has one
  await page.locator('.currency-opts').tap();
  for (const k of '300') await mainKey(k);
  await page.locator('.note').fill('Tacos, "al pastor"');
  await page.locator('.add-btn').tap();
  check('left after both', await leftText(page), '$1,442.50 left');

  // Summary: backdated item shows its date; edit category; delete with undo
  await openSummary(page);
  await page.locator('.cat-head', { hasText: 'Health' }).tap();
  check('backdated item date', await page.locator('.item', { hasText: 'No note' }).locator('.when').textContent(), yLabel);
  const tacos = page.locator('.item', { hasText: 'Tacos' });
  check('MXN item shown', await tacos.locator('.orig').textContent(), 'from MX$300');
  await tacos.tap();
  await page.waitForTimeout(300);
  check('edit sheet MXN hint', (await page.locator('#sheet .hint').textContent()).startsWith('Entered as MX$300 at 20.00 MXN per USD'), true);
  const healthId = await page.locator('#sheet select').inputValue();
  const funId = await page.locator('#sheet select option', { hasText: 'Fun' }).getAttribute('value');
  await page.locator('#sheet select').selectOption(funId);
  await page.locator('#sheet .primary').tap();
  await page.waitForTimeout(300);
  check('moved to Fun', await page.locator('.cat-head', { hasText: 'Fun' }).count(), 1);
  check('Health still open with 1 item', await page.locator('.items .item').count(), 1);
  await page.locator('.item').first().tap();
  await page.waitForTimeout(300);
  await page.locator('#sheet .danger').tap();
  await page.waitForTimeout(300);
  check('deleted', await page.locator('.cat-head', { hasText: 'Health' }).count(), 0);
  await page.locator('#undo-btn').tap();
  await page.waitForTimeout(200);
  check('undo delete', await page.locator('.cat-head', { hasText: 'Health' }).count(), 1);
    await page.locator('.cat-head', { hasText: 'Fun' }).tap();
  await page.locator('.item', { hasText: 'Tacos' }).tap();
  await page.waitForTimeout(300);
  await page.locator('#sheet input').first().fill('');
  await page.locator('#sheet .primary').tap();
  check('empty amount keeps sheet open', await page.locator('#sheet-backdrop.open').count(), 1);
  await page.mouse.click(200, 30);
  await page.waitForTimeout(300);
  check('tap outside closes edit sheet', await page.locator('#sheet-backdrop.open').count(), 0);

  // Edit budget, then Cancel: unchanged
  await page.locator('.edit-budget').tap();
  await page.waitForTimeout(300);
  await sheetKey('9');
  await page.locator('#nav-btn').tap(); // Back without saving
  await page.waitForTimeout(300);
  check('cancel keeps budget', await page.locator('.stat .value').first().textContent(), '$1,500.00');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `${OUT}/${ENGINE}-x2-summary-dark.png`, fullPage: true });
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);

  // Menu with overdue-backup dot, dismiss by tapping outside
  check('dot shown (never backed up)', await page.locator('#nav-btn.alert').count(), 1);
  await page.screenshot({ path: `${OUT}/${ENGINE}-x3-main-dark-dot.png` });
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${ENGINE}-x4-menu-dark.png` });
  await page.mouse.click(40, 400);
  await page.waitForTimeout(300);
  check('menu closes on outside tap', await page.locator('#menu-backdrop.open').count(), 0);
  await page.emulateMedia({ colorScheme: 'light' });

  // CSV export content
  await openMenuItem('Backup');
  const csvFile = await grabFile(page, ENGINE, () => page.locator('.wide-btn', { hasText: 'CSV' }).tap());
  check('CSV file name', /^bgt-j-\d{4}-\d{2}-\d{2}\.csv$/.test(csvFile.name), true);
  const csv = csvFile.text.split('\n');
  check('CSV header', csv[0], 'period_start,date,category,amount_usd,note,original_currency,original_amount,rate_per_usd');
  check('CSV rows', csv.length, 3);
  check('CSV peso row', csv.find((l) => l.includes('Tacos'))?.replace(/^"[^"]*","[^"]*",/, ''), '"Fun","15.00","Tacos, ""al pastor""","MXN","300","20"');
  check('CSV export does not count as backup', await page.locator('.backup-status').textContent(), 'Never backed up');

  // Restoring a file that isn't a backup
  fs.writeFileSync(`${OUT}/not-a-backup.json`, '{"hello":"world"}');
  await page.locator('.page-body input[type=file]').setInputFiles(`${OUT}/not-a-backup.json`);
  await page.waitForTimeout(300);
  check('bad backup rejected', await page.locator('#help span').first().textContent(), "That file isn't a budget backup.");
  // Cancelling the confirm leaves data alone
  if (ENGINE === 'webkit') {
    await page.evaluate(() => { window.__shareMode = 'cancel'; });
    await page.locator('.wide-btn', { hasText: 'Export backup' }).tap();
    await page.waitForTimeout(300);
    check('cancelled share sheet is not a backup', await page.locator('.backup-status').textContent(), 'Never backed up');
    await page.evaluate(() => { window.__shareMode = 'save'; });
  }
  const jsonFile = await grabFile(page, ENGINE, () => page.locator('.wide-btn', { hasText: 'Export backup' }).tap());
  check('export marks backed up', await page.locator('.backup-status').textContent(), 'Backed up today');
  fs.writeFileSync(`${OUT}/x-backup.json`, jsonFile.text);
  page.once('dialog', (d) => d.dismiss());
  await page.locator('.page-body input[type=file]').setInputFiles(`${OUT}/x-backup.json`);
  await page.waitForTimeout(300);
  check('dismissed restore changes nothing', await leftText(page), '$1,442.50 left');
  await page.locator('#nav-btn').tap();

  // New Period sheet look; empty new period summary
  await openMenuItem('New Period');
  await page.screenshot({ path: `${OUT}/${ENGINE}-x5-new-period.png` });
  for (const k of ['1', '00', '00']) await sheetKey(k);
  await page.locator('#page .primary').tap();
  await page.waitForTimeout(300);
  await openSummary(page);
  check('empty period note', await page.locator('.empty-note').textContent(), 'No expenses yet.');
  check('empty donut has no slices', await page.locator('.donut circle.slice').count(), 0);
  check('empty donut center', await page.locator('.donut-center strong').textContent(), '$0.00');
  await page.locator('#nav-btn').tap();

  // No stray "false"/"null"/"undefined" text on any screen (2 periods exist, nothing archived)
  const stray = /\b(false|null|undefined|NaN)\b/;
  for (const [item, label] of [['Current Period', 'summary'], ['Past Periods', 'periods'], ['Categories', 'categories'], ['Backup', 'backup']]) {
    await openMenuItem(item);
    check(`no stray text: ${label}`, stray.test(await page.locator('#page-body').innerText()), false);
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(250);
  }
  check('no stray text: main screen', stray.test(await page.locator('#view-input').innerText()), false);

  // Refactor item 1: a backup with "input": null is rejected instead of crashing the app
  const backup = JSON.parse(fs.readFileSync(`${OUT}/x-backup.json`, 'utf8'));
  fs.writeFileSync(`${OUT}/null-input.json`, JSON.stringify({ ...backup, input: null }));
  await openMenuItem('Backup');
  await page.locator('.page-body input[type=file]').setInputFiles(`${OUT}/null-input.json`);
  await page.waitForTimeout(300);
  check('null input backup rejected', await page.locator('#help span').first().textContent(), "That file isn't a budget backup.");
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(250);

  // Refactor item 5: archiving the selected category moves the selection to an active one (saved by the store)
  await page.locator('.strip .chip', { hasText: 'Housing' }).tap();
  await page.waitForTimeout(700);
  check('Housing selected', await page.locator('.strip .chip.selected').textContent(), 'Housing');
  await openMenuItem('Categories');
  const housingRow = await page.locator('.cat-row input').evaluateAll((ns) => ns.findIndex((n) => n.value === 'Housing'));
  await page.locator('.cat-row').nth(housingRow).locator('.mini').tap();
  check('unused category deleted (undo offered)', await page.locator('#help span').first().textContent(), 'Housing deleted');
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(400);
  check('selection moved to an active category', await page.locator('.strip .chip.selected').textContent(), 'Bills');
  check('saved selection is valid', await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('budget-tracker')); return s.categories.some((c) => c.id === s.input.categoryId && !c.archived); }), true);
  check('add button uses selected color', await page.locator('.add-btn').evaluate((b) => b.style.getPropertyValue('--c')),
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('budget-tracker')); return s.categories.find((c) => c.id === s.input.categoryId).color; }));
  // Undo brings Housing back
  await openMenuItem('Categories');
  const housingAgain = await page.locator('.cat-row input').evaluateAll((ns) => ns.findIndex((n) => n.value === 'Housing'));
  check('Housing still gone before undo', housingAgain, -1);
  await page.locator('#nav-btn').tap();

  // Tapping the HELP window while the menu is open closes the menu
  await page.waitForSelector('#help:not(.message)'); // the HELP window can't be tapped while it shows a message
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(250);
  await page.locator('#help').click({ position: { x: 20, y: 30 } });
  await page.waitForTimeout(300);
  check('help tap opens the summary', await titleText(page), 'Current Period');
  check('and closes the menu', await page.locator('#menu-backdrop.open').count(), 0);
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(250);

  // Deleting periods (2 exist now: Period 1 with expenses, and the current one)
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')));
  const expenseCount = (await saved()).expenses.length;
  await openMenuItem('Past Periods');
  await page.locator('.period-row').nth(1).tap(); // oldest is listed last
  await page.waitForTimeout(300);
  page.once('dialog', (d) => d.accept());
  await page.locator('.delete-btn').tap();
  await page.waitForTimeout(300);
  check('past period deleted', await page.locator('.period-row').count(), 1);
  check('delete message', await page.locator('#help span').first().textContent(), 'Period 1 deleted');
  check('its expenses deleted too', (await saved()).expenses.length, 0);
  await page.locator('#undo-btn').tap();
  await page.waitForTimeout(300);
  check('undo restores the period', await page.locator('.period-row').count(), 2);
  check('undo restores its expenses', (await saved()).expenses.length, expenseCount);
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(250);
  const leftBefore = await leftText(page);
  await openMenuItem('Current Period');
  page.once('dialog', (d) => d.accept());
  await page.locator('.delete-btn').tap();
  await page.waitForTimeout(300);
  check('deleting the current period returns to the main screen', await page.locator('#page').isHidden(), true);
  check('previous period reopened', await leftText(page), '$1,442.50 left');
  check('reopened period is current', (await saved()).periods.map((p) => p.end).join(','), '');
  await page.locator('#undo-btn').tap();
  await page.waitForTimeout(300);
  check('undo makes the newer period current again', await leftText(page), leftBefore);
  check('and closes the reopened one again', (await saved()).periods.filter((p) => !p.end).length, 1);

  // Reload the same day: no second rate download
  await page.reload();
  await page.waitForTimeout(400);
  check('no refetch same day', rateHits, 1);
  await context.close();

  // Offline on first launch: falls back to the estimate and says so
  const offline = await browser.newContext({ ...devices['iPhone 13'] });
  await offline.route('https://api.frankfurter.dev/**', (r) => r.abort());
  const p2 = await newPage(offline);
  await p2.goto(URL);
  await p2.waitForTimeout(300);
  await startFirstPeriod(p2, '100000');
  await p2.locator('.currency-opts').tap();
  for (const k of '185') await p2.locator('#view-input .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
  check('offline estimate line', (await p2.locator('.amount-sub span').allTextContents()).join(' | '), '≈ $10.00 | ~18.5 MXN per USD (estimate: no rates downloaded yet)');
  await offline.close();

  // Safety snapshots: one a day, one before anything drastic, and going back works (and is undoable).
  const snap = await browser.newContext({ ...devices['iPhone 13'] });
  await fakeShareSheet(snap);
  await mockRates(snap, RATE);
  const p6 = await newPage(snap);
  const snaps = () => snapshotReasons(p6);
  const expensesNow = () => p6.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')).expenses.length);
  await p6.goto(URL);
  await p6.waitForTimeout(300);
  check('snapshots: one taken on first launch', (await snaps()).join('|'), 'start of the day');
  await startFirstPeriod(p6, '100000');
  for (const k of '500') await p6.locator('#view-input .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
  await p6.locator('.add-btn').tap();
  await p6.waitForTimeout(300);
  await p6.reload();
  await p6.waitForTimeout(300);
  check('snapshots: still one a day after reopening', (await snaps()).length, 1);
  await p6.waitForSelector('#help:not(.message)', { timeout: 6000 });
  await p6.locator('#nav-btn').tap();
  await p6.waitForTimeout(250);
  await p6.locator('#menu button', { hasText: 'Current Period' }).tap();
  await p6.waitForTimeout(300);
  p6.once('dialog', (d) => d.accept());
  await p6.locator('.delete-btn').tap(); // the only period: back to First Budget
  await p6.waitForTimeout(300);
  check('snapshots: taken before deleting a period', (await snaps())[0], 'before deleting Current Period');
  check('the expense is gone', await expensesNow(), 0);
  await startFirstPeriod(p6, '100000');
  await p6.locator('#nav-btn').tap();
  await p6.waitForTimeout(250);
  await p6.locator('#menu button', { hasText: 'Backup' }).tap();
  await p6.waitForTimeout(300);
  check('snapshots: listed on the Backup screen', await p6.locator('.snapshot-row').count(), 2);
  p6.once('dialog', (d) => d.accept());
  await p6.locator('.snapshot-row', { hasText: 'before deleting' }).locator('.link').tap();
  await p6.waitForTimeout(300);
  check('going back restores the deleted expense', await expensesNow(), 1);
  check('going back snapshots the current data first', (await snaps())[0], 'before going back to a snapshot');
  await snap.close();

  // The backup reminder: adjustable on the Backup screen, and the nudge follows it.
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    await mockRates(ctx, RATE);
    const p7 = await newPage(ctx);
    await p7.goto(URL);
    await startFirstPeriod(p7, '100000');
    await p7.evaluate(() => { // backed up 10 days ago
      const s = JSON.parse(localStorage.getItem('budget-tracker'));
      s.lastBackupAt = Date.now() - 10 * 86400000;
      localStorage.setItem('budget-tracker', JSON.stringify(s));
    });
    await p7.reload();
    await p7.waitForTimeout(400);
    check('reminder: 10 days ago is fine with the default 30', await p7.locator('#nav-btn.alert').count(), 0);
    await p7.locator('#nav-btn').tap();
    await p7.waitForTimeout(250);
    await p7.locator('#menu button', { hasText: 'Backup' }).tap();
    await p7.waitForTimeout(300);
    check('reminder: 30 is selected by default', await p7.locator('.reminder .options .on').textContent(), '30');
    await p7.locator('.reminder .options button', { hasText: /^7$/ }).tap();
    await p7.waitForTimeout(300);
    check('reminder: choosing 7 is saved', await p7.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')).settings.backupReminderDays), 7);
    check('reminder: and shown as selected', await p7.locator('.reminder .options .on').textContent(), '7');
    await p7.locator('#nav-btn').tap();
    await p7.waitForTimeout(300);
    check('reminder: now 10 days ago gets the nudge', await p7.locator('#nav-btn.alert').count(), 1);
    await ctx.close();
  }

  // In a Safari tab (not installed), the HELP window explains how to install.
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    await mockRates(ctx, RATE);
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: false })); // a Safari tab, not installed
    const p8 = await newPage(ctx);
    await p8.goto(URL);
    await startFirstPeriod(p8, '100000');
    await p8.waitForSelector('#help:not(.message)', { timeout: 6000 });
    check('Safari tab: HELP shows how to install', await p8.locator('#help span').textContent(), 'Install: Share → Add to Home Screen');
    let explained = '';
    p8.once('dialog', (d) => { explained = d.message(); d.accept(); });
    await p8.locator('#help').click({ position: { x: 20, y: 30 } });
    await p8.waitForTimeout(300);
    check('Safari tab: tapping it explains the separate data', explained.includes('Data entered in a Safari tab stays separate'), true);
    await ctx.close();
  }

  // In a desktop browser, a mouse click on the middle of the date button opens the picker (by
  // itself the hidden date field would only select its day or month there).
  const desktop = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await mockRates(desktop, RATE);
  const deskPage = await newPage(desktop);
  await deskPage.goto(URL);
  await deskPage.locator('#page .key').filter({ hasText: /^1$/ }).first().click();
  await deskPage.locator('#page .primary').click();
  await deskPage.waitForSelector('.date-btn');
  await deskPage.evaluate(() => {
    window.pickerOpened = 0;
    HTMLInputElement.prototype.showPicker = function () { window.pickerOpened += 1; };
  });
  await deskPage.locator('.date-btn').click();
  check('desktop: clicking the middle of the date button opens the picker', await deskPage.evaluate(() => window.pickerOpened), 1);
  await desktop.close();

  // Category names can't clash (ignoring capitalization); new ones get a free name.
  const clash = await browser.newContext({ ...devices['iPhone 13'] });
  await mockRates(clash, RATE);
  const p5 = await newPage(clash);
  await p5.goto(URL);
  await startFirstPeriod(p5, '100000');
  await p5.locator('#nav-btn').tap();
  await p5.waitForTimeout(250);
  await p5.locator('#menu button', { hasText: 'Categories' }).tap();
  await p5.waitForTimeout(300);
  const nameField = (n) => p5.locator('.cat-row input').nth(n);
  const funIndex = await p5.locator('.cat-row input').evaluateAll((ns) => ns.findIndex((n) => n.value === 'Fun'));
  await nameField(funIndex).fill('groceries');
  await nameField(funIndex).press('Enter');
  await p5.waitForTimeout(300);
  check('rename to an existing name is refused', await p5.locator('#help span').first().textContent(), "There's already a category called Groceries.");
  check('and the name goes back', (await p5.locator('.cat-row input').evaluateAll((ns) => ns.map((n) => n.value))).includes('Fun'), true);
  await messageCleared(p5);
  await p5.locator('.wide-btn', { hasText: 'Add category' }).tap();
  await p5.waitForTimeout(200);
  await p5.locator('.wide-btn', { hasText: 'Add category' }).tap();
  await p5.waitForTimeout(200);
  const names = await p5.locator('.cat-row input').evaluateAll((ns) => ns.map((n) => n.value));
  check('second new category gets a free name', names.includes('New Category') && names.includes('New Category 2'), true);

  // While the Categories screen is open, rows keep their places and colors: new ones join at the
  // bottom, and a renamed row stays where it was. Leaving re-sorts them.
  const rowNames = () => p5.locator('.cat-row input').evaluateAll((ns) => ns.map((n) => n.value));
  const firstDot = () => p5.locator('.cat-row .dot').first().evaluate((d) => d.style.getPropertyValue('--c'));
  check('new categories added at the bottom while editing', (await rowNames()).slice(-2).join(','), 'New Category,New Category 2');
  const colorBefore = await firstDot();
  await nameField(0).fill('Zoo');
  await nameField(0).press('Enter');
  await p5.waitForTimeout(300);
  check('renamed row stays in place while editing', (await rowNames())[0], 'Zoo');
  check('renamed row keeps its color while editing', await firstDot(), colorBefore);
  await messageCleared(p5).catch(() => {});
  await p5.locator('#nav-btn').tap(); // leave
  await p5.waitForTimeout(300);
  await p5.locator('#nav-btn').tap();
  await p5.waitForTimeout(250);
  await p5.locator('#menu button', { hasText: 'Categories' }).tap();
  await p5.waitForTimeout(300);
  const resorted = await rowNames();
  check('leaving re-sorts alphabetically', resorted.join(','), [...resorted].sort((a, b) => a.localeCompare(b)).join(','));
  check('renamed row moved to its alphabetical place', resorted.at(-1), 'Zoo');
  await clash.close();

  // Rates: re-check every 3 hours until today's rate arrives, then stop for the day.
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); // local date, like the app
  let rateDate = '2020-01-01'; // the source hasn't published today's rate yet
  let downloads = 0;
  // No service worker here: in WebKit, Playwright can't intercept requests that go through one,
  // so after the first load the app's rate checks would bypass the fake rate server below.
  const timing = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  await timing.route('https://api.frankfurter.dev/**', (r) => {
    downloads++;
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ date: rateDate, rates: { MXN: 19 } }) });
  });
  const p4 = await newPage(timing);
  await p4.goto(URL);
  await p4.waitForTimeout(400);
  check('rates: downloaded on first launch', downloads, 1);
  await p4.reload();
  await p4.waitForTimeout(400);
  check('rates: not today\u2019s yet, but checked under 3 hours ago, so no download', downloads, 1);
  const hoursAgo = (h) => p4.evaluate((ms) => {
    const s = JSON.parse(localStorage.getItem('budget-tracker'));
    s.rates.checkedAt = Date.now() - ms;
    localStorage.setItem('budget-tracker', JSON.stringify(s));
  }, h * 3600 * 1000);
  await hoursAgo(4);
  rateDate = today; // now the source has today's rate
  await p4.reload();
  await p4.waitForTimeout(400);
  check('rates: checked again after 3 hours', downloads, 2);
  await hoursAgo(4);
  await p4.reload();
  await p4.waitForTimeout(400);
  check('rates: has today\u2019s rate, so no more checks today', downloads, 2);
  await timing.close();

  // Data saved by version 1 (before the currency table) is upgraded on load, and so are old backups.
  const v1 = (note) => ({
    version: 1,
    categories: [{ id: 'c1', name: 'Food', color: '#94cc3a', archived: false }],
    periods: [{ id: 'p1', budgetCents: 100000, start: '2026-10-01', end: null }],
    expenses: [{ id: 'e1', periodId: 'p1', categoryId: 'c1', usdCents: 1351, date: '2026-10-05', note, original: { currency: 'MXN', amount: 250, mxnPerUsd: 18.5 }, createdAt: 1 }],
    rate: { mxnPerUsd: 18.5, date: '2026-10-19', fetchedOn: '2026-10-19' },
    input: { currency: 'MXN', categoryId: 'c1' },
    lastBackupAt: null,
  });
  const old = await browser.newContext({ ...devices['iPhone 13'] });
  await fakeShareSheet(old);
  await mockRates(old, RATE);
  await old.addInitScript((data) => { if (!localStorage.getItem('budget-tracker')) localStorage.setItem('budget-tracker', data); }, JSON.stringify(v1('saved before the upgrade')));
  const p3 = await newPage(old);
  await p3.goto(URL);
  await p3.waitForTimeout(500);
  const upgraded = await p3.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')));
  check('v1 data: upgraded to the current version (3)', upgraded.version, 3);
  check('v1 data: gets the default reminder setting', upgraded.settings.backupReminderDays, 30);
  check('v1 data: old rate field gone', 'rate' in upgraded, false);
  check('v1 data: expense keeps its rate as perUsd', JSON.stringify(upgraded.expenses[0].original), '{"currency":"MXN","amount":250,"perUsd":18.5}');
  check('v1 data: the day\u2019s rate downloads into the new shape', upgraded.rates.perUsd.MXN, 20);
  check('v1 data: remembered currency still MXN', await p3.locator('.currency-opts .on').textContent(), 'MXN');
  check('v1 data: totals intact', await leftText(p3), '$986.49 left');
  await p3.locator('#help').click({ position: { x: 20, y: 30 } });
  await p3.waitForTimeout(300);
  await p3.locator('.cat-head', { hasText: 'Food' }).tap();
  check('v1 data: expense still shows its pesos', await p3.locator('.item .orig').textContent(), 'from MX$250');
  await p3.locator('#nav-btn').tap();
  await p3.waitForTimeout(250);
  fs.writeFileSync(`${OUT}/v1-backup.json`, JSON.stringify(v1('restored from an old backup')));
  await p3.locator('#nav-btn').tap();
  await p3.waitForTimeout(250);
  await p3.locator('#menu button', { hasText: 'Backup' }).tap();
  await p3.waitForTimeout(300);
  p3.once('dialog', (d) => d.accept());
  await p3.locator('.page-body input[type=file]').setInputFiles(`${OUT}/v1-backup.json`);
  await p3.waitForTimeout(400);
  check('v1 backup: restores', await p3.locator('#help span').first().textContent(), 'Backup restored');
  const restored = await p3.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')));
  check('v1 backup: upgraded on restore', [restored.version, restored.expenses[0].note, restored.expenses[0].original.perUsd].join('|'), '3|restored from an old backup|18.5');
  await old.close();

  const realErrors = errors.filter((e) => !/Failed to load resource|frankfurter|network/i.test(e));
  console.log(realErrors.length ? `ERRORS:\n${realErrors.join('\n')}` : 'No console errors');
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e.message); process.exit(1); });
