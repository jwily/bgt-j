// Second pass: edge cases and features the main pass doesn't cover (keypad limits, long-press grid,
// backdating, editing, CSV, restore, deleting periods, offline rates, upgrading old data).
const { chromium, webkit, devices } = require('playwright');
const fs = require('fs');
const ENGINE = process.env.ENGINE || 'chromium';
const OUT = require('path').join(__dirname, 'output', process.env.ENGINE || 'chromium'); // screenshots and exported files, one folder per engine so runs can overlap (not committed)
const URL = 'http://localhost:8765/';
const { fakeShareSheet, grabFile, spentText, titleText, openSummary, openMenu, appReady, snapshotReasons, asInstalledApp, mockRates, startFirstPeriod, messageCleared, categoryRows, categoryDotColors, readPalette, check } = require('./helpers');
const RATE = '{"amount":1,"base":"USD","date":"2026-10-20","rates":{"MXN":20}}';

(async () => {
  const browser = asInstalledApp(ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch());
  const errors = [];
  const newPage = async (context) => {
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
  const openMenuItem = (name) => openMenu(page, name);

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

  // Fast typing: a press that drifts off its key as it lifts (iOS then sends no click for it)
  // mustn't swallow the next key's tap.
  await page.evaluate(() => {
    const key = [...document.querySelectorAll('#view-input .key')].find((k) => k.textContent === '2');
    const box = key.getBoundingClientRect();
    const send = (type, y) => key.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: box.left + box.width / 2, clientY: y }));
    send('pointerdown', box.top + box.height / 2);
    send('pointerup', box.bottom + 40); // lifted just off the key: no click follows
  });
  await mainKey('3');
  check('a quick tap right after a press that drifted off its key still counts', await page.locator('.amount').textContent(), '$0.03');
  await mainKey('⌫');
  // ...and the same key, pressed again right away: its new tap isn't taken for the old one's late click.
  await page.evaluate(() => {
    const key = [...document.querySelectorAll('#view-input .key')].find((k) => k.textContent === '2');
    const box = key.getBoundingClientRect();
    const send = (type, y) => key.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: box.left + box.width / 2, clientY: y }));
    send('pointerdown', box.top + box.height / 2);
    send('pointerup', box.bottom + 40);
  });
  await mainKey('2');
  check('the same key pressed again right after a drifted press still counts', await page.locator('.amount').textContent(), '$0.02');
  await mainKey('⌫');

  // Overlapping taps (the next finger lands before the last lifts), with the clicks a browser
  // sends when each lifts (a click count of 1, which the app ignores): both count, once each.
  await page.evaluate(() => {
    const keyFor = (label) => [...document.querySelectorAll('#view-input .key')].find((k) => k.textContent === label);
    const send = (type, label, id) => {
      const key = keyFor(label), box = key.getBoundingClientRect();
      key.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
    };
    send('pointerdown', '4', 1);
    send('pointerdown', '5', 2);
    send('pointerup', '4', 1);
    keyFor('4').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    send('pointerup', '5', 2);
    keyFor('5').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
  check('overlapping taps both count', await page.locator('.amount').textContent(), '$0.45');
  check('no double-tap zoom anywhere (the whole page opts out, gaps between keys included)', await page.evaluate(() => getComputedStyle(document.documentElement).touchAction), 'manipulation');
  await page.locator('#view-input .key').filter({ hasText: /^⌫$/ }).hover();
  await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await page.waitForTimeout(100);

  // MXN capped at 7 digits, switching trims
  await page.locator('.currency-opts').tap();
  for (let i = 0; i < 9; i++) await mainKey('9');
  check('MXN capped at 7 digits', await page.locator('.amount').textContent(), 'MX$9,999,999');
  await page.locator('.currency-opts').tap();
  check('switch back keeps digits', await page.locator('.amount').textContent(), '$99,999.99');
  await page.locator('#view-input .key').filter({ hasText: /^⌫$/ }).hover();
  await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();

  // Taps on the strip don't open the grid; a long press does. Then pick Health.
  const selectedChip = page.locator('.strip .chip.selected');
  await selectedChip.tap();
  await page.waitForTimeout(450);
  await selectedChip.tap();
  await page.waitForTimeout(450);
  check('taps on the strip don\'t open the grid', await page.locator('#sheet-backdrop.open').count(), 0);
  await selectedChip.hover();
  await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await page.waitForSelector('#sheet-backdrop.open', { timeout: 5000 }).catch(() => {}); // wait for it, not a fixed time
  await page.waitForTimeout(250); // let it finish fading in before measuring
  check('grid opened', await page.locator('#sheet').getAttribute('data-label'), 'Category');
  check('grid has no duplicate heading', await page.locator('#sheet h2').count(), 0);
  check('grid opens level with the strip', await page.evaluate(() =>
    Math.abs(document.querySelector('#sheet').getBoundingClientRect().top - document.querySelector('.strip-window').getBoundingClientRect().top) < 2), true);
  check('grid reads down the left column, then the right', await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#sheet .grid .chip')].map((c) => c.getBoundingClientRect());
    const half = Math.ceil(chips.length / 2);
    return chips.slice(1, half).every((c, i) => c.left === chips[0].left && c.top > chips[i].top) && chips[half].left > chips[0].left && chips[half].top === chips[0].top;
  }), true);
  check('grid alphabetical', (await page.locator('#sheet .grid .chip').allTextContents()).join(','), 'Bills,Dining,Fun,Groceries,Health,Housing,Other,Shopping,Transport');
  check('grid marks current', await page.locator('#sheet .grid .chip.selected').textContent(), 'Groceries');
  // How windows arrive: sheets (like this grid) fade in, 0.18s, easing out.
  const animationOf = (selector) => page.evaluate((sel) => {
    const style = getComputedStyle(document.querySelector(sel));
    return `${style.animationName} ${style.animationDuration} ${style.animationTimingFunction}`;
  }, selector);
  check('the grid swishes in from the left like Edit Expense', await animationOf('#sheet'), 'swish-in-left 0.22s cubic-bezier(0.1, 0.8, 0.25, 1)');
  check('other categories are grey in the grid, white in the strip', await page.evaluate(() => [
    getComputedStyle(document.querySelector('#sheet .grid .chip:not(.selected)')).color,
    getComputedStyle(document.querySelector('.strip .chip:not(.selected)')).color].join(' | ')),
    'rgb(143, 143, 143) | rgb(237, 237, 237)');
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
  check('spent after both', await spentText(page), '$57.50');

  // No double-tap zoom, and no browser click: every touch's end is cancelled except on fields and
  // labels, which iOS needs for focus and pickers.
  const touchEndCancelled = (selector) => page.evaluate((selector) => {
    const target = document.querySelector(selector);
    target.dispatchEvent(new Event('touchstart', { bubbles: true }));
    const e = new Event('touchend', { bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e.defaultPrevented;
  }, selector);
  check('touches end cancelled on keys and empty space, not on fields',
    [await touchEndCancelled('#view-input .key'), await touchEndCancelled('.strip-window'), await touchEndCancelled('.note'), await touchEndCancelled('.date-btn')].join(' '), 'true true false false');
  // A press in the gap between keys goes to the nearest key, as iOS's own taps do.
  await page.evaluate(() => {
    const key = [...document.querySelectorAll('#view-input .key')].find((k) => k.textContent === '6');
    const box = key.getBoundingClientRect();
    const at = { clientX: box.left - 2, clientY: box.top + box.height / 2 }; // in the gap, nearer 6 than 5
    const pad = key.parentElement;
    for (const type of ['pointerdown', 'pointerup']) pad.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 11, pointerType: 'touch', isPrimary: true, ...at }));
  });
  check('a press in the gap between keys types the nearest', (await page.locator('.amount').textContent()).endsWith('6'), true);
  await mainKey('⌫');

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
  check('Edit Expense swishes in from the left', await animationOf('#sheet'), 'swish-in-left 0.22s cubic-bezier(0.1, 0.8, 0.25, 1)');
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
  check('bad backup rejected', await page.locator('#help .text').first().textContent(), "That file isn't a budget backup.");
  // Cancelling the share sheet isn't a backup
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
  // Dismissing the "Replace everything?" question leaves the data alone. (The file has a different
  // budget, so a restore that went ahead anyway would show.)
  const different = JSON.parse(jsonFile.text);
  different.periods.at(-1).budgetCents = 999900;
  fs.writeFileSync(`${OUT}/x-backup-different.json`, JSON.stringify(different));
  page.once('dialog', (d) => d.dismiss());
  await page.locator('.page-body input[type=file]').setInputFiles(`${OUT}/x-backup-different.json`);
  await page.waitForTimeout(300);
  check('dismissed restore changes nothing', await spentText(page), '$57.50');
  await page.locator('#nav-btn').tap();

  // New Period sheet look; empty new period summary
  await openMenuItem('New Period');
  await page.screenshot({ path: `${OUT}/${ENGINE}-x5-new-period.png` });
  for (const k of ['1', '00', '00']) await sheetKey(k);
  await page.locator('#page .primary').tap();
  await page.waitForTimeout(300);
  await openSummary(page);
  check('empty period note', await page.locator('.empty-note').textContent(), 'No expenses yet.');
  check('empty ring has no waves', await page.locator('.ring-chart .wave').count(), 0);
  check('empty ring center', await page.locator('.ring-center strong').textContent(), '$0.00');
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
  check('null input backup rejected', await page.locator('#help .text').first().textContent(), "That file isn't a budget backup.");
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(250);

  // Refactor item 5: archiving the selected category moves the selection to an active one (saved by the store)
  await page.locator('.strip .chip', { hasText: 'Housing' }).tap();
  await page.waitForTimeout(700);
  check('Housing selected', await page.locator('.strip .chip.selected').textContent(), 'Housing');
  await openMenuItem('Categories');
  const housingRow = await page.locator('.cat-row input').evaluateAll((ns) => ns.findIndex((n) => n.value === 'Housing'));
  await page.locator('.cat-row').nth(housingRow).locator('.mini').tap();
  check('unused category removed (undo offered)', await page.locator('#help .text').first().textContent(), 'Housing removed');
  await page.locator('#page .actions .primary', { hasText: 'Save' }).tap();
  await page.waitForTimeout(300);
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

  // Presses replay what iOS sends: pointer events where the thumb goes, then (unless nativeClick is
  // false: iOS sends none once the thumb strays far) its own click on the button the press started
  // on, with a click count of 1, which the app must ignore.
  const press = (selector, text, path, nativeClick = true) => page.evaluate(([sel, txt, steps, nativeClick]) => {
    const start = [...document.querySelectorAll(sel)].find((b) => b.textContent.trim() === txt);
    const box = start.getBoundingClientRect();
    const send = (type, x, y) => start.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 7, isPrimary: true }));
    send('pointerdown', box.left + box.width / 2, box.top + box.height / 2);
    const hovered = [];
    for (const [type, target] of steps) {
      const other = typeof target === 'string' ? [...document.querySelectorAll(sel)].find((b) => b.textContent.trim() === target).getBoundingClientRect() : null;
      const [x, y] = other ? [other.left + other.width / 2, other.top + other.height / 2] : [box.left + box.width / 2, box.top + target];
      send(type, x, y);
      if (type === 'pointermove') hovered.push([...document.querySelectorAll('.menu-list button.hover')].map((b) => b.textContent).join());
    }
    if (nativeClick) start.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    return hovered;
  }, [selector, text, path, nativeClick]);
  await page.waitForSelector('#help:not(.message)');
  const amountBefore = await page.locator('.amount').textContent();
  await page.locator('#view-input .key').filter({ hasText: /^4$/ }).first().tap();
  await page.locator('.add-btn').tap();
  check('the HELP window doesn\'t animate when a message (like Added) shows', await animationOf('#help'), 'none 0s ease');
  check('a message brings back the HELP label', await page.evaluate(() => getComputedStyle(document.getElementById('help'), '::before').content), '"Help"');
  await page.locator('#undo-btn').tap(); // take that expense back
  await page.waitForSelector('#help:not(.message)');
  await press('#view-input .key', '7', [['pointerup', -150]]); // lift well above the key
  check('a press that slides off a key before lifting doesn\'t type', await page.locator('.amount').textContent(), amountBefore);
  await page.locator('#view-input .key').filter({ hasText: /^7$/ }).first().tap();
  check('the next real tap still types', (await page.locator('.amount').textContent()) !== amountBefore, true);
  await page.locator('#view-input .key').filter({ hasText: /^⌫$/ }).first().tap();
  await page.locator('#nav-btn').tap();
  await page.waitForSelector('#menu-backdrop.open');
  check('the menu\'s windows swish in from the right', await animationOf('#menu .menu-list') + ' | ' + await animationOf('#menu .menu-stats'),
    'swish-in-right 0.22s cubic-bezier(0.1, 0.8, 0.25, 1) | swish-in-right 0.22s cubic-bezier(0.1, 0.8, 0.25, 1)');
  const menuSettled = () => page.waitForFunction(() => !document.getAnimations().some((a) => a.animationName === 'swish-in-right' && a.playState === 'running'));
  await menuSettled();
  const hovered = await press('.menu-list button', 'Current Period', [['pointermove', 'Past Periods'], ['pointermove', 'Categories'], ['pointerup', 'Categories']]);
  check('menu: the hand follows the thumb between commands', hovered.join(' > '), 'Past Periods > Categories');
  await page.waitForFunction(() => document.getElementById('title').textContent === 'Categories' && !document.getElementById('page').hidden, null, { timeout: 2000 }).catch(() => {});
  check('menu: lifting opens the command under the thumb, not the one pressed first', await titleText(page), 'Categories');
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  await page.locator('#nav-btn').tap();
  await page.waitForSelector('#menu-backdrop.open');
  await menuSettled();
  await press('.menu-list button', 'Current Period', [['pointermove', -400], ['pointerup', -400]]); // off the menu
  await page.waitForTimeout(300);
  check('menu: lifting off the commands opens nothing', await page.locator('#page').isHidden(), true);
  await press('.menu-list button', 'Categories', [['pointermove', -400], ['pointermove', 'Categories'], ['pointerup', 'Categories']], false);
  await page.waitForFunction(() => !document.getElementById('page').hidden, null, { timeout: 2000 }).catch(() => {});
  check('menu: sliding off and back onto a command still opens it (iOS sends no click)', await titleText(page), 'Categories');
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);
  await page.locator('#nav-btn').tap();
  await page.waitForSelector('#menu-backdrop.open');
  await menuSettled();
  await press('.menu-list button', 'Past Periods', [['pointermove', -400], ['pointermove', 'Past Periods'], ['pointerup', 'Past Periods']]);
  await page.waitForTimeout(400);
  await page.locator('#nav-btn').tap(); // back: if iOS's click went through too, a second Past Periods would be underneath
  await page.waitForTimeout(300);
  check('menu: ...and opens it once when iOS does click', await page.locator('#page').isHidden(), true);
  await page.locator('#nav-btn').tap();
  await page.waitForSelector('#menu-backdrop.open');
  await menuSettled();
  await page.locator('#nav-btn').tap(); // close the menu
  await page.waitForSelector('#menu-backdrop:not(.open)');

  // Sideways: only the "turn your phone upright" screen shows; turning back restores the app with
  // the same category chosen (the strip's width changes while sideways).
  await page.locator('.strip .chip').last().tap();
  await page.waitForTimeout(700);
  const chosen = await page.locator('.strip .chip.selected').textContent();
  const upright = page.viewportSize();
  await page.setViewportSize({ width: upright.height, height: upright.width });
  await page.waitForTimeout(400);
  check('sideways: only the turn-upright screen shows', await page.evaluate(() => [getComputedStyle(document.querySelector('.turn-upright')).display, getComputedStyle(document.getElementById('view-input')).visibility].join(' ')), 'grid hidden');
  await page.setViewportSize(upright);
  await page.waitForTimeout(600);
  check('upright again: the app is back', await page.evaluate(() => [getComputedStyle(document.querySelector('.turn-upright')).display, getComputedStyle(document.getElementById('view-input')).visibility].join(' ')), 'none visible');
  check('upright again: same category chosen', await page.locator('.strip .chip.selected').textContent(), chosen);

  // Launch screens: every one exists and is exactly the size its media query says (iOS ignores one
  // that doesn't match the screen exactly, and shows its own launch screen instead).
  const launch = await page.evaluate(() => Promise.all([...document.querySelectorAll('link[rel=apple-touch-startup-image]')].map((link) => new Promise((resolve) => {
    const [, w, h, dpr] = link.media.match(/device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d+)/).map(Number);
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth === w * dpr && img.naturalHeight === h * dpr);
    img.onerror = () => resolve(false);
    img.src = link.href;
  }))));
  check(`launch screens: ${launch.length}, all present at the right size`, launch.length >= 10 && launch.every(Boolean), true);

  // On the main screen, HELP is a status row instead, after FF8's party windows: no label, the
  // period's number as Lv, what's left as HP, and a thin bar under it filled to the share left.
  await page.waitForSelector('#help:not(.message)');
  const status = await page.evaluate(() => {
    const help = document.getElementById('help');
    const data = JSON.parse(localStorage.getItem('budget-tracker'));
    const period = data.periods.find((p) => !p.end);
    const spent = data.expenses.filter((e) => e.periodId === period.id).reduce((sum, e) => sum + e.usdCents, 0);
    const bar = help.querySelector('.hp-bar');
    return {
      label: getComputedStyle(help, '::before').content,
      level: help.querySelector('.stat b').textContent,
      periods: data.periods.length,
      said: help.getAttribute('aria-label'),
      share: Math.abs(bar.firstChild.getBoundingClientRect().width / bar.getBoundingClientRect().width - (period.budgetCents - spent) / period.budgetCents) < 0.01,
      oneLine: help.querySelector('.status-row').getBoundingClientRect().height < 40,
      centered: (() => {
        const row = help.querySelector('.status-row').getBoundingClientRect(), box = help.getBoundingClientRect();
        return Math.abs((row.left + row.right) / 2 - (box.left + box.right) / 2) <= 1;
      })(),
    };
  });
  check('main screen: a status row, labelled STATUS', status.label, '"Status"');
  check('status row: Lv is the period\'s number', status.level, String(status.periods));
  check('status row: says the level and what\'s left', /^Level \d+, \$[\d,.]+ (left|over) this period$/.test(status.said), true);
  check('status row: the bar shows the share left, on one line', status.share && status.oneLine, true);
  check('status row: centered in the window', status.centered, true);

  // HELP is one line: on every screen, text scrolls sideways exactly when it doesn't fit (measured
  // after the title window appears beside it), and at rest its first letter is clear of the fade.
  const helpState = () => page.evaluate(() => {
    const text = document.querySelector('#help .text'), clip = text.parentElement, style = getComputedStyle(clip);
    const room = clip.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return {
      moving: text.getAnimations().length > 0,
      overflows: text.scrollWidth > room + 1,
      oneLine: text.getBoundingClientRect().height < 2 * parseFloat(getComputedStyle(text).lineHeight),
      clearOfFade: text.getBoundingClientRect().left >= clip.getBoundingClientRect().left + parseFloat(style.paddingLeft) - 0.5,
    };
  });
  await page.waitForSelector('#help:not(.message)');
  const results = [];
  for (const screen of ['Current Period', 'Past Periods', 'Categories', 'New Period', 'Backup']) {
    await openMenuItem(screen);
    // HELP re-measures itself once the title window appears beside it; give that time on a slow run.
    await page.waitForFunction(() => {
      const text = document.querySelector('#help .text'), clip = text.parentElement, style = getComputedStyle(clip);
      const room = clip.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return (text.getAnimations().length > 0) === (text.scrollWidth > room + 1);
    }, null, { timeout: 2000 }).catch(() => {}); // the check below reports it if it never settles
    const h = await helpState();
    results.push(h);
    const fine = h.moving === h.overflows && h.oneLine && h.clearOfFade;
    check(`HELP on ${screen}: scrolls exactly when it doesn't fit, one line, first letter clear${fine ? '' : ` ${JSON.stringify(h)}`}`, fine, true);
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(300);
  }
  check('some HELP lines scroll and some sit still (the check above covers both)', results.some((r) => r.moving) && results.some((r) => !r.moving), true);

  // A screen's windows fade in once when it opens: a redraw just after (like the exchange rate
  // arriving on first launch) doesn't fade them in again.
  await page.locator('#nav-btn').tap();
  await page.waitForSelector('#menu-backdrop.open');
  await page.locator('#menu button', { hasText: 'Past Periods' }).tap();
  const arrival = await page.evaluate(() => new Promise((resolve) => {
    const style = getComputedStyle(document.querySelector('#page-body > .arriving'));
    const fading = `${style.animationName} ${style.animationDuration} ${style.animationTimingFunction}`;
    setTimeout(() => {
      window.dispatchEvent(new Event('budget:change')); // redraw 50ms in
      resolve({ fading, replayed: document.getAnimations().filter((a) => a.animationName === 'fade-in' && a.effect.target.isConnected && a.effect.target.closest('#page-body')).length });
    }, 50);
  }));
  check('a screen\'s windows fade in when it opens', arrival.fading, 'fade-in 0.18s ease-out');
  check('a redraw just after a screen opens doesn\'t replay its fade-in', arrival.replayed, 0);
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);

  // Typing on New Period updates the amount without rebuilding the screen: the Start button (and
  // its bobbing hand) and the scrolling HELP text carry on rather than restarting.
  await openMenuItem('New Period');
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.startButton = document.querySelector('#page .primary'); window.helpText = document.querySelector('#help .text'); });
  for (const k of '12') await page.locator('#page .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
  check('New Period: typing keeps the same Start button and HELP text', await page.evaluate(() => window.startButton.isConnected && window.helpText.isConnected), true);
  check('New Period: amount and button still update', await page.evaluate(() => [document.querySelector('.budget-amount').textContent, document.querySelector('#page .primary').disabled].join(' ')), '$0.12 false');
  check('text can\'t be selected except in text fields', await page.evaluate(() => [document.querySelector('.budget-amount'), document.querySelector('#help .text'), document.querySelector('.note')]
    .map((node) => getComputedStyle(node).webkitUserSelect ?? getComputedStyle(node).userSelect).join(' ')), 'none none text');
  // Once the button turns on, its hand bobs (Safari froze a hand that only appeared then).
  const handAt = () => page.evaluate(() => getComputedStyle(document.querySelector('#page .primary'), '::after').transform);
  const handBefore = await handAt();
  await page.waitForTimeout(230); // about half a bob
  check('New Period: the Start button\'s hand bobs after typing', (await handAt()) !== handBefore, true);
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(300);

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
  check('delete message', await page.locator('#help .text').first().textContent(), 'Period 1 deleted');
  check('its expenses deleted too', (await saved()).expenses.length, 0);
  await page.locator('#undo-btn').tap();
  await page.waitForTimeout(300);
  check('undo restores the period', await page.locator('.period-row').count(), 2);
  check('undo restores its expenses', (await saved()).expenses.length, expenseCount);
  await page.locator('#nav-btn').tap();
  await page.waitForTimeout(250);
  const spentBefore = await spentText(page);
  await openMenuItem('Current Period');
  page.once('dialog', (d) => d.accept());
  await page.locator('.delete-btn').tap();
  await page.waitForTimeout(300);
  check('deleting the current period returns to the main screen', await page.locator('#page').isHidden(), true);
  check('previous period reopened', await spentText(page), '$57.50');
  check('reopened period is current', (await saved()).periods.map((p) => p.end).join(','), '');
  await page.locator('#undo-btn').tap();
  await page.waitForTimeout(300);
  check('undo makes the newer period current again', await spentText(page), spentBefore);
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
    check('Safari tab: HELP shows how to install', await p8.locator('#help .text').textContent(), 'Install: Share → Add to Home Screen');
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

  // Categories screen: names can't clash (ignoring capitalization) or be empty; new ones get a free
  // name; nothing is saved until Save; Back with unsaved changes asks first.
  const clash = await browser.newContext({ ...devices['iPhone 13'] });
  await mockRates(clash, RATE);
  const p5 = await newPage(clash);
  await p5.goto(URL);
  await startFirstPeriod(p5, '100000');
  const openCategories = () => openMenu(p5, 'Categories');
  const savedNames = () => p5.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')).categories.filter((c) => !c.archived).map((c) => c.name).sort().join(','));
  const save5 = p5.locator('#page .actions .primary', { hasText: 'Save' });
  await openCategories();
  const before = await savedNames();
  check('Save is in view above the bottom bar without scrolling', await p5.evaluate(() => {
    const save = document.querySelector('#page .actions .primary').getBoundingClientRect();
    return save.top >= 0 && save.bottom <= document.querySelector('.dock').getBoundingClientRect().top;
  }), true);
  check('Add/Save are fixed, so scrolling or bouncing the list can\'t carry them', await p5.evaluate(() => getComputedStyle(document.querySelector('#page .actions')).position), 'fixed');
  check('scrolled to the end, the whole list clears Add/Save', await p5.evaluate(() => {
    const page = document.getElementById('page');
    page.scrollTop = page.scrollHeight;
    const lastWindow = [...document.querySelectorAll('#page-body > :not(.actions)')].at(-1).getBoundingClientRect();
    const result = lastWindow.bottom <= document.querySelector('#page .actions').getBoundingClientRect().top;
    page.scrollTop = 0;
    return result;
  }), true);
  const nameField = (n) => p5.locator('.cat-row input').nth(n);
  const funIndex = (await categoryRows(p5)).indexOf('Fun');
  await nameField(funIndex).fill('groceries');
  await save5.tap();
  await p5.waitForTimeout(200);
  check('saving a clashing name is refused', await p5.locator('#help .text').first().textContent(), "There's already a category called Groceries.");
  check('and nothing is saved', await savedNames(), before);
  await nameField(funIndex).fill('Fun');
  check('Save turns off again when the draft matches what\'s saved', await save5.isDisabled(), true);
  await messageCleared(p5);

  // New categories start blank, scrolled into view clear of the bars; one still blank when the
  // keyboard closes is dropped.
  const rowCount = (await categoryRows(p5)).length;
  await p5.evaluate(() => document.getElementById('page').scrollTo(0, 0)); // from the top of a long list
  await p5.locator('.wide-btn', { hasText: 'Add category' }).tap();
  await p5.waitForTimeout(100);
  check('Add category: the new field is in view, clear of the top and bottom bars', await p5.evaluate(() => {
    const box = document.activeElement.getBoundingClientRect();
    return box.top >= document.querySelector('.hud').getBoundingClientRect().bottom && box.bottom <= document.querySelector('#page .actions').getBoundingClientRect().top;
  }), true);
  check('Add category: one more row, blank', `${(await categoryRows(p5)).length} "${(await categoryRows(p5)).at(-1)}"`, `${rowCount + 1} ""`);
  await p5.evaluate(() => document.activeElement.blur()); // the keyboard closes
  check('left blank when the keyboard closes: dropped', (await categoryRows(p5)).length, rowCount);
  check('and Save is off again', await save5.isDisabled(), true);
  await p5.locator('.wide-btn', { hasText: 'Add category' }).tap();
  await p5.keyboard.type('Snacks');
  await p5.keyboard.press('Enter');
  await p5.locator('.wide-btn', { hasText: 'Add category' }).tap();
  await p5.keyboard.type('Pets');
  await p5.keyboard.press('Enter');
  const rows = await categoryRows(p5);
  check('typed new ones stay, at the bottom until saved', rows.slice(-2).join(','), 'Snacks,Pets');
  check('colors follow the list in GF order', (await categoryDotColors(p5)).join(','), readPalette().map((c) => c.hex).slice(0, rows.length).join(','));
  await p5.locator('.cat-row').last().locator('.mini').tap();
  check('removing an unsaved one', await p5.locator('#help .text').first().textContent(), 'Pets removed');
  await p5.locator('#undo-btn').tap();
  check('Undo brings it back', (await categoryRows(p5)).at(-1), 'Pets');

  // Back with unsaved changes: Cancel stays, OK leaves without saving.
  p5.once('dialog', (d) => d.dismiss());
  await p5.locator('#nav-btn').tap();
  await p5.waitForTimeout(200);
  check('Back with unsaved changes: Cancel stays', await titleText(p5), 'Categories');
  p5.once('dialog', (d) => d.accept());
  await p5.locator('#nav-btn').tap();
  await p5.waitForTimeout(300);
  check('Back with unsaved changes: OK leaves', await p5.locator('#page').isHidden(), true);
  check('and the changes are discarded', await savedNames(), before);

  // Save with blanks: a new category left blank is dropped, an existing one cleared is removed, and
  // tapping Save while a blank new field still has the keyboard up still saves the rest.
  await openCategories();
  const names = await categoryRows(p5);
  await nameField(names.indexOf('Shopping')).fill('Stuff');
  await nameField(names.indexOf('Health')).fill('');
  await p5.locator('.wide-btn', { hasText: 'Add category' }).tap(); // blank, focused
  await save5.tap();
  await p5.waitForTimeout(300);
  const afterSave = (await savedNames()).split(',');
  check('Save with blanks: the rename is saved', afterSave.includes('Stuff') && !afterSave.includes('Shopping'), true);
  check('Save with blanks: a category whose name was cleared is removed', afterSave.includes('Health'), false);
  check('Save with blanks: the blank new one is dropped, nothing blank saved', `${afterSave.length} ${afterSave.some((n) => !n.trim())}`, `${names.length - 1} false`);
  await messageCleared(p5);
  await p5.locator('#nav-btn').tap();
  await p5.waitForTimeout(300);

  // Category names never keep spaces at either end: not from old saved data, not from typing.
  await p5.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('budget-tracker'));
    data.categories.find((c) => c.name === 'Bills').name = '  Bills   ';
    localStorage.setItem('budget-tracker', JSON.stringify(data));
  });
  await p5.reload();
  await p5.waitForTimeout(400);
  check('spaces around a saved name are dropped on load', await p5.locator('.strip .chip', { hasText: 'Bills' }).first().evaluate((c) => c.textContent), 'Bills');
  await openCategories();
  check('and on the Categories screen', (await categoryRows(p5))[0], 'Bills');
  const otherIndex = (await categoryRows(p5)).indexOf('Other');
  await nameField(otherIndex).fill('Misc   ');
  await nameField(otherIndex).press('Enter');
  check('typed trailing spaces go when you finish the name', await nameField(otherIndex).inputValue(), 'Misc');
  await save5.tap();
  await p5.waitForTimeout(300);
  check('and are never saved', await p5.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')).categories.some((c) => c.name !== c.name.trim())), false);
  check('saved as Misc', (await savedNames()).split(',').includes('Misc'), true);
  await messageCleared(p5);
  await p5.locator('#nav-btn').tap();
  await p5.waitForTimeout(300);

  // Add category with the keyboard open: the new name field ends up above the keyboard, not behind
  // it. (A 300px keyboard is faked by shrinking the visual viewport, as iOS does.)
  await openCategories();
  await p5.evaluate(() => Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 300 }));
  await p5.locator('.wide-btn', { hasText: 'Add category' }).tap();
  await p5.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
  await p5.waitForTimeout(200);
  const field = await p5.evaluate(() => ({ value: document.activeElement.value, bottom: document.activeElement.getBoundingClientRect().bottom, keyboardTop: innerHeight - 300 }));
  check(`new category field is above the keyboard (bottom ${field.bottom}, keyboard at ${field.keyboardTop})`, field.value === '' && field.bottom <= field.keyboardTop, true);
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
  check('v1 data: totals intact', await spentText(p3), '$13.51');
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
  check('v1 backup: restores', await p3.locator('#help .text').first().textContent(), 'Backup restored');
  const restored = await p3.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')));
  check('v1 backup: upgraded on restore', [restored.version, restored.expenses[0].note, restored.expenses[0].original.perUsd].join('|'), '3|restored from an old backup|18.5');
  await old.close();

  // Closing the keyboard on a long screen scrolled to its bottom: the room made for the keyboard
  // isn't dropped at once (the screen would snap down by the keyboard's height as it slides away);
  // the screen glides to where it will rest, then the room goes. A stand-in for iOS's
  // visualViewport lets the test open and close a "keyboard".
  const kb = await browser.newContext({ ...devices['iPhone 13'] });
  await mockRates(kb, RATE);
  await kb.addInitScript(() => {
    const viewport = new EventTarget();
    let keyboard = 0;
    Object.defineProperty(viewport, 'height', { get: () => window.innerHeight - keyboard });
    viewport.offsetTop = 0;
    window.setKeyboard = (height) => { keyboard = height; viewport.dispatchEvent(new Event('resize')); };
    Object.defineProperty(window, 'visualViewport', { get: () => viewport, configurable: true });
  });
  const p9 = await newPage(kb);
  await p9.goto(URL);
  await appReady(p9);
  await startFirstPeriod(p9);
  await openMenu(p9, 'Categories');
  const opened = await p9.evaluate(async () => {
    const screen = document.getElementById('page');
    screen.querySelector('.cat-row:last-of-type input').focus();
    window.setKeyboard(300);
    screen.scrollTop = screen.scrollHeight;
    const before = screen.scrollTop;
    document.activeElement.blur();
    window.setKeyboard(0);
    const right = screen.scrollTop; // read at once: forces layout, as the next frame would
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { before, right, after: screen.scrollTop, rest: screen.scrollHeight - screen.clientHeight, room: getComputedStyle(document.documentElement).getPropertyValue('--keyboard') };
  });
  check('keyboard closing: the screen doesn\'t snap down at once', opened.before > 0 && opened.right === opened.before, true);
  check('keyboard closing: then glides to rest and the room goes', `${opened.after === opened.rest && opened.after < opened.before} ${opened.room}`, 'true 0px');
  await kb.close();

  const realErrors = errors.filter((e) => !/Failed to load resource|frankfurter|network/i.test(e));
  console.log(realErrors.length ? `ERRORS:\n${realErrors.join('\n')}` : 'No console errors');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e.message); process.exit(1); });
