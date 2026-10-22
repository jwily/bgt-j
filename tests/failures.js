// Fourth pass: when things go wrong around the app. Storage full or corrupted, the rate server
// failing, backups from newer versions or with broken references, loading offline, the app left
// open overnight, a period spanning New Year, and a lot of data.
const { chromium, webkit, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { fakeShareSheet, grabFile, APP_URL, asInstalledApp, mockRates } = require('./helpers');

const ENGINE = process.env.ENGINE || 'chromium';
const OUT = path.join(__dirname, 'output');
const RATE = (date = '2026-10-21', rates = { MXN: 20 }) => JSON.stringify({ date, rates });
let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
const localToday = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// A small v2 data set for scenarios that start from saved data.
const sample = (overrides = {}) => ({
  version: 2,
  categories: [{ id: 'c1', name: 'Food', color: null, archived: false }],
  periods: [{ id: 'p1', budgetCents: 100000, start: localToday(), end: null }],
  expenses: [{ id: 'e1', periodId: 'p1', categoryId: 'c1', usdCents: 500, date: localToday(), note: 'lunch', original: null, createdAt: 1 }],
  rates: { perUsd: { MXN: 20 }, date: localToday(), checkedAt: Date.now() },
  input: { currency: 'USD', categoryId: 'c1' },
  lastBackupAt: null,
  ...overrides,
});

(async () => {
  const browser = asInstalledApp(ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch());
  const errors = [];

  // Opens the app in a fresh context. Options: saved (data to start with), snapshots, rate
  // (response body), status, serviceWorkers, clock (a Date to start the fake clock at).
  async function open({ saved, snapshots, rate = RATE(), status = 200, serviceWorkers = 'block', clock } = {}) {
    const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers });
    await fakeShareSheet(context);
    await mockRates(context, rate, status);
    if (saved !== undefined || snapshots) {
      await context.addInitScript(([data, snaps]) => {
        if (sessionStorage.getItem('seeded')) return; // seed once, not on every reload
        sessionStorage.setItem('seeded', '1');
        if (data !== null) localStorage.setItem('budget-tracker', data);
        if (snaps) localStorage.setItem('budget-tracker-snapshots', snaps);
      }, [saved === undefined ? null : saved, snapshots ? JSON.stringify(snapshots) : null]);
    }
    if (clock) await context.clock.install({ time: clock });
    const page = await context.newPage();
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(APP_URL);
    await page.waitForTimeout(400);
    const key = async (k) => {
      const scope = (await page.locator('#page').isVisible()) ? '#page' : '#view-input';
      await page.locator(`${scope} .key`).filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
    };
    const type = async (keys) => { for (const k of keys) await key(k); };
    const stored = (k = 'budget-tracker') => page.evaluate((name) => localStorage.getItem(name), k);
    return { context, page, dialogs, type, stored };
  }
  const menu = async (page, item) => {
    await page.waitForSelector('#help:not(.message)', { timeout: 6000 });
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(250);
    await page.locator('#menu button', { hasText: item }).tap();
    await page.waitForTimeout(300);
  };

  // --- Storage full: an unmissable warning instead of failing silently.
  {
    const { context, page, dialogs, type } = await open({ saved: JSON.stringify(sample()) });
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'budget-tracker') throw new DOMException('full', 'QuotaExceededError');
        return real.call(this, k, v);
      };
    });
    await type('500');
    await page.locator('.add-btn').tap();
    await page.waitForTimeout(300);
    check('storage full: warns', dialogs.some((m) => m.startsWith("Couldn't save: this phone's storage for the app is full")), true);
    check('storage full: the screen still shows what you did', await page.locator('.amount').textContent(), '$0.00');
    await context.close();
  }

  // --- Corrupted data with a snapshot (saved the old way, in localStorage, so this also checks
  // that old snapshots move to IndexedDB): recovered from it, with a message; the bad copy is kept.
  {
    const good = sample();
    const { context, page, dialogs, stored } = await open({
      saved: '{"version":2,"categ',
      snapshots: [{ at: Date.now() - 3600 * 1000, reason: 'start of the day', data: JSON.stringify(good) }],
    });
    check('corrupted: tells you it recovered', dialogs.some((m) => m.startsWith("Your saved data couldn't be read, so the app restored its snapshot from")), true);
    check('corrupted: data restored from the snapshot', JSON.parse(await stored()).expenses[0]?.note, 'lunch');
    check('corrupted: the unreadable copy is kept', await stored('budget-tracker-unreadable'), '{"version":2,"categ');
    check('corrupted: lands on the main screen', await page.locator('#page').isHidden(), true);
    await context.close();
  }

  // --- Corrupted data and no snapshot: starts fresh, but the unreadable copy is still kept.
  {
    const { context, page, dialogs, stored } = await open({ saved: 'not json at all' });
    check('corrupted, no snapshot: starts fresh', await page.locator('#title').textContent(), 'First Budget');
    check('corrupted, no snapshot: no recovery message', dialogs.length, 0);
    check('corrupted, no snapshot: unreadable copy kept', await stored('budget-tracker-unreadable'), 'not json at all');
    await context.close();
  }

  // --- Rate server failures on first launch: no crash, an honest estimate line.
  for (const [label, rate, status] of [['HTTP 500', 'oops', 500], ['not JSON', '<html>', 200], ['no MXN', RATE(localToday(), {}), 200], ['negative', RATE(localToday(), { MXN: -3 }), 200]]) {
    const { context, page, type } = await open({ rate, status });
    await type('100000');
    await page.locator('#page .primary').tap();
    await page.waitForTimeout(300);
    await page.locator('.currency-opts').tap();
    check(`rate server ${label}: honest estimate`, (await page.locator('.amount-sub span').allTextContents())[1], '~18.5 MXN per USD (estimate: no rates downloaded yet)');
    await context.close();
  }

  // --- An old rate while the server is down: the rate line says how old it is.
  {
    const old = new Date(Date.now() - 10 * 86400000);
    const { context, page } = await open({
      saved: JSON.stringify(sample({ rates: { perUsd: { MXN: 19.1 }, date: localToday(old), checkedAt: 0 }, input: { currency: 'MXN', categoryId: 'c1' } })),
      rate: 'down', status: 503,
    });
    const line = (await page.locator('.amount-sub span').allTextContents())[1];
    check('old rate: shows its date', /^1 USD = 19\.10 MXN \(rate from [A-Z][a-z]{2} \d+\)$/.test(line), true);
    await context.close();
  }

  // --- A backup from a newer version of the app, and one with broken references.
  {
    const { context, page } = await open({ saved: JSON.stringify(sample()) });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'newer-backup.json'), JSON.stringify(sample({ version: 99 })));
    await menu(page, 'Backup');
    await page.locator('.page-body input[type=file]').setInputFiles(path.join(OUT, 'newer-backup.json'));
    await page.waitForTimeout(300);
    check('newer backup: says so', await page.locator('#help .text').first().textContent(), 'That backup is from a newer version of the app. Reopen the app to update it, then try again.');

    const broken = sample({
      expenses: [
        { id: 'e1', periodId: 'p1', categoryId: 'gone', usdCents: 700, date: localToday(), note: 'category deleted elsewhere', original: null, createdAt: 1 },
        { id: 'e2', periodId: 'missing', categoryId: 'c1', usdCents: 300, date: localToday(), note: 'period missing', original: null, createdAt: 2 },
      ],
    });
    fs.writeFileSync(path.join(OUT, 'broken-backup.json'), JSON.stringify(broken));
    await page.locator('.page-body input[type=file]').setInputFiles(path.join(OUT, 'broken-backup.json'));
    await page.waitForTimeout(400);
    check('broken references: backup restores', await page.locator('#help .text').first().textContent(), 'Backup restored');
    const csv = await grabFile(page, ENGINE, () => page.locator('.wide-btn', { hasText: 'CSV' }).tap());
    check('broken references: CSV still exports both rows', csv.text.split('\n').length, 3);
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(300);
    await menu(page, 'Current Period');
    check('broken references: summary shows the expense as Unknown', await page.locator('.cat-head', { hasText: 'Unknown' }).count(), 1);
    await context.close();
  }

  // --- Left open overnight: "Today" means the new day when you tap Add.
  {
    const evening = new Date();
    evening.setHours(23, 50, 0, 0);
    const { context, page, type, stored } = await open({ clock: evening, saved: JSON.stringify(sample({ periods: [{ id: 'p1', budgetCents: 100000, start: localToday(evening), end: null }] })) });
    const morning = new Date(evening.getTime() + 9 * 3600 * 1000);
    await page.clock.setSystemTime(morning);
    await type('500');
    check('overnight: the date button says Today', await page.locator('.date-btn span').textContent(), 'Today');
    await page.locator('.add-btn').tap();
    await page.waitForTimeout(300);
    check('overnight: filed under the new day', JSON.parse(await stored()).expenses.at(-1).date, localToday(morning));
    await context.close();
  }

  // --- A period spanning New Year shows the year on the dates that need it.
  {
    const thisYear = new Date().getFullYear();
    const { context, page } = await open({
      saved: JSON.stringify(sample({
        periods: [
          { id: 'p0', budgetCents: 100000, start: `${thisYear - 1}-12-20`, end: `${thisYear}-01-05` },
          { id: 'p1', budgetCents: 100000, start: `${thisYear}-01-05`, end: null },
        ],
      })),
    });
    await menu(page, 'Past Periods');
    check('New Year period: last year’s date has its year', await page.locator('.period-row').nth(1).locator('small').first().textContent(), `Dec 20, ${thisYear - 1} – Jan 5`);
    await context.close();
  }

  // --- Opens offline (from the service worker's copy) after one online visit.
  // Chromium only: Playwright's WebKit build fails internally when reloading while simulated
  // offline (a limit of the test browser, not the app; its service-worker support is partial).
  if (ENGINE === 'chromium') {
    const { context, page, type } = await open({ serviceWorkers: 'allow' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the service worker, which caches as it goes
    await page.waitForTimeout(600);
    await context.setOffline(true);
    await page.reload();
    await page.waitForTimeout(600);
    check('offline: the app still opens', await page.locator('#page .key').count(), 12);
    await type('100000');
    await page.locator('#page .primary').tap();
    await page.waitForTimeout(300);
    check('offline: and works', await page.locator('#page').isHidden(), true);
    await context.close();
  }

  // --- A lot of data (about three years of paychecks): still quick.
  {
    const categories = Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, name: `Category ${String(i).padStart(2, '0')}`, color: null, archived: false }));
    const periods = Array.from({ length: 72 }, (_, i) => ({ id: `p${i}`, budgetCents: 200000, start: localToday(new Date(Date.now() - (72 - i) * 15 * 86400000)), end: i === 71 ? null : localToday(new Date(Date.now() - (71 - i) * 15 * 86400000)) }));
    const expenses = Array.from({ length: 4000 }, (_, i) => ({ id: `e${i}`, periodId: `p${Math.min(71, Math.floor(i / 56))}`, categoryId: `c${i % 16}`, usdCents: 100 + (i % 9000), date: localToday(), note: `expense ${i}`, original: i % 3 ? null : { currency: 'MXN', amount: 200, perUsd: 20 }, createdAt: i }));
    const data = sample({ categories, periods, expenses, input: { currency: 'USD', categoryId: 'c0' } });
    const t0 = Date.now();
    const { context, page, type } = await open({ saved: JSON.stringify(data) });
    const opened = Date.now() - t0;
    check('lots of data: about 4,000 expenses saved', expenses.length, 4000);
    check(`lots of data: opens in under 3s (${opened}ms)`, opened < 3000, true);
    let t = Date.now();
    await type('500');
    await page.locator('.add-btn').tap();
    await page.locator('#help.message').waitFor();
    check(`lots of data: adding stays quick (${Date.now() - t}ms, under 1s)`, Date.now() - t < 1000, true);
    t = Date.now();
    await menu(page, 'Past Periods');
    check(`lots of data: period list in under 1.5s (${Date.now() - t}ms after the message clears)`, (await page.locator('.period-row').count()) === 72, true);
    await context.close();
  }

  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No console errors');
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e.message); process.exit(1); });
