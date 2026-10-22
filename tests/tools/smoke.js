// End-to-end check of the deployed app: the real site, the real exchange-rate service and the real
// service worker, in WebKit (Safari's engine) at iPhone 14 Pro size, as the installed app. Walks
// through everyday use and reports anything that fails, including errors in the page's console.
// It starts from empty storage in a fresh browser, so it never touches the data on a phone.
// Usage: npm run smoke [-- <url>]   (default: the live site)
const { webkit, chromium, devices } = require('playwright');
const { asInstalledApp, fakeShareSheet, grabFile, openMenu, appReady, check } = require('../helpers');

const URL = process.argv[2] || 'https://www.johnjylee.com/bgt-j/';
let failed = 0;
const ok = (label, actual, expected) => { if (!check(label, actual, expected)) failed++; };

(async () => {
  const browser = asInstalledApp(await webkit.launch());
  const context = await browser.newContext({ ...devices['iPhone 14 Pro'], serviceWorkers: 'allow' });
  await fakeShareSheet(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  const key = (k, scope) => page.locator(`${scope} .key`).filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
  const type = async (digits, scope = '#view-input') => { for (const k of digits) await key(k, scope); };
  const help = () => page.locator('#help .text').textContent();
  const messageGone = () => page.waitForSelector('#help:not(.message)', { timeout: 15000 });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')));

  await page.goto(URL);
  await appReady(page);
  ok('opens on First Budget', await page.locator('#title').textContent(), 'First Budget');

  // First budget, then a dollar expense and a peso expense.
  await type('150000', '#page');
  await page.locator('#page .primary').tap();
  await page.waitForSelector('#page', { state: 'hidden' });
  await messageGone();
  ok('main screen shows the budget left', await help(), '$1,500.00 left this period');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('budget-tracker')).rates.date, null, { timeout: 15000 });
  const rate = (await stored()).rates.perUsd.MXN;
  ok('real MXN rate downloaded', rate > 5 && rate < 50, true);
  await type('1250');
  await page.locator('.add-btn').tap();
  ok('USD expense added', await help(), 'Added $12.50 · Groceries');
  await page.locator('#undo-btn').waitFor();
  await messageGone();
  await page.locator('.currency-opts').tap();
  await type('300');
  ok('peso conversion shown', (await page.locator('.amount-sub').textContent()).startsWith('≈ $'), true);
  await page.locator('.add-btn').tap();
  await messageGone();
  const expenses = (await stored()).expenses;
  ok('two expenses saved', expenses.length, 2);
  ok('peso expense keeps its original amount and rate', JSON.stringify(expenses[1].original), JSON.stringify({ currency: 'MXN', amount: 300, perUsd: rate }));

  // Category grid by double tap.
  await page.locator('.strip .chip.selected').tap();
  await page.locator('.strip .chip.selected').tap();
  await page.waitForSelector('#sheet-backdrop.open');
  await page.locator('#sheet .grid .chip', { hasText: 'Health' }).tap();
  await page.waitForTimeout(600);
  ok('grid picks a category', await page.locator('.strip .chip.selected').textContent(), 'Health');

  // Summary, edit an expense.
  await openMenu(page, 'Current Period');
  ok('summary total', await page.locator('.donut-center strong').textContent(), `$${((1250 + expenses[1].usdCents) / 100).toFixed(2)}`);
  await page.locator('.cat-head', { hasText: 'Groceries' }).first().tap();
  await page.locator('.item').first().tap();
  await page.waitForSelector('#sheet-backdrop.open');
  await page.locator('#sheet input[type=text]').first().fill('20');
  await page.locator('#sheet .primary').tap();
  await page.waitForTimeout(400);
  // Both expenses are in Groceries; the newest (the peso one) is listed first, and is edited in pesos.
  const edited = (await stored()).expenses.find((e) => e.original);
  ok('peso expense edited in pesos at its saved rate', `${edited.original.amount} ${edited.usdCents}`, `20 ${Math.round((20 / rate) * 100)}`);
  await page.locator('#nav-btn').tap();
  await page.waitForSelector('#page', { state: 'hidden' });

  // Categories: rename, add, save.
  await openMenu(page, 'Categories');
  const rows = page.locator('.cat-row input');
  const fun = (await rows.evaluateAll((ns) => ns.map((n) => n.value))).indexOf('Fun');
  await rows.nth(fun).fill('Travel');
  await page.locator('.wide-btn', { hasText: 'Add category' }).tap();
  await page.keyboard.type('Coffee');
  await page.keyboard.press('Enter');
  await page.locator('#page .actions .primary').tap();
  await page.waitForTimeout(400);
  const names = (await stored()).categories.filter((c) => !c.archived).map((c) => c.name);
  ok('categories saved and sorted', JSON.stringify(names.slice().sort((a, b) => a.localeCompare(b))) === JSON.stringify(await rows.evaluateAll((ns) => ns.map((n) => n.value))) && names.includes('Travel') && names.includes('Coffee'), true);
  await page.locator('#nav-btn').tap();
  await page.waitForSelector('#page', { state: 'hidden' });

  // Backup, then New Period, Past Periods, delete with undo.
  await openMenu(page, 'Backup');
  const backup = await grabFile(page, 'webkit', () => page.locator('.wide-btn', { hasText: 'Export backup' }).tap());
  ok('backup exported', backup?.name?.startsWith('bgt-j-backup-') && JSON.parse(backup.text).expenses.length === 2, true);
  await page.locator('#nav-btn').tap();
  await page.waitForSelector('#page', { state: 'hidden' });
  await openMenu(page, 'New Period');
  await type('200000', '#page');
  await page.locator('#page .primary').tap();
  await page.waitForSelector('#page', { state: 'hidden' });
  ok('new period started', (await stored()).periods.length, 2);
  await openMenu(page, 'Past Periods');
  ok('both periods listed', await page.locator('.period-row').count(), 2);
  await page.locator('.period-row').last().tap();
  await page.locator('.delete-btn').tap();
  await page.waitForTimeout(400);
  ok('past period deleted', (await stored()).periods.length, 1);
  await page.locator('#undo-btn').tap();
  await page.waitForTimeout(400);
  ok('undo brings it back', (await stored()).periods.length, 2);

  // Data survives closing and reopening; then it opens offline.
  await page.goto(URL);
  await appReady(page);
  ok('data survives a reload', (await stored()).expenses.length, 2);
  await context.close();
  await browser.close();

  // Offline (Chromium: Playwright's WebKit can't reload while simulated offline).
  const chrome = asInstalledApp(await chromium.launch());
  const offline = await chrome.newContext({ ...devices['iPhone 14 Pro'], serviceWorkers: 'allow' });
  const p2 = await offline.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(URL);
  await p2.evaluate(() => navigator.serviceWorker.ready);
  await p2.reload();
  await p2.waitForTimeout(1500);
  await offline.setOffline(true);
  await p2.reload();
  await appReady(p2);
  ok('opens offline', await p2.locator('#title').textContent(), 'First Budget');
  await chrome.close();

  ok('no errors in the page', errors.join(' | '), '');
  console.log(failed ? `\n${failed} FAILED` : '\nAll smoke checks passed.');
  process.exitCode = failed ? 1 : 0;
})().catch((e) => {
  console.log(`CRASHED: ${e.message.split('\n')[0]}`);
  process.exitCode = 1;
});
