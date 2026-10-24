// Fourth pass: when things go wrong around the app. Storage full or corrupted, the rate server
// failing, backups from newer versions or with broken references, loading offline, the app left
// open overnight, a period spanning New Year, and a lot of data.
const { chromium, webkit, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { fakeShareSheet, grabFile, APP_URL, asInstalledApp, mockRates, serveApp, openMenu, appReady, check, scenarios } = require('./helpers');

const ENGINE = process.env.ENGINE || 'chromium';
const OUT = require('path').join(__dirname, 'output', process.env.ENGINE || 'chromium'); // screenshots and exported files, one folder per engine so runs can overlap (not committed)
const RATE = (date = '2026-10-21', rates = { MXN: 20 }) => JSON.stringify({ date, rates });
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
  const scenario = scenarios(browser);

  // Offline: every file the app runs on is on the service worker's list (sw.js FILES), so a new
  // one can't quietly break opening offline. Launch images are left out on purpose (iOS fetches
  // them when the app is installed, not at launch).
  await scenario('every file available offline', async () => {
    const app = path.join(__dirname, '..', 'app');
    const sw = fs.readFileSync(path.join(app, 'sw.js'), 'utf8');
    const listed = [...sw.slice(sw.indexOf('const FILES'), sw.indexOf('];', sw.indexOf('const FILES'))).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.relative(app, path.join(dir, e.name))]));
    const missing = walk(app).filter((f) => !/^(sw\.js|fonts\/OFL\.txt|icons\/launch-.*)$|\.DS_Store$/.test(f) && !listed.includes(f));
    check('every app file is available offline', missing.join(', '), '');
  });

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
    await appReady(page);
    const key = async (k) => {
      const scope = (await page.locator('#page').isVisible()) ? '#page' : '#view-input';
      await page.locator(`${scope} .key`).filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
    };
    const type = async (keys) => { for (const k of keys) await key(k); };
    const stored = (k = 'budget-tracker') => page.evaluate((name) => localStorage.getItem(name), k);
    return { context, page, dialogs, type, stored };
  }
  const menu = openMenu;

  // --- Storage full: an unmissable warning instead of failing silently.
  await scenario('storage full', async () => {
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
    // More changes while it stays full (each currency tap saves) don't each raise another.
    await page.locator('.currency-opts').tap();
    await page.locator('.currency-opts').tap();
    check('storage full: warns once, not at every change', dialogs.filter((m) => m.startsWith("Couldn't save")).length, 1);
    check('storage full: the screen still shows what you did', await page.locator('#help .text').textContent(), 'Added $5.00 · Food');
    await context.close();
  });

  // --- Corrupted data with a snapshot (saved the old way, in localStorage, so this also checks
  // that old snapshots move to IndexedDB): recovered from it, with a message; the bad copy is kept.
  await scenario('corrupted data with a snapshot', async () => {
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
  });

  // --- Corrupted data and no snapshot: starts fresh, but the unreadable copy is still kept.
  await scenario('corrupted data, no snapshot', async () => {
    const { context, page, dialogs, stored } = await open({ saved: 'not json at all' });
    check('corrupted, no snapshot: starts fresh', await page.locator('#title').textContent(), 'First Budget');
    check('corrupted, no snapshot: says so, and that the data was kept', dialogs.join(' | '), "Your saved data couldn't be read, and there's no snapshot to go back to. It's been kept aside, not deleted: restore a backup from Menu → Backup if you have one.");
    check('corrupted, no snapshot: unreadable copy kept', await stored('budget-tracker-unreadable'), 'not json at all');
    await context.close();
  });

  // --- Rate server failures on first launch: no crash, an honest estimate line.
  await scenario('rate server failures', async () => {
    for (const [label, rate, status] of [['HTTP 500', 'oops', 500], ['not JSON', '<html>', 200], ['no MXN', RATE(localToday(), {}), 200], ['negative', RATE(localToday(), { MXN: -3 }), 200]]) {
      const { context, page, type } = await open({ rate, status });
      await type('100000');
      await page.locator('#page .primary').tap();
      await page.waitForTimeout(300);
      await page.locator('.currency-opts').tap();
      check(`rate server ${label}: honest estimate`, (await page.locator('.amount-sub span').allTextContents())[1], '~18.5 MXN per USD (estimate: no rates downloaded yet)');
      await context.close();
    }
  });

  // --- An old rate while the server is down: the rate line says how old it is.
  await scenario('an old rate while the server is down', async () => {
    const old = new Date(Date.now() - 10 * 86400000);
    const { context, page } = await open({
      saved: JSON.stringify(sample({ rates: { perUsd: { MXN: 19.1 }, date: localToday(old), checkedAt: 0 }, input: { currency: 'MXN', categoryId: 'c1' } })),
      rate: 'down', status: 503,
    });
    const line = (await page.locator('.amount-sub span').allTextContents())[1];
    check('old rate: shows its date', /^1 USD = 18\.62 MXN \(rate from [A-Z][a-z]{2} \d+\)$/.test(line), true);
    await context.close();
  });

  // --- A backup from a newer version of the app, and one with broken references.
  await scenario('newer and broken backups', async () => {
    const { context, page } = await open({ saved: JSON.stringify(sample()) });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'newer-backup.json'), JSON.stringify(sample({ version: 99 })));
    await menu(page, 'Backup');
    await page.locator('.page-body input[type=file]').setInputFiles(path.join(OUT, 'newer-backup.json'));
    await page.waitForTimeout(300);
    check('newer backup: says so', await page.locator('#help .text').first().textContent(), 'That backup is from a newer version of the app. Reopen the app to update it, then try again.');

    // Backups the app couldn't run on are refused, not restored.
    const malformed = [
      ['a category with no name', sample({ categories: [{ id: 'c1', name: 'Food', color: null, archived: false }, { id: 'c2', color: null, archived: false }] })],
      ['every category archived', sample({ categories: [{ id: 'c1', name: 'Food', color: null, archived: true }] })],
      ['two open periods', (() => { const d = sample(); d.periods.push({ ...d.periods[0], id: 'p2' }); return d; })()],
      ['an expense with no amount', (() => { const d = sample(); delete d.expenses[0].usdCents; return d; })()],
    ];
    for (const [label, data] of malformed) {
      fs.writeFileSync(path.join(OUT, 'malformed-backup.json'), JSON.stringify(data));
      await page.locator('.page-body input[type=file]').setInputFiles(path.join(OUT, 'malformed-backup.json'));
      await page.waitForTimeout(300);
      check(`backup with ${label}: refused`, await page.locator('#help .text').first().textContent(), "That file isn't a budget backup.");
    }

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
  });

  // --- Left open overnight: "Today" means the new day when you tap Add.
  await scenario('left open overnight', async () => {
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
  });

  // --- A period spanning New Year shows the year on the dates that need it.
  await scenario('a period spanning New Year', async () => {
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
  });

  // --- Opens offline (from the service worker's copy) after one online visit.
  // Chromium only: Playwright's WebKit build fails internally when reloading while simulated
  // offline (a limit of the test browser, not the app; its service-worker support is partial).
  if (ENGINE === 'chromium') await scenario('opening offline', async () => {
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
  });

  // --- Launches come straight from the saved copy; a deploy is downloaded in the background and
  // shows up on the launch after, even though the host lets browsers reuse files for 10 minutes
  // unchecked (GitHub Pages sends max-age=600). Chromium only, like the offline check.
  if (ENGINE === 'chromium') await scenario('deploys', async () => {
    let version = 'old';
    const pages = await serveApp({
      port: 8766,
      headers: { 'Cache-Control': 'max-age=600' },
      change: (urlPath, data) => (urlPath === '/js/money.js' ? `${data}\n// deploy: ${version}\n` : null),
    });
    const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' });
    const page = await context.newPage();
    await page.goto('http://localhost:8766/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the service worker
    const deployed = () => page.evaluate(() => fetch('js/money.js').then((r) => r.text()).then((t) => t.match(/deploy: (\w+)/)?.[1]));
    // Waits until the saved version has the given deploy, and returns the saved versions' names.
    const savedVersion = (wanted) => page.evaluate(async (want) => {
      for (let i = 0; i < 150; i++) { // up to 15s: slow when all the test runs share the machine
        const names = (await caches.keys()).filter((n) => n.startsWith('bgt-j-')).sort();
        const newest = names.length && await caches.open(names.at(-1));
        const file = newest && await newest.match('js/money.js');
        // Complete, and the cleanup after saving it (keeping just the one it replaced) is done.
        if (file && (await file.text()).includes(`deploy: ${want}`) && await newest.match('__complete__') && names.length <= 2) return names;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    }, wanted);
    const says = (text) => page.waitForFunction((t) => document.querySelector('#help .text')?.textContent === t, text, { timeout: 5000 }).then(() => true, () => false);
    const helpText = () => page.evaluate(() => document.querySelector('#help .text')?.textContent ?? '');
    check('deploy: the first version loads', await deployed(), 'old');
    await page.waitForTimeout(800);
    check('deploy: a fresh install says nothing', await helpText() === 'App updated', false);
    const firstSaved = await savedVersion('old');
    await page.evaluate(() => caches.open('another-app-on-this-site').then((c) => c.put('x', new Response('y'))));
    version = 'new';
    await page.reload(); // a launch: served at once from the saved copy; the new version downloads for next time
    check('deploy: the launch right after a deploy still runs the saved version', await deployed(), 'old');
    check('deploy: the new version is saved in the background, next to the one in use', (await savedVersion('new'))?.length, 2);
    check('deploy: other caches on the site are left alone', await page.evaluate(() => caches.has('another-app-on-this-site')), true);
    check('deploy: nothing said while it only downloads', await helpText() === 'App updated', false);
    await page.reload(); // the next launch
    check('deploy: and runs on the launch after', await deployed(), 'new');
    check('deploy: which says the app was updated', await says('App updated'), true);
    await page.waitForTimeout(4500); // longer than a message shows for
    check('deploy: briefly, like any message', await helpText() === 'App updated', false);
    const before = await savedVersion('new');
    await page.reload();
    await page.waitForTimeout(800);
    check('deploy: a launch with nothing new saves nothing', JSON.stringify(await savedVersion('new')), JSON.stringify(before));
    check('deploy: ...and says nothing', await helpText() === 'App updated', false);
    version = 'newer';
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // back from the background, no relaunch
    check('deploy: coming back from the background finds a new version too', (await savedVersion('newer'))?.length, 2);
    await page.reload(); // the version before last goes
    check('deploy: a launch on a new version says so even when it came in from the background', await says('App updated'), true);
    check('deploy: only the newest two versions are kept', JSON.stringify((await savedVersion('newer'))?.includes(firstSaved?.[0])), 'false');
    // A launch left open across deploys (iOS keeps the app resumed for days) keeps its version: its
    // files still come from it two deploys later.
    const lingering = await context.newPage();
    await lingering.goto('http://localhost:8766/'); // runs "newer"
    for (const next of ['newest', 'final']) {
      version = next;
      await page.reload();
      await page.evaluate((want) => new Promise((resolve) => {
        const look = async () => {
          const names = (await caches.keys()).filter((n) => n.startsWith('bgt-j-')).sort();
          const file = await (await caches.open(names.at(-1))).match('js/money.js');
          if (file && (await file.text()).includes(`deploy: ${want}`)) resolve(); else setTimeout(look, 100);
        };
        look();
      }), next);
    }
    check('deploy: a launch still open two deploys later keeps its version', await lingering.evaluate(() => fetch('js/money.js').then((r) => r.text()).then((t) => t.match(/deploy: (\w+)/)?.[1])), 'newer');
    await context.close();
    pages.close();
  });

  // --- Starting up: the app stays hidden until it's built, then shows all at once. If its code
  // never runs, the page still shows after 2.5s instead of staying black.
  await scenario('starting up', async () => {
    const { context, page } = await open();
    await page.waitForTimeout(250); // the 0.15s fade-in
    check('start: revealed once built', await page.evaluate(() => !document.body.classList.contains('starting') && getComputedStyle(document.body).opacity), '1');
    await context.close();
    // On a slow connection the font can take a while; the app waits for it rather than appearing in
    // the fallback font and swapping (the start-up "flash").
    const slow = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
    await mockRates(slow, RATE());
    await slow.route('**/fonts/*.woff2', async (route) => { await new Promise((r) => setTimeout(r, 800)); await route.continue(); });
    const slowPage = await slow.newPage();
    await slowPage.goto(APP_URL);
    await slowPage.waitForFunction(() => !document.body.classList.contains('starting'));
    check('start: on a slow connection, the font is in before the app appears', await slowPage.evaluate(() => [...document.fonts].some((f) => f.family.includes('Nunito') && f.status === 'loaded')), true);
    await slow.close();
    const noScript = await browser.newContext({ ...devices['iPhone 13'], javaScriptEnabled: false });
    const bare = await noScript.newPage();
    await bare.goto(APP_URL);
    const hidden = await bare.evaluate(() => getComputedStyle(document.body).opacity);
    await bare.waitForTimeout(2800);
    check('start: if the app never starts, the page still shows after 2.5s', `${hidden} -> ${await bare.evaluate(() => getComputedStyle(document.body).opacity)}`, '0 -> 1');
    await noScript.close();
  });

  // --- A lot of data (about three years of paychecks): still quick.
  await scenario('lots of data', async () => {
    const categories = Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, name: `Category ${String(i).padStart(2, '0')}`, color: null, archived: false }));
    const periods = Array.from({ length: 72 }, (_, i) => ({ id: `p${i}`, budgetCents: 200000, start: localToday(new Date(Date.now() - (72 - i) * 15 * 86400000)), end: i === 71 ? null : localToday(new Date(Date.now() - (71 - i) * 15 * 86400000)) }));
    const expenses = Array.from({ length: 4000 }, (_, i) => ({ id: `e${i}`, periodId: `p${Math.min(71, Math.floor(i / 56))}`, categoryId: `c${i % 16}`, usdCents: 100 + (i % 9000), date: localToday(), note: `expense ${i}`, original: i % 3 ? null : { currency: 'MXN', amount: 200, perUsd: 20 }, createdAt: i }));
    const data = sample({ categories, periods, expenses, input: { currency: 'USD', categoryId: 'c0' } });
    const t0 = Date.now();
    const { context, page, type } = await open({ saved: JSON.stringify(data) });
    const opened = Date.now() - t0;
    check('lots of data: all 4,000 expenses load', await page.evaluate(async () => (await import('./js/store.js')).state.expenses.length), 4000);
    check(`lots of data: opens in under 3s (${opened}ms)`, opened < 3000, true);
    let t = Date.now();
    await type('500');
    await page.locator('.add-btn').tap();
    await page.locator('#help.message').waitFor();
    check(`lots of data: adding stays quick (${Date.now() - t}ms, under 1s)`, Date.now() - t < 1000, true);
    t = Date.now();
    await menu(page, 'Past Periods');
    const listed = await page.locator('.period-row').count();
    check(`lots of data: all 72 periods listed in under 1.5s (${Date.now() - t}ms)`, listed === 72 && Date.now() - t < 1500, true);
    await context.close();
  });

  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No console errors');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e.message); process.exit(1); });
