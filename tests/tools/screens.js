// Screenshots every screen (with realistic data) on the shortest current iPhone (13 mini) and the
// user's iPhone 14 Pro, into tests/output/screens/. For reviewing layout and spacing by eye.
// Usage: npm run screens
const { webkit, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { serveApp, APP_URL, asInstalledApp, mockRates } = require('../helpers');

const OUT = path.join(__dirname, '..', 'output', 'screens');
const RATE = '{"date":"2026-10-20","rates":{"MXN":18.5}}';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serveApp();
  const browser = asInstalledApp(await webkit.launch());
  for (const [phone, device] of [['13mini', devices['iPhone 13 Mini']], ['14pro', devices['iPhone 14 Pro']]]) {
    const context = await browser.newContext(device);
    await mockRates(context, RATE);
    const page = await context.newPage();
    const shot = (name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${phone}-${name}.png`), fullPage });
    const pause = (ms = 350) => page.waitForTimeout(ms);
    const key = async (k) => {
      const scope = (await page.locator('#page').isVisible()) ? '#page' : '#view-input';
      await page.locator(`${scope} .key`).filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
    };
    const type = async (keys) => { for (const k of keys) await key(k); };
    const menu = async (item) => {
      await page.locator('#nav-btn').tap();
      await pause(250);
      if (item) await page.locator('#menu button', { hasText: item }).tap();
      await pause();
    };
    const back = async () => { await page.locator('#nav-btn').tap(); await pause(); };
    const add = async (currency, keys, category, note = '') => {
      if ((await page.locator('.currency-opts .on').textContent()) !== currency) await page.locator('.currency-opts').tap();
      await page.locator('.strip .chip', { hasText: category }).first().tap();
      await pause(600);
      await type(keys);
      if (note) await page.locator('.note').fill(note);
      await page.locator('.add-btn').tap();
      await pause(200);
    };

    await page.goto(APP_URL);
    await pause(500);
    await shot('01-first-budget');
    await type('180000');
    await page.locator('#page .primary').tap();
    await pause(4300); // let the "started" message clear
    await shot('02-main-usd');

    await add('USD', '8423', 'Groceries', 'Weekly shop at the market');
    await add('USD', '1250', 'Transport', 'Uber');
    await add('MXN', '450', 'Dining', 'Tacos al pastor with friends after work');
    await add('USD', '120000', 'Housing', 'Rent');
    await add('MXN', '89', 'Fun');
    await type('2500');
    await page.locator('.note').fill('Coffee');
    await shot('03-main-mxn-typing');

    await page.locator('.strip .chip.selected').tap();
    await page.locator('.strip .chip.selected').tap();
    await pause();
    await shot('04-category-grid');
    await page.locator('#sheet .grid .chip').first().tap();
    await pause();

    await menu();
    await shot('05-menu');
    await page.locator('#menu button', { hasText: 'Current Period' }).tap();
    await pause();
    await page.locator('.cat-head', { hasText: 'Dining' }).tap();
    await page.locator('.cat-head', { hasText: 'Housing' }).tap();
    await pause();
    await shot('06-summary', true);
    await page.locator('.item', { hasText: 'Tacos' }).tap();
    await pause();
    await shot('07-edit-expense');
    await page.mouse.click(200, 30);
    await pause();
    await back();

    await menu('New Period');
    await type('150000');
    await shot('08-new-period');
    await page.locator('#page .primary').tap();
    await pause(4300);
    await add('USD', '999', 'Health');

    await menu('Past Periods');
    await shot('09-periods');
    await back();
    await menu('Categories');
    await page.locator('.cat-row').filter({ has: page.locator('input') }).last().locator('.mini').tap(); // archive one
    await pause(4300);
    await shot('10-categories', true);
    await back();
    await menu('Backup');
    await shot('11-backup', true);
    await context.close();
  }
  await browser.close();
  server.close();
  console.log(`Screens saved to ${OUT}`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
