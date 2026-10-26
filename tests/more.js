// Second pass: edge cases and features the main pass doesn't cover (keypad limits, long-press grid,
// backdating, editing, CSV, restore, deleting periods, offline rates, upgrading old data).
// Each scenario starts a fresh app with just the data it needs, so a failure points at its own
// cause and a crash doesn't stop the scenarios after it.
const { chromium, webkit } = require('playwright');
const fs = require('fs');
const ENGINE = process.env.ENGINE || 'chromium';
const OUT = require('path').join(__dirname, 'output', process.env.ENGINE || 'chromium'); // screenshots and exported files, one folder per engine so runs can overlap (not committed)
const URL = 'http://localhost:8765/';
const { fakeShareSheet, grabFile, spentText, titleText, openSummary, openMenu, appReady, snapshotReasons, asInstalledApp, mockRates, startFirstPeriod, messageCleared, categoryRows, categoryDotColors, readPalette, check, scenarios } = require('./helpers');
const RATE = '{"amount":1,"base":"USD","date":"2026-10-20","rates":{"MXN":20}}';

(async () => {
  const browser = asInstalledApp(ENGINE === 'webkit' ? await webkit.launch() : await chromium.launch());
  const scenario = scenarios(browser);
  const errors = [];
  const newPage = async (context) => {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !m.text().includes('frankfurter') && errors.push(m.text()));
    return page;
  };

  // A fresh installed app with rates and the share sheet faked, on the main screen with a period
  // started (budget: the digits typed; null stays on First Budget). hits.rates counts downloads.
  // clock: run the page on Playwright's fake clock (timers, animation frames, performance.now), which
  // flows on its own until a test pauses it and steps it exactly.
  const launch = async (open, { budget = '150000', options = {}, clock = false } = {}) => {
    const context = await open({ acceptDownloads: true, ...options });
    const hits = { rates: 0 };
    await context.route('https://api.frankfurter.dev/**', (r) => { hits.rates++; r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: RATE }); });
    await fakeShareSheet(context);
    const page = await newPage(context);
    if (clock) await page.clock.install();
    await page.goto(URL);
    if (budget) await startFirstPeriod(page, budget);
    const mainKey = (k) => page.locator('#view-input .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
    const sheetKey = (k) => page.locator('#page .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
    const type = async (digits) => { for (const k of digits) await mainKey(k); };
    const hold = async (selector) => {
      await page.locator(selector).first().hover();
      await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
      await page.waitForTimeout(100);
    };
    return { context, page, hits, mainKey, sheetKey, type, hold };
  };
  // Chooses a category on the strip (tapping a chip centers it, which selects it).
  const pick = async (page, name) => {
    await page.locator('.strip .chip', { hasText: name }).tap();
    await page.waitForTimeout(700);
  };
  // Two expenses on a $1,500 budget, as the scenarios below expect: $42.50 yesterday in Health, and
  // MX$300 ($15.00) with a note, in pesoCategory. Returns yesterday's date label.
  const twoExpenses = async ({ page, type }, pesoCategory = 'Health') => {
    await pick(page, 'Health');
    const yesterday = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); });
    await page.locator('.date-btn input').fill(yesterday);
    await page.locator('.date-btn input').dispatchEvent('change');
    const label = await page.locator('.date-btn span').textContent();
    await type('4250');
    await page.locator('.add-btn').tap();
    if (pesoCategory !== 'Health') await pick(page, pesoCategory);
    await page.locator('.currency-opts').tap();
    await type('300');
    await page.locator('.note').fill('Tacos, "al pastor"');
    await page.locator('.add-btn').tap();
    await page.locator('.currency-opts').tap(); // back to dollars
    return label;
  };
  const animationOf = (page, selector) => page.evaluate((sel) => {
    const style = getComputedStyle(document.querySelector(sel));
    return `${style.animationName} ${style.animationDuration} ${style.animationTimingFunction}`;
  }, selector);
  // Presses replay what iOS sends: pointer events where the thumb goes, then (unless nativeClick is
  // false: iOS sends none once the thumb strays far) its own click on the button the press started
  // on, with a click count of 1, which the app must ignore.
  const press = (page, selector, text, path, nativeClick = true) => page.evaluate(([sel, txt, steps, nativeClick]) => {
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
  const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')));

  await scenario('first launch', async (open) => {
    const { page, hits, sheetKey } = await launch(open, { budget: null });
    // The first budget screen can't be dismissed by tapping outside it.
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
    check('rate fetched once on launch', hits.rates, 1);
    // Reopened the same day: no second rate download.
    await page.reload();
    await page.waitForTimeout(400);
    check('no refetch same day', hits.rates, 1);
  });

  await scenario('keypad', async (open) => {
    const { page, mainKey, type, hold } = await launch(open);
    // Leading 00 / 0 ignored, max 8 digits for USD, hold ⌫ clears
    await mainKey('00');
    await mainKey('0');
    check('leading zeros ignored', await page.locator('.amount').textContent(), '$0.00');
    await type('9999999999');
    check('USD capped at 8 digits', await page.locator('.amount').textContent(), '$999,999.99');
    await mainKey('⌫');
    check('backspace one', await page.locator('.amount').textContent(), '$99,999.99');
    await hold('#view-input .key:last-child');
    check('hold backspace clears', await page.locator('.amount').textContent(), '$0.00');

    // Fast typing: a press that drifts off its key as it lifts (iOS then sends no click for it)
    // mustn't swallow the next key's tap...
    const driftOff = (label) => page.evaluate((label) => {
      const key = [...document.querySelectorAll('#view-input .key')].find((k) => k.textContent === label);
      const box = key.getBoundingClientRect();
      const send = (type, y) => key.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: box.left + box.width / 2, clientY: y }));
      send('pointerdown', box.top + box.height / 2);
      send('pointerup', box.bottom + 40); // lifted just off the key: no click follows
    }, label);
    await driftOff('2');
    await mainKey('3');
    check('a quick tap right after a press that drifted off its key still counts', await page.locator('.amount').textContent(), '$0.03');
    await mainKey('⌫');
    // ...and the same key, pressed again right away: its new tap isn't taken for the old one's late click.
    await driftOff('2');
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
    await hold('#view-input .key:last-child');

    // MXN capped at 7 digits, switching trims
    await page.locator('.currency-opts').tap();
    await type('999999999');
    check('MXN capped at 7 digits', await page.locator('.amount').textContent(), 'MX$9,999,999');
    await page.locator('.currency-opts').tap();
    check('switch back keeps digits', await page.locator('.amount').textContent(), '$99,999.99');
    await hold('#view-input .key:last-child');

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

    // A message in HELP (like Added) shows without animating, labelled HELP again.
    await page.waitForSelector('#help:not(.message)');
    const amountBefore = await page.locator('.amount').textContent();
    await mainKey('4');
    await page.locator('.add-btn').tap();
    check('the HELP window doesn\'t animate when a message (like Added) shows', await animationOf(page, '#help'), 'none 0s ease');
    check('a message brings back the HELP label', await page.evaluate(() => getComputedStyle(document.getElementById('help'), '::before').content), '"Help"');
    await page.locator('#undo-btn').tap(); // take that expense back
    await page.waitForSelector('#help:not(.message)');
    // A press that slides off a key before lifting doesn't type; the next real tap does.
    await press(page, '#view-input .key', '7', [['pointerup', -150]]); // lift well above the key
    check('a press that slides off a key before lifting doesn\'t type', await page.locator('.amount').textContent(), amountBefore);
    await mainKey('7');
    check('the next real tap still types', (await page.locator('.amount').textContent()) !== amountBefore, true);
  });

  await scenario('currency row', async (open) => {
    // At launch the row is simply in place; it glides only when the currency changes.
    const { context, page } = await launch(open);
    const gliding = () => page.evaluate(() => document.querySelector('.currency-track').classList.contains('gliding'));
    // Watches the whole launch: did the row ever glide?
    await context.addInitScript(() => {
      window.glidedAtLaunch = false;
      new MutationObserver((changes) => {
        if (changes.some((c) => c.target.classList?.contains('currency-track') && c.target.classList.contains('gliding'))) window.glidedAtLaunch = true;
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    await page.reload();
    await appReady(page);
    await page.waitForTimeout(300);
    check('currency row: placed at launch, no glide in', await page.evaluate(() => window.glidedAtLaunch), false);
    await page.locator('.currency-opts').tap();
    check('currency row: glides when the currency changes', await gliding(), true);
    await page.evaluate(() => window.dispatchEvent(new Event('budget:change'))); // a redraw, same currency
    check('currency row: a redraw doesn\'t glide it', await gliding(), false);
  });

  // The party member, on the fake clock: time stands still between steps and moves exactly as far
  // as each step says, so its timing is checked to the frame, however busy the machine is.
  await scenario('party member', async (open) => {
    const { page, type } = await launch(open, { clock: true });
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    // Starting the first period assembles the whole party (checked in 'party assembles'); let them go.
    await page.clock.runFor(20000);
    // The member's pose ("state:frame") at every change, with the time it changed (ms since watch()).
    // Watched for changes rather than polled: on the fake clock every timer costs real time.
    await page.evaluate(() => {
      const m = document.querySelector('.party-member');
      let t0 = 0;
      const record = () => {
        const pose = `${m.dataset.state}:${m.style.getPropertyValue('--frame')}`;
        if (window.poses.at(-1)?.pose !== pose) window.poses.push({ pose, at: performance.now() - t0 });
      };
      new MutationObserver(record).observe(m, { attributes: true });
      window.watch = () => {
        t0 = performance.now();
        window.poses = [];
        record();
      };
      // Counts the animation frames it asks for.
      window.frames = 0;
      const ask = window.requestAnimationFrame;
      window.requestAnimationFrame = (callback) => { window.frames++; return ask.call(window, callback); };
    });
    const poses = () => page.evaluate(() => window.poses);
    const pose = () => page.locator('.party-member').evaluate((m) => `${m.dataset.state}:${m.style.getPropertyValue('--frame')}`);
    // 50ms at a time (every pose lasts at least 0.24s, so none is stepped over), up to 30s.
    const stepUntil = async (wanted) => {
      for (let i = 0; i < 600 && !wanted(await pose()); i++) await page.clock.runFor(50);
      return wanted(await pose());
    };
    const framesOver = async (ms) => {
      await page.evaluate(() => { window.frames = 0; });
      await page.clock.runFor(ms);
      return page.evaluate(() => window.frames);
    };

    // Wandering: 25s of it. It walks on FFRK's two frames only, always stops just after feet
    // together, and stands on feet together.
    const startedAt = await page.locator('.party-member').evaluate((m) => m.style.transform);
    await page.evaluate(() => window.watch());
    await page.clock.runFor(25000);
    const wandered = (await poses()).map((p) => p.pose);
    const stops = wandered.flatMap((p, i) => (p.startsWith('idle') && wandered[i - 1]?.startsWith('walk') ? [`${wandered[i - 1]}>${p}`] : []));
    check('party member wanders', await page.locator('.party-member').evaluate((m) => m.style.transform) !== startedAt, true);
    check('party member walks on its two frames', [...new Set(wandered.filter((p) => p.startsWith('walk')))].sort().join(','), 'walk:0,walk:1');
    check('party member settles before it stops, and stands with its feet together', `${stops.length > 0} ${[...new Set(stops)].join(',')}`, 'true walk:1>idle:1');

    // It only draws while walking: standing (a pause lasts at least 0.8s), and with another screen open.
    check('a walk', await stepUntil((p) => p.startsWith('walk')), true);
    check('then a pause', await stepUntil((p) => p.startsWith('idle')), true);
    check('party member standing: no frames drawn', await framesOver(700), 0);
    await page.clock.resume(); // the menu's own animations, at their own pace
    await openSummary(page);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500)); // the summary's animations finish
    check('another screen open: the party member draws no frames', await framesOver(1500), 0);
    await page.clock.resume();
    await page.locator('#nav-btn').tap();
    await page.waitForFunction(() => !document.body.classList.contains('page-open'));
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));

    // Adding an expense: FFRK's victory cheer from standing, stand and arm up alternating every 0.37s
    // three times, then the stance held 0.8s, then a rest.
    check('standing again', await stepUntil((p) => p.startsWith('idle')), true);
    await type('500');
    await page.evaluate(() => window.watch());
    await page.locator('.add-btn').tap();
    await page.clock.runFor(3200);
    const [standing, ...cheer] = await poses();
    check('party member cheers three times from standing: stand, arm up (x3), stand, then rests',
      [standing, ...cheer].map((p) => p.pose).join(' '), 'idle:1 cheer:1 cheer:2 cheer:1 cheer:2 cheer:1 cheer:2 cheer:1 idle:1');
    check('...each pose for 0.37s, the last stance 0.8s', cheer.slice(1).map((p, i) => Math.round((p.at - cheer[i].at) / 10) * 10).join(' '), '370 370 370 370 370 370 800');

    // Another expense mid-cheer starts it over: two arm-ups, then three more (five in all).
    await page.evaluate(async () => { window.watch(); (await import('./js/party.js')).celebrate(); });
    await page.clock.runFor(1600); // past the second arm-up, standing again
    await page.evaluate(async () => (await import('./js/party.js')).celebrate());
    await page.clock.runFor(3200);
    check('an expense mid-cheer starts it over: 2 + 3 arm-ups', (await poses()).filter((p) => p.pose === 'cheer:2').length, 5);

    // Caught mid-stride, it finishes that step (one 0.24s frame) and then cheers from standing.
    check('a stride', await stepUntil((p) => p === 'walk:0'), true);
    await page.evaluate(() => window.watch());
    const rightAfter = await page.evaluate(async () => {
      (await import('./js/party.js')).celebrate();
      const m = document.querySelector('.party-member');
      return `${m.dataset.state}:${m.style.getPropertyValue('--frame')}`;
    });
    await page.clock.runFor(1000);
    const midStride = await poses();
    const began = midStride.find((p) => p.pose.startsWith('cheer'));
    check('cheer caught mid-stride: the stride isn\'t cut short', rightAfter, 'walk:0');
    check('...then it cheers from standing, once the step is done', `${midStride[0].pose} ${began?.pose} ${began?.at <= 260}`, 'walk:0 cheer:1 true');
  });

  // A new period: all six line up in a random order facing left and cheer together, then all but the
  // third or fourth walk off, those left of it to the left and those right of it to the right.
  await scenario('party assembles', async (open) => {
    const { page } = await launch(open, { clock: true }); // starting the first period assembles them
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    const cast = () => page.evaluate(() => [...document.querySelectorAll('.party-member')]
      .map((m) => {
        const [, x, facing] = m.style.transform.match(/translate\(([-\d.]+)px(?:, 0px)?\) scaleX\(([-\d]+)\)/);
        return { name: m.dataset.member, state: m.dataset.state, frame: m.style.getPropertyValue('--frame'), x: Number(x), facing: Number(facing) };
      })
      .sort((a, b) => a.x - b.x));
    const lineUp = await cast();
    check('a new period: all six, each once, in a line', `${lineUp.length} ${new Set(lineUp.map((m) => m.name)).size}`, '6 6');
    check('...all facing left, cheering together', lineUp.map((m) => `${m.state}:${m.facing}`).join(' '), Array(6).fill('cheer:1').join(' '));
    // Count arm-ups across the cheer (FF8's three), on the clock.
    let ups = 0, before = '';
    for (let t = 0; t < 3100; t += 50) {
      const frames = (await cast()).map((m) => m.frame).join('');
      if (frames === '222222' && before !== '222222') ups++;
      before = frames;
      await page.clock.runFor(50);
    }
    check('...three arm-ups, all together', ups, 3);
    await page.clock.runFor(1000);
    const leaving = await cast();
    const stays = leaving.findIndex((m) => m.state !== 'walk');
    check('then one stays, the third or fourth, facing left', `${[2, 3].includes(stays)} ${leaving.filter((m) => m.state !== 'walk').length} ${leaving[stays].facing}`, 'true 1 1');
    check('those left of it walk off left, those right of it off right', leaving.map((m, i) => (i === stays ? 'stays' : `${m.state}:${m.facing}`)).join(' '),
      leaving.map((m, i) => (i < stays ? 'walk:1' : i > stays ? 'walk:-1' : 'stays')).join(' '));
    const stayer = leaving[stays].name;
    // Leaving, they vanish into the windows' ends: no walker's visible part is ever past them.
    let strays = 0;
    for (let t = 0; t < 12000; t += 250) {
      strays += await page.evaluate(() => {
        const area = document.querySelector('.details'), edge = area.clientWidth;
        return [...area.querySelectorAll('.party-member[data-state=walk]')].filter((m) => {
          const [, x, facing] = m.style.transform.match(/translate\(([-\d.]+)px(?:, 0px)?\) scaleX\(([-\d]+)\)/).map(Number);
          const hidden = parseFloat(m.style.clipPath.match(/inset\(0px 0px 0px ([\d.]+)px\)/)?.[1] ?? 0);
          const width = m.offsetWidth;
          if (hidden >= width - 0.5) return false; // wholly gone into the edge
          return facing === 1 ? x + hidden < -0.5 : x + width - hidden > edge + 0.5; // left walkers face left; right ones are mirrored
        }).length;
      });
      await page.clock.runFor(250);
    }
    check('leaving, they vanish into the windows\' ends, never past them', strays, 0);
    await page.clock.runFor(20000);
    const after = await cast();
    check('...and once they\'re off the screen, only the one who stayed is left', `${after.length} ${after[0].name}`, `1 ${stayer}`);
    // Opening another screen mid-scene ends it: back on the main screen there's just the one.
    await page.clock.resume();
    await openMenu(page, 'New Period');
    for (const k of '50000') await page.locator('#page .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
    await page.locator('#page .primary').tap();
    await page.waitForFunction(() => !document.body.classList.contains('page-open'));
    check('New Period assembles them too', (await cast()).length, 6);
    await openSummary(page);
    await page.locator('#nav-btn').tap();
    await page.waitForFunction(() => !document.body.classList.contains('page-open'));
    check('another screen mid-scene: back to one', (await cast()).length, 1);
  });

  await scenario('category strip taps', async (open) => {
    // Tapping a neighbouring chip selects it at once (the highlight and hand move on the tap) and the
    // strip glides it to the middle quickly, not at the browser's slower smooth-scroll pace.
    const { page } = await launch(open);
    const next = page.locator('.strip .chip.selected + .chip');
    const name = await next.textContent();
    await next.tap();
    check('strip tap: selected at once', await page.locator('.strip .chip.selected').textContent(), name);
    await page.waitForTimeout(300);
    check('strip tap: centred within 0.3s', await page.evaluate(() => {
      const strip = document.querySelector('.strip'), chip = strip.querySelector('.chip.selected');
      return Math.abs(chip.offsetLeft + chip.offsetWidth / 2 - (strip.scrollLeft + strip.clientWidth / 2)) <= 2;
    }), true);
  });

  await scenario('category grid', async (open) => {
    const { page } = await launch(open);
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
    await page.waitForTimeout(250); // let it finish arriving before measuring
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
    check('the grid swishes in from the left like Edit Expense', await animationOf(page, '#sheet'), 'swish-in-left 0.22s cubic-bezier(0.1, 0.8, 0.25, 1)');
    check('other categories are grey in the grid, white in the strip', await page.evaluate(() => [
      getComputedStyle(document.querySelector('#sheet .grid .chip:not(.selected)')).color,
      getComputedStyle(document.querySelector('.strip .chip:not(.selected)')).color].join(' | ')),
      'rgb(143, 143, 143) | rgb(237, 237, 237)');
    await page.screenshot({ path: `${OUT}/${ENGINE}-x1-grid.png` });
    await page.locator('#sheet .grid .chip', { hasText: 'Health' }).tap();
    await page.waitForTimeout(700);
    check('grid pick selects', await page.locator('.strip .chip.selected').textContent(), 'Health');
    check('grid closed', await page.locator('#sheet-backdrop.open').count(), 0);
  });

  await scenario('Reduce Motion', async (open) => {
    // Animations run even with the phone's Reduce Motion on (the user's choice for this app).
    const { page } = await launch(open, { budget: '100000', options: { reducedMotion: 'reduce' } });
    check('ADD hand bobs even with Reduce Motion on', await page.evaluate(() => getComputedStyle(document.querySelector('.add-btn'), '::after').animationName), 'hand-bob');
  });

  await scenario('date', async (open) => {
    const app = await launch(open);
    const { page } = app;
    // A tap on the "Today" text itself (not the hidden input) still opens the date picker
    await page.evaluate(() => {
      window.pickerOpened = 0;
      HTMLInputElement.prototype.showPicker = function () { window.pickerOpened += 1; };
    });
    await page.locator('.date-btn span').dispatchEvent('click');
    check('tapping the date text opens the picker', await page.evaluate(() => window.pickerOpened), 1);
    // Backdated expense: date label, then resets to Today after adding
    const label = await twoExpenses(app);
    check('date label shows backdate', label !== 'Today', true);
    check('date resets to Today', await page.locator('.date-btn span').textContent(), 'Today');
    check('spent after both', await spentText(page), '$57.88');
  });

  await scenario('summary: items, editing, deleting', async (open) => {
    const app = await launch(open);
    const { page, sheetKey } = app;
    const backdated = await twoExpenses(app);
    // Summary: backdated item shows its date; edit category; delete with undo
    await openSummary(page);
    await page.locator('.cat-head', { hasText: 'Health' }).tap();
    check('backdated item date', await page.locator('.item', { hasText: 'No note' }).locator('.when').textContent(), backdated);
    const tacos = page.locator('.item', { hasText: 'Tacos' });
    check('MXN item shown', await tacos.locator('.orig').textContent(), 'from MX$300');
    await tacos.tap();
    await page.waitForTimeout(300);
    check('edit sheet MXN hint', (await page.locator('#sheet .hint').textContent()).startsWith('Entered as MX$300 at 19.50 MXN per USD'), true);
    const funId = await page.locator('#sheet select option', { hasText: 'Fun' }).getAttribute('value');
    await page.locator('#sheet select').selectOption(funId);
    await page.locator('#sheet .primary').tap();
    await page.waitForTimeout(300);
    check('moved to Fun', await page.locator('.cat-head', { hasText: 'Fun' }).count(), 1);
    check('Health still open with 1 item', await page.locator('.items .item').count(), 1);
    await page.locator('.item').first().tap();
    await page.waitForTimeout(300);
    check('Edit Expense swishes in from the left', await animationOf(page, '#sheet'), 'swish-in-left 0.22s cubic-bezier(0.1, 0.8, 0.25, 1)');
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

    // Edit budget, then Back without saving: unchanged
    await page.locator('.edit-budget').tap();
    await page.waitForTimeout(300);
    await sheetKey('9');
    await page.locator('#nav-btn').tap();
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
  });

  await scenario('backup and CSV', async (open) => {
    const app = await launch(open);
    const { page } = app;
    await twoExpenses(app, 'Fun');
    // CSV export content
    await openMenu(page, 'Backup');
    const csvFile = await grabFile(page, ENGINE, () => page.locator('.wide-btn', { hasText: 'CSV' }).tap());
    check('CSV file name', /^bgt-j-\d{4}-\d{2}-\d{2}\.csv$/.test(csvFile.name), true);
    const csv = csvFile.text.split('\n');
    check('CSV header', csv[0], 'period_start,date,category,amount_usd,note,original_currency,original_amount,rate_per_usd');
    check('CSV rows', csv.length, 3);
    check('CSV peso row', csv.find((l) => l.includes('Tacos'))?.replace(/^"[^"]*","[^"]*",/, ''), '"Fun","15.38","Tacos, ""al pastor""","MXN","300","19.5"');
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
    // Dismissing the "Replace everything?" question leaves the data alone. (The file has a different
    // budget, so a restore that went ahead anyway would show.)
    const backup = JSON.parse(jsonFile.text);
    fs.writeFileSync(`${OUT}/x-backup-different.json`, JSON.stringify({ ...backup, periods: backup.periods.map((p, i, all) => (i === all.length - 1 ? { ...p, budgetCents: 999900 } : p)) }));
    page.once('dialog', (d) => d.dismiss());
    await page.locator('.page-body input[type=file]').setInputFiles(`${OUT}/x-backup-different.json`);
    await page.waitForTimeout(300);
    check('dismissed restore changes nothing', await spentText(page), '$57.88');
    // A backup with "input": null is rejected instead of crashing the app
    fs.writeFileSync(`${OUT}/null-input.json`, JSON.stringify({ ...backup, input: null }));
    await page.locator('.page-body input[type=file]').setInputFiles(`${OUT}/null-input.json`);
    await page.waitForTimeout(300);
    check('null input backup rejected', await page.locator('#help .text').first().textContent(), "That file isn't a budget backup.");
  });

  await scenario('new period and every screen', async (open) => {
    const { page, sheetKey } = await launch(open);
    // New Period sheet look; empty new period summary
    await openMenu(page, 'New Period');
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
      await openMenu(page, item);
      check(`no stray text: ${label}`, stray.test(await page.locator('#page-body').innerText()), false);
      await page.locator('#nav-btn').tap();
      await page.waitForTimeout(250);
    }
    check('no stray text: main screen', stray.test(await page.locator('#view-input').innerText()), false);
  });

  await scenario('removing the selected category', async (open) => {
    const { page } = await launch(open);
    // Archiving the selected category moves the selection to an active one (saved by the store)
    await pick(page, 'Housing');
    check('Housing selected', await page.locator('.strip .chip.selected').textContent(), 'Housing');
    await openMenu(page, 'Categories');
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
    await openMenu(page, 'Categories');
    check('Housing gone after saving', await page.locator('.cat-row input').evaluateAll((ns) => ns.findIndex((n) => n.value === 'Housing')), -1);
  });

  await scenario('menu presses', async (open) => {
    const { page } = await launch(open);
    await page.locator('#nav-btn').tap();
    await page.waitForSelector('#menu-backdrop.open');
    check('the menu\'s windows swish in from the right', await animationOf(page, '#menu .menu-list') + ' | ' + await animationOf(page, '#menu .menu-stats'),
      'swish-in-right 0.22s cubic-bezier(0.1, 0.8, 0.25, 1) | swish-in-right 0.22s cubic-bezier(0.1, 0.8, 0.25, 1)');
    const menuSettled = () => page.waitForFunction(() => !document.getAnimations().some((a) => a.animationName === 'swish-in-right' && a.playState === 'running'));
    const reopenMenu = async () => {
      await page.locator('#nav-btn').tap();
      await page.waitForSelector('#menu-backdrop.open');
      await menuSettled();
    };
    await menuSettled();
    const hovered = await press(page, '.menu-list button', 'Current Period', [['pointermove', 'Past Periods'], ['pointermove', 'Categories'], ['pointerup', 'Categories']]);
    check('menu: the hand follows the thumb between commands', hovered.join(' > '), 'Past Periods > Categories');
    await page.waitForFunction(() => document.getElementById('title').textContent === 'Categories' && !document.getElementById('page').hidden, null, { timeout: 2000 }).catch(() => {});
    check('menu: lifting opens the command under the thumb, not the one pressed first', await titleText(page), 'Categories');
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(300);
    await reopenMenu();
    await press(page, '.menu-list button', 'Current Period', [['pointermove', -400], ['pointerup', -400]]); // off the menu
    await page.waitForTimeout(300);
    check('menu: lifting off the commands opens nothing', await page.locator('#page').isHidden(), true);
    await press(page, '.menu-list button', 'Categories', [['pointermove', -400], ['pointermove', 'Categories'], ['pointerup', 'Categories']], false);
    await page.waitForFunction(() => !document.getElementById('page').hidden, null, { timeout: 2000 }).catch(() => {});
    check('menu: sliding off and back onto a command still opens it (iOS sends no click)', await titleText(page), 'Categories');
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(300);
    await reopenMenu();
    await press(page, '.menu-list button', 'Past Periods', [['pointermove', -400], ['pointermove', 'Past Periods'], ['pointerup', 'Past Periods']]);
    await page.waitForTimeout(400);
    await page.locator('#nav-btn').tap(); // back: if iOS's click went through too, a second Past Periods would be underneath
    await page.waitForTimeout(300);
    check('menu: ...and opens it once when iOS does click', await page.locator('#page').isHidden(), true);
    // Tapping the HELP window while the menu is open opens the summary and closes the menu.
    await page.waitForSelector('#help:not(.message)'); // the HELP window can't be tapped while it shows a message
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(250);
    await page.locator('#help').click({ position: { x: 20, y: 30 } });
    await page.waitForTimeout(300);
    check('help tap opens the summary', await titleText(page), 'Current Period');
    check('and closes the menu', await page.locator('#menu-backdrop.open').count(), 0);
  });

  await scenario('sideways', async (open) => {
    const { page } = await launch(open);
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
  });

  await scenario('launch screens', async (open) => {
    const { page } = await launch(open, { budget: null });
    // Every one exists and is exactly the size its media query says (iOS ignores one that doesn't
    // match the screen exactly, and shows its own launch screen instead).
    const launchScreens = await page.evaluate(() => Promise.all([...document.querySelectorAll('link[rel=apple-touch-startup-image]')].map((link) => new Promise((resolve) => {
      const [, w, h, dpr] = link.media.match(/device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d+)/).map(Number);
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth === w * dpr && img.naturalHeight === h * dpr);
      img.onerror = () => resolve(false);
      img.src = link.href;
    }))));
    check(`launch screens: ${launchScreens.length}, all present at the right size`, launchScreens.length >= 10 && launchScreens.every(Boolean), true);
  });

  await scenario('messages and leaving the app', async (open) => {
    // A message and its Undo end when the app goes to the background, rather than greeting you
    // (with a stale Undo beside Menu) when you come back hours later.
    const { page, type } = await launch(open);
    await type('500');
    await page.locator('.add-btn').tap();
    check('adding: a message with Undo', `${await page.locator('#help .text').first().textContent()} ${await page.locator('#undo-btn').isVisible()}`, 'Added $5.00 · Groceries true');
    const setHidden = (hidden) => page.evaluate((hidden) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await setHidden(true);
    await setHidden(false);
    check('back from the background: the message and Undo are gone, the status row is back', `${await page.locator('#undo-btn').isVisible()} ${await page.locator('#help').getAttribute('data-label')}`, 'false Status');
  });

  await scenario('HELP and the status row', async (open) => {
    const app = await launch(open);
    const { page } = app;
    await twoExpenses(app);
    // On the main screen, HELP is a status row instead, after FF8's party windows: the period's
    // number as Lv, what's left as HP, and a thin bar under it filled to the share left.
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
    const results = [];
    for (const screen of ['Current Period', 'Past Periods', 'Categories', 'New Period', 'Backup']) {
      await openMenu(page, screen);
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
  });

  await scenario('arriving at screens', async (open) => {
    const { page } = await launch(open);
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
    await openMenu(page, 'New Period');
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
  });

  await scenario('deleting periods', async (open) => {
    const app = await launch(open);
    const { page, sheetKey } = app;
    await twoExpenses(app);
    await openMenu(page, 'New Period');
    for (const k of ['1', '00', '00']) await sheetKey(k);
    await page.locator('#page .primary').tap();
    await page.waitForTimeout(300);
    // Period 1 with expenses, and the current one, empty.
    const expenseCount = (await saved(page)).expenses.length;
    await openMenu(page, 'Past Periods');
    await page.locator('.period-row').nth(1).tap(); // oldest is listed last
    await page.waitForTimeout(300);
    page.once('dialog', (d) => d.accept());
    await page.locator('.delete-btn').tap();
    await page.waitForTimeout(300);
    check('past period deleted', await page.locator('.period-row').count(), 1);
    check('delete message', await page.locator('#help .text').first().textContent(), 'Period 1 deleted');
    check('its expenses deleted too', (await saved(page)).expenses.length, 0);
    await page.locator('#undo-btn').tap();
    await page.waitForTimeout(300);
    check('undo restores the period', await page.locator('.period-row').count(), 2);
    check('undo restores its expenses', (await saved(page)).expenses.length, expenseCount);
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(250);
    const spentBefore = await spentText(page);
    await openMenu(page, 'Current Period');
    page.once('dialog', (d) => d.accept());
    await page.locator('.delete-btn').tap();
    await page.waitForTimeout(300);
    check('deleting the current period returns to the main screen', await page.locator('#page').isHidden(), true);
    check('previous period reopened', await spentText(page), '$57.88');
    check('reopened period is current', (await saved(page)).periods.map((p) => p.end).join(','), '');
    await page.locator('#undo-btn').tap();
    await page.waitForTimeout(300);
    check('undo makes the newer period current again', await spentText(page), spentBefore);
    check('and closes the reopened one again', (await saved(page)).periods.filter((p) => !p.end).length, 1);
  });

  await scenario('offline on first launch', async (open) => {
    // Falls back to the estimate and says so.
    const context = await open();
    await context.route('https://api.frankfurter.dev/**', (r) => r.abort());
    const page = await newPage(context);
    await page.goto(URL);
    await page.waitForTimeout(300);
    await startFirstPeriod(page, '100000');
    await page.locator('.currency-opts').tap();
    for (const k of '185') await page.locator('#view-input .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
    check('offline estimate line', (await page.locator('.amount-sub span').allTextContents()).join(' | '), '≈ $10.00 | ~18.5 MXN per USD (estimate: no rates downloaded yet)');
  });

  await scenario('safety snapshots', async (open) => {
    // One a day, one before anything drastic, and going back works (and is undoable).
    const { page } = await launch(open, { budget: null });
    const snaps = () => snapshotReasons(page);
    const expensesNow = async () => (await saved(page)).expenses.length;
    await page.waitForTimeout(300);
    check('snapshots: one taken on first launch', (await snaps()).join('|'), 'start of the day');
    await startFirstPeriod(page, '100000');
    for (const k of '500') await page.locator('#view-input .key').filter({ hasText: new RegExp(`^${k}$`) }).first().tap();
    await page.locator('.add-btn').tap();
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForTimeout(300);
    check('snapshots: still one a day after reopening', (await snaps()).length, 1);
    await page.waitForSelector('#help:not(.message)', { timeout: 6000 });
    await openMenu(page, 'Current Period');
    page.once('dialog', (d) => d.accept());
    await page.locator('.delete-btn').tap(); // the only period: back to First Budget
    await page.waitForTimeout(300);
    check('snapshots: taken before deleting a period', (await snaps())[0], 'before deleting Current Period');
    check('the expense is gone', await expensesNow(), 0);
    await startFirstPeriod(page, '100000');
    await openMenu(page, 'Backup');
    check('snapshots: listed on the Backup screen', await page.locator('.snapshot-row').count(), 2);
    check('snapshots: lines only between rows, the note 10px below the list', await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.snapshot-row')];
      return [rows.map((r) => getComputedStyle(r).borderTopWidth).join(','), getComputedStyle(rows.at(-1)).borderBottomWidth, getComputedStyle(document.querySelector('.snapshot-list + .hint')).marginTop].join(' ');
    }), '0px,1px 0px 10px');
    page.once('dialog', (d) => d.accept());
    await page.locator('.snapshot-row', { hasText: 'before deleting' }).locator('.link').tap();
    await page.waitForTimeout(300);
    check('going back restores the deleted expense', await expensesNow(), 1);
    check('going back snapshots the current data first', (await snaps())[0], 'before going back to a snapshot');
    // The first launch's snapshot is from before the first budget: going back to it means no
    // period, so First Budget (Add used to crash with no period to add to).
    page.once('dialog', (d) => d.accept());
    await page.locator('.snapshot-row', { hasText: 'start of the day' }).locator('.link').tap();
    await page.waitForTimeout(300);
    check('going back to before the first budget: First Budget', await titleText(page), 'First Budget');
    check('all kept while under seven', (await snaps()).length, 4);
    // The list holds only times and reasons; the copies are kept apart, read only to go back to one.
    check('listed snapshots carry no copy of the data', await page.evaluate(() => new Promise((resolve) => {
      const request = indexedDB.open('budget-tracker');
      request.onsuccess = () => {
        const all = request.result.transaction('snapshots').objectStore('snapshots').getAll();
        all.onsuccess = () => resolve(all.result.every((s) => !('data' in s)));
      };
    })), true);
  });

  await scenario('snapshots saved by the previous version', async (open) => {
    // Version 1 of the snapshot store kept each copy with its time and reason: they're split on the
    // first launch of this version, and going back to one still works.
    const context = await open();
    await context.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const data = { version: 3, categories: [{ id: 'c1', name: 'Old', color: null, archived: false }], periods: [{ id: 'p1', budgetCents: 5000, start: '2026-01-01', end: null }], expenses: [], rates: { perUsd: {}, date: null, checkedAt: 0 }, input: { currency: 'USD', categoryId: 'c1' }, lastBackupAt: null, settings: { backupReminderDays: 30 } };
      localStorage.setItem('budget-tracker', JSON.stringify(data));
      const request = indexedDB.open('budget-tracker', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'at' }).put({ at: Date.now() - 1000, reason: 'before deleting Period 2', data: JSON.stringify(data) });
    });
    await context.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: RATE }));
    const page = await newPage(context);
    await page.goto(URL);
    await page.waitForTimeout(300);
    await page.reload(); // the seeding above runs before the app's first open; now the app upgrades it
    await appReady(page);
    await openMenu(page, 'Backup');
    await page.waitForSelector('.snapshot-row');
    page.once('dialog', (d) => d.accept());
    await page.locator('.snapshot-row', { hasText: 'before deleting Period 2' }).locator('.link').tap();
    await page.waitForTimeout(300);
    check('an old-style snapshot, after the upgrade: going back to it works', (await page.locator('#help .text').first().textContent()).startsWith('Back to'), true);
  });

  await scenario('more snapshots than kept, from an older version', async (open) => {
    // Nine, more than kept (as when the limit was lowered), today's daily one the oldest: the first
    // launch keeps the newest seven straight away, without waiting for a new one.
    const context = await open();
    await context.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const data = { version: 3, categories: [{ id: 'c1', name: 'Food', color: null, archived: false }], periods: [{ id: 'p1', budgetCents: 5000, start: '2026-01-01', end: null }], expenses: [], rates: { perUsd: {}, date: null, checkedAt: 0 }, input: { currency: 'USD', categoryId: 'c1' }, lastBackupAt: null, settings: { backupReminderDays: 30 } };
      localStorage.setItem('budget-tracker', JSON.stringify(data));
      const now = Date.now(), text = JSON.stringify(data);
      const request = indexedDB.open('budget-tracker', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('snapshots', { keyPath: 'at' });
        store.put({ at: now - 60000, reason: 'start of the day', data: text });
        for (let i = 1; i <= 8; i++) store.put({ at: now - 60000 + i * 1000, reason: `before deleting Period ${i}`, data: text });
      };
      request.onsuccess = () => request.result.close();
    });
    await context.route('https://api.frankfurter.dev/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: RATE }));
    const page = await newPage(context);
    await page.goto(URL);
    await appReady(page);
    await page.waitForTimeout(500);
    check('trimmed to the newest seven on launch', (await snapshotReasons(page)).join(' | '), [8, 7, 6, 5, 4, 3, 2].map((i) => `before deleting Period ${i}`).join(' | '));
  });

  await scenario('the Backup screen\'s snapshot list stays current', async (open) => {
    const { page } = await launch(open);
    await page.waitForTimeout(300);
    await openMenu(page, 'Backup');
    await page.waitForSelector('.snapshot-row');
    // A snapshot gone since the list was read (dropped as the oldest, say): Go back says so.
    await page.evaluate(() => new Promise((resolve) => {
      const request = indexedDB.open('budget-tracker');
      request.onsuccess = () => {
        const transaction = request.result.transaction(['snapshots', 'snapshot-data'], 'readwrite');
        transaction.objectStore('snapshots').clear();
        transaction.objectStore('snapshot-data').clear();
        transaction.oncomplete = resolve;
      };
    }));
    page.once('dialog', (d) => d.accept());
    await page.locator('.snapshot-row .link').first().tap();
    await page.waitForTimeout(300);
    check('going back to a snapshot that\'s gone: says so', await page.locator('#help .text').first().textContent(), 'That snapshot is no longer there.');
    check('...and the list catches up', await page.locator('.snapshot-row').count(), 0);
    // Coming back to the app on a new day takes that day's snapshot: the open list shows it.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(500);
    check('back in the app, a new day\'s snapshot: listed on the open Backup screen', await page.locator('.snapshot-row').count(), 1);
  });

  await scenario('daily snapshot on resume', async (open) => {
    // iOS mostly resumes the app rather than relaunching it: coming back on a new day takes that
    // day's snapshot too.
    const { page } = await launch(open);
    await page.waitForTimeout(300);
    await page.evaluate(() => new Promise((resolve) => { // make today's snapshot yesterday's
      const request = indexedDB.open('budget-tracker');
      request.onsuccess = () => {
        const transaction = request.result.transaction(['snapshots', 'snapshot-data'], 'readwrite');
        for (const name of ['snapshots', 'snapshot-data']) {
          const store = transaction.objectStore(name);
          const all = store.getAll();
          all.onsuccess = () => { for (const s of all.result) { store.delete(s.at); store.put({ ...s, at: s.at - 86400000 }); } };
        }
        transaction.oncomplete = resolve;
      };
    }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    check('back from the background on a new day: that day\'s snapshot', (await snapshotReasons(page)).filter((r) => r === 'start of the day').length, 2);
  });

  await scenario('fields keep working after touching around them', async (open) => {
    // A touch that lands on a window's edge or between windows (not on a control) used to leave a
    // listener on that element that cancelled the end of every later touch inside it, so fields
    // there stopped taking focus until the app was restarted (buttons still worked).
    const { page, type } = await launch(open);
    const tapAt = async (box, dx, dy) => { await page.touchscreen.tap(box.x + dx, box.y + dy); await page.waitForTimeout(150); };
    const focuses = async (field) => {
      const box = await field.boundingBox();
      await tapAt(box, 20, box.height / 2);
      const focused = await field.evaluate((f) => document.activeElement === f);
      await page.evaluate(() => document.activeElement?.blur());
      return focused;
    };
    await type('500');
    await page.locator('.add-btn').tap();
    await openSummary(page);
    await page.locator('.cat-head').first().tap();
    await page.locator('.item').first().tap();
    await page.waitForTimeout(400);
    const note = page.locator('#sheet input[type=text]').last();
    const sheet = await page.locator('#sheet').boundingBox();
    await tapAt(sheet, 6, sheet.height / 2); // the sheet's own edge
    await tapAt(sheet, 6, sheet.height / 2);
    check('Edit Expense: after touching the sheet\'s edge, Note still takes focus', await focuses(note), true);
    await page.locator('#sheet-backdrop').evaluate((b) => b.classList.remove('open'));
    await page.locator('#nav-btn').tap();
    await openMenu(page, 'Categories');
    const body = await page.locator('#page-body').boundingBox();
    await tapAt(body, 2, 4); // between the screen's edge and its first window
    check('Categories: after touching between windows, a name still takes focus', await focuses(page.locator('.cat-row input').first()), true);
  });

  await scenario('main screen: work in proportion to the change', async (open) => {
    const { page, type } = await launch(open);
    // A currency or category choice is saved on its own, not by rewriting the whole history, and
    // still comes back after a reload.
    const before = await page.evaluate(() => localStorage.getItem('budget-tracker'));
    await page.locator('.currency-opts').tap();
    check('a currency choice leaves the saved history untouched', await page.evaluate((b) => localStorage.getItem('budget-tracker') === b, before), true);
    await page.reload();
    await appReady(page);
    check('...and is still the choice after a reload', await page.locator('.currency-track .on').textContent(), 'MXN');
    // A keypad digit redraws the amount, not the whole main screen (whose currency row measures
    // the layout to center itself).
    await page.evaluate(() => {
      window.layoutReads = 0;
      const read = window.getComputedStyle;
      window.getComputedStyle = (...args) => { window.layoutReads++; return read(...args); };
    });
    await type('5');
    check('a digit: the amount shows it', await page.locator('.amount').textContent(), 'MX$5');
    check('...without redrawing the rest of the screen', await page.evaluate(() => window.layoutReads), 0);
  });

  await scenario('ring: the largest fires first; the small ones never blur together', async (open) => {
    const { page } = await launch(open);
    // Nine categories, a long tail of small amounts.
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('budget-tracker'));
      const period = data.periods[0].id;
      data.expenses = data.categories.map((c, i) => ({ id: `e${i}`, periodId: period, categoryId: c.id, usdCents: [60000, 20000, 8000, 3000, 1500, 800, 400, 200, 100][i], date: data.periods[0].start, note: '', original: null, createdAt: i }));
      localStorage.setItem('budget-tracker', JSON.stringify(data));
    });
    await page.reload();
    await appReady(page);
    await openSummary(page);
    const waves = await page.evaluate(() => [...document.querySelectorAll('.ring-chart .wave')].map((w) => ({
      len: parseFloat(w.style.getPropertyValue('--len')), delay: parseFloat(w.style.getPropertyValue('--delay')),
    })));
    const firing = [...waves].sort((a, b) => a.delay - b.delay);
    check('the first to fire is the largest, the last the smallest', `${firing[0].len === Math.max(...waves.map((w) => w.len))} ${firing.at(-1).len === Math.min(...waves.map((w) => w.len))}`, 'true true');
    check('no two fire under 0.05s apart', firing.slice(1).every((w, i) => w.delay - firing[i].delay >= 0.0495), true);
  });

  await scenario('summary: opening a category redraws only its row', async (open) => {
    const { page, type } = await launch(open);
    await type('500');
    await page.locator('.add-btn').tap();
    await openSummary(page);
    await page.evaluate(() => { window.ring = document.querySelector('.ring-chart'); });
    await page.locator('.cat-head').first().tap();
    check('opened: its expenses show', `${await page.locator('.cat-list li.open .item').count()} ${await page.locator('.cat-head').first().getAttribute('aria-expanded')}`, '1 true');
    check('...and the ring wasn\'t rebuilt (it would replay)', await page.evaluate(() => window.ring.isConnected), true);
    await page.locator('.cat-head').first().tap();
    check('closed again', `${await page.locator('.cat-list .item').count()} ${await page.locator('.cat-head').first().getAttribute('aria-expanded')}`, '0 false');
  });

  await scenario('undo after deleting the only period', async (open) => {
    const { page } = await launch(open);
    await openMenu(page, 'Current Period');
    page.once('dialog', (d) => d.accept());
    await page.locator('.delete-btn').tap();
    await page.waitForTimeout(300);
    check('the only period deleted: First Budget', await titleText(page), 'First Budget');
    await page.locator('#undo-btn').tap();
    await page.waitForTimeout(300);
    check('Undo: the period is back, and so is the main screen (not First Budget over it)', `${(await saved(page)).periods.length} ${await page.locator('#page').isHidden()}`, '1 true');
  });

  await scenario('backup reminder', async (open) => {
    // Adjustable on the Backup screen, and the nudge follows it.
    const { page } = await launch(open, { budget: '100000' });
    await page.evaluate(() => { // backed up 10 days ago
      const s = JSON.parse(localStorage.getItem('budget-tracker'));
      s.lastBackupAt = Date.now() - 10 * 86400000;
      localStorage.setItem('budget-tracker', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForTimeout(400);
    check('reminder: 10 days ago is fine with the default 30', await page.locator('#nav-btn.alert').count(), 0);
    await openMenu(page, 'Backup');
    check('reminder: 30 is selected by default', await page.locator('.reminder .options .on').textContent(), '30');
    await page.locator('.reminder .options button', { hasText: /^7$/ }).tap();
    await page.waitForTimeout(300);
    check('reminder: choosing 7 is saved', (await saved(page)).settings.backupReminderDays, 7);
    check('reminder: and shown as selected', await page.locator('.reminder .options .on').textContent(), '7');
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(300);
    check('reminder: now 10 days ago gets the nudge', await page.locator('#nav-btn.alert').count(), 1);
  });

  await scenario('Safari tab', async (open) => {
    // In a Safari tab (not installed), the HELP window explains how to install.
    const context = await open();
    await mockRates(context, RATE);
    await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: false })); // a Safari tab, not installed
    const page = await newPage(context);
    await page.goto(URL);
    await startFirstPeriod(page, '100000');
    await page.waitForSelector('#help:not(.message)', { timeout: 6000 });
    check('Safari tab: HELP shows how to install', await page.locator('#help .text').textContent(), 'Install: Share → Add to Home Screen');
    let explained = '';
    page.once('dialog', (d) => { explained = d.message(); d.accept(); });
    await page.locator('#help').click({ position: { x: 20, y: 30 } });
    await page.waitForTimeout(300);
    check('Safari tab: tapping it explains the separate data', explained.includes('Data entered in a Safari tab stays separate'), true);
  });

  await scenario('desktop date button', async () => {
    // In a desktop browser, a mouse click on the middle of the date button opens the picker (by
    // itself the hidden date field would only select its day or month there).
    const desktop = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    try {
      await mockRates(desktop, RATE);
      const page = await newPage(desktop);
      await page.goto(URL);
      await page.locator('#page .key').filter({ hasText: /^1$/ }).first().click();
      await page.locator('#page .primary').click();
      await page.waitForSelector('.date-btn');
      await page.evaluate(() => {
        window.pickerOpened = 0;
        HTMLInputElement.prototype.showPicker = function () { window.pickerOpened += 1; };
      });
      await page.locator('.date-btn').click();
      check('desktop: clicking the middle of the date button opens the picker', await page.evaluate(() => window.pickerOpened), 1);
    } finally {
      await desktop.close();
    }
  });

  // The Categories screen edits a draft: helpers for the scenarios below.
  const categoriesScreen = async (open) => {
    const { page } = await launch(open, { budget: '100000' });
    await openMenu(page, 'Categories');
    return {
      page,
      save: page.locator('#page .actions .primary', { hasText: 'Save' }),
      nameField: (n) => page.locator('.cat-row input').nth(n),
      savedNames: () => page.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')).categories.filter((c) => !c.archived).map((c) => c.name).sort().join(',')),
    };
  };

  await scenario('categories: clashing names and layout', async (open) => {
    const { page, save, nameField, savedNames } = await categoriesScreen(open);
    const before = await savedNames();
    check('Save is in view above the bottom bar without scrolling', await page.evaluate(() => {
      const button = document.querySelector('#page .actions .primary').getBoundingClientRect();
      return button.top >= 0 && button.bottom <= document.querySelector('.dock').getBoundingClientRect().top;
    }), true);
    check('Save is fixed, so scrolling or bouncing the list can\'t carry it', await page.evaluate(() => getComputedStyle(document.querySelector('#page .actions')).position), 'fixed');
    check('scrolled to the end, the whole list clears Save', await page.evaluate(() => {
      const screen = document.getElementById('page');
      screen.scrollTop = screen.scrollHeight;
      const lastWindow = [...document.querySelectorAll('#page-body > :not(.actions)')].at(-1).getBoundingClientRect();
      const result = lastWindow.bottom <= document.querySelector('#page .actions').getBoundingClientRect().top;
      screen.scrollTop = 0;
      return result;
    }), true);
    // Names can't clash (ignoring capitalization); nothing is saved until Save.
    const funIndex = (await categoryRows(page)).indexOf('Fun');
    await nameField(funIndex).fill('groceries');
    await save.tap();
    await page.waitForTimeout(200);
    check('saving a clashing name is refused', await page.locator('#help .text').first().textContent(), "There's already a category called Groceries.");
    check('and nothing is saved', await savedNames(), before);
    await nameField(funIndex).fill('Fun');
    check('Save turns off again when the draft matches what\'s saved', await save.isDisabled(), true);
  });

  await scenario('categories: adding, removing, leaving unsaved', async (open) => {
    const { page, save, nameField, savedNames } = await categoriesScreen(open);
    const before = await savedNames();
    const slot = (n) => page.locator('.cat-row.slot input').nth(n);
    // Typing in an empty slot adds a category; typed and cleared again, it's just an empty slot.
    await slot(0).fill('x');
    check('typing in an empty slot: Save on', await save.isDisabled(), false);
    await slot(0).fill('');
    check('cleared again: Save off, its gem an empty socket again', `${await save.isDisabled()} ${await page.locator('.cat-row.slot .dot.empty').count()}`, 'true 7');
    for (const [n, name] of [[0, 'Snacks'], [1, 'Pets']]) {
      await slot(n).tap();
      await page.keyboard.type(name);
      await page.keyboard.press('Enter');
    }
    const rows = await categoryRows(page);
    check('typed new ones stay, after the others until saved', rows.slice(-2).join(','), 'Snacks,Pets');
    check('colors follow the list in GF order, empty slots without', (await categoryDotColors(page)).join(','), readPalette().map((c) => c.hex).slice(0, rows.length).join(','));
    const otherRow = rows.indexOf('Other');
    await page.locator('.cat-row').nth(otherRow).locator('.mini').tap();
    check('removing one', await page.locator('#help .text').first().textContent(), 'Other removed');
    check('its slot comes free at the bottom, the typed names kept', `${await page.locator('.cat-row.slot').count()} ${(await categoryRows(page)).slice(-2).join(',')}`, '6 Snacks,Pets');
    await page.locator('#undo-btn').tap();
    check('Undo brings it back', (await categoryRows(page)).includes('Other'), true);
    // Back with unsaved changes: Cancel stays, OK leaves without saving.
    page.once('dialog', (d) => d.dismiss());
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(200);
    check('Back with unsaved changes: Cancel stays', await titleText(page), 'Categories');
    page.once('dialog', (d) => d.accept());
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(300);
    check('Back with unsaved changes: OK leaves', await page.locator('#page').isHidden(), true);
    check('and the changes are discarded', await savedNames(), before);
  });

  await scenario('categories: all 16 in use', async (open) => {
    const { page, nameField, savedNames } = await (async () => {
      const { page } = await launch(open, { budget: '100000' });
      // Fifteen active categories and an archived one.
      await page.evaluate(() => {
        const data = JSON.parse(localStorage.getItem('budget-tracker'));
        const names = 'Bills,Books,Coffee,Dining,Fun,Gifts,Groceries,Health,Housing,Kids,Other,Pets,Shopping,Sports,Transport'.split(',');
        data.categories = [...names.map((name, i) => ({ id: `c${i}`, name, color: null, archived: false })), { id: 'old', name: 'Games', color: null, archived: true }];
        data.input.categoryId = 'c0';
        localStorage.setItem('budget-tracker', JSON.stringify(data));
      });
      await page.reload();
      await appReady(page);
      await openMenu(page, 'Categories');
      return { page, nameField: (n) => page.locator('.cat-row input').nth(n), savedNames: () => page.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')).categories.filter((c) => !c.archived).length) };
    })();
    const restore = page.locator('.cat-row button', { hasText: 'Restore' });
    const hint = page.locator('#page .hint');
    check('15 named, one free slot: Restore on', `${await page.locator('.cat-row.slot').count()} ${await restore.isDisabled()} ${await hint.isVisible()}`, '1 false false');
    // Naming the last free slot fills it: Restore turns off as you type, not only when the screen
    // is next drawn (or restoring would make 17).
    await page.locator('.cat-row.slot input').fill('Travel');
    check('typing in the last slot: Restore off, and says why', `${await restore.isDisabled()} ${await hint.textContent()}`, 'true All 16 slots are in use: remove one to restore a category.');
    await page.locator('.cat-row.slot input').fill('');
    check('cleared again: Restore back on', `${await restore.isDisabled()} ${await hint.isVisible()}`, 'false false');
    await page.locator('.cat-row.slot input').fill('Travel');
    await page.locator('#page .actions .primary').tap();
    await page.waitForTimeout(300);
    check('all 16 saved: no empty slots, Restore off', `${await savedNames()} ${await page.locator('.cat-row.slot').count()} ${await restore.isDisabled()}`, '16 0 true');
    await page.locator('.cat-row').first().locator('.mini').tap(); // Bills
    check('removing one frees a slot for it', await restore.isDisabled(), false);
    await restore.tap();
    check('restored into the free slot', `${(await categoryRows(page)).at(-1)} ${await page.locator('.cat-row.slot').count()}`, 'Games 0');
  });

  await scenario('categories: a refused save, redraws, typing', async (open) => {
    const { page, save, nameField, savedNames } = await categoriesScreen(open);
    const slot = page.locator('.cat-row.slot input').first();
    // A refused save leaves every row as it was: what's typed afterwards still counts.
    await slot.fill('x');
    await slot.fill('');
    const funIndex = (await categoryRows(page)).indexOf('Fun');
    await nameField(funIndex).fill('groceries');
    await save.tap();
    check('a clashing name: refused', await page.locator('#help .text').first().textContent(), "There's already a category called Groceries.");
    await nameField(funIndex).fill('Fun');
    await slot.fill('Gas');
    await save.tap();
    await page.waitForTimeout(300);
    check('after a refused save, a slot typed in again is saved', (await savedNames()).split(',').includes('Gas'), true);
    // Something saved elsewhere (the day's rate arriving, say) doesn't rebuild the screen under a
    // field being typed in.
    const next = page.locator('.cat-row.slot input').first();
    await next.tap();
    await page.keyboard.type('Ta');
    await page.evaluate(() => window.dispatchEvent(new Event('budget:change')));
    await page.keyboard.type('xi');
    check('a redraw for something else: still typing in the same field', await page.evaluate(() => `${document.activeElement.closest('.cat-row.slot') !== null} ${document.activeElement.value}`), 'true Taxi');
    // Typing in a named row doesn't repaint the gems (only a row gaining or losing a name does).
    await page.evaluate(() => { window.gems = [...document.querySelectorAll('.cat-row .dot')]; });
    await nameField(0).press('End');
    await page.keyboard.type('s');
    check('typing in a named row leaves every gem as it was', await page.evaluate(() => window.gems.every((g) => g.isConnected)), true);
  });

  await scenario('categories: messages about the draft end when you leave', async (open) => {
    const { page, save } = await categoriesScreen(open);
    const otherRow = (await categoryRows(page)).indexOf('Other');
    await page.locator('.cat-row').nth(otherRow).locator('.mini').tap();
    check('removing one: a message with Undo', `${await page.locator('#help .text').first().textContent()} ${await page.locator('#undo-btn').isVisible()}`, 'Other removed true');
    page.once('dialog', (d) => d.accept()); // discard the unsaved change
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(300);
    check('left without saving: the message and its Undo are gone (nothing was removed)', `${await page.locator('#undo-btn').isVisible()} ${await page.locator('#help').getAttribute('data-label')}`, 'false Status');
    // A saved change is different: its Undo still applies after leaving.
    await openMenu(page, 'Categories');
    await page.locator('.cat-row').nth(otherRow).locator('.mini').tap();
    await save.tap();
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(300);
    check('saved, then left: "Categories saved" keeps its Undo', `${await page.locator('#help .text').first().textContent()} ${await page.locator('#undo-btn').isVisible()}`, 'Categories saved true');
  });

  await scenario('categories: undo a save while still on the screen', async (open) => {
    const { page, save, savedNames } = await categoriesScreen(open);
    const before = await savedNames();
    const funRow = (await categoryRows(page)).indexOf('Fun');
    await page.locator('.cat-row').nth(funRow).locator('.mini').tap();
    await save.tap();
    await page.waitForTimeout(300);
    await page.locator('#undo-btn').tap();
    await page.waitForTimeout(300);
    check('Undo of a save, still on the screen: saved categories are back', await savedNames(), before);
    check('...and the screen shows them, with nothing unsaved', `${(await categoryRows(page)).includes('Fun')} ${await save.isDisabled()}`, 'true true');
  });

  await scenario('categories: undo reverses just that removal', async (open) => {
    const { page, nameField } = await categoriesScreen(open);
    const rows = await categoryRows(page);
    await page.locator('.cat-row').nth(rows.indexOf('Other')).locator('.mini').tap();
    const funIndex = (await categoryRows(page)).indexOf('Fun');
    await nameField(funIndex).fill('Games'); // typed while "Other removed" still offers Undo
    await page.locator('#undo-btn').tap();
    const after = await categoryRows(page);
    check('Undo puts Other back, and keeps the rename typed since', `${after.includes('Other')} ${after.includes('Games')} ${after.includes('Fun')}`, 'true true false');
  });

  await scenario('categories: saving with blanks', async (open) => {
    const { page, save, nameField, savedNames } = await categoriesScreen(open);
    // An existing category cleared is removed, and tapping Save while an empty slot still has the
    // keyboard up still saves the rest.
    const names = await categoryRows(page);
    await nameField(names.indexOf('Shopping')).fill('Stuff');
    await nameField(names.indexOf('Health')).fill('');
    await page.locator('.cat-row.slot input').first().tap(); // an empty slot, focused
    await save.tap();
    await page.waitForTimeout(300);
    const afterSave = (await savedNames()).split(',');
    check('Save with blanks: the rename is saved', afterSave.includes('Stuff') && !afterSave.includes('Shopping'), true);
    check('Save with blanks: a category whose name was cleared is removed', afterSave.includes('Health'), false);
    check('Save with blanks: nothing blank saved', `${afterSave.length} ${afterSave.some((n) => !n.trim())}`, `${names.length - 1} false`);
  });

  await scenario('categories: spaces around names', async (open) => {
    const { page, save, nameField, savedNames } = await categoriesScreen(open);
    // Category names never keep spaces at either end: not from old saved data, not from typing.
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('budget-tracker'));
      data.categories.find((c) => c.name === 'Bills').name = '  Bills   ';
      localStorage.setItem('budget-tracker', JSON.stringify(data));
    });
    await page.reload();
    await page.waitForTimeout(400);
    check('spaces around a saved name are dropped on load', await page.locator('.strip .chip', { hasText: 'Bills' }).first().evaluate((c) => c.textContent), 'Bills');
    await openMenu(page, 'Categories');
    check('and on the Categories screen', (await categoryRows(page))[0], 'Bills');
    const otherIndex = (await categoryRows(page)).indexOf('Other');
    await nameField(otherIndex).fill('Misc   ');
    await nameField(otherIndex).press('Enter');
    check('typed trailing spaces go when you finish the name', await nameField(otherIndex).inputValue(), 'Misc');
    await save.tap();
    await page.waitForTimeout(300);
    check('and are never saved', await page.evaluate(() => JSON.parse(localStorage.getItem('budget-tracker')).categories.some((c) => c.name !== c.name.trim())), false);
    check('saved as Misc', (await savedNames()).split(',').includes('Misc'), true);
  });

  await scenario('categories: adding with the keyboard open', async (open) => {
    const { page } = await categoriesScreen(open);
    // The last empty slot, at the bottom of a long list, ends up above the keyboard, not behind it.
    // (A 300px keyboard is faked by shrinking the visual viewport, as iOS does.)
    await page.evaluate(() => Object.defineProperty(visualViewport, 'height', { configurable: true, get: () => innerHeight - 300 }));
    await page.locator('.cat-row.slot input').last().tap();
    await page.evaluate(() => visualViewport.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(200);
    const field = await page.evaluate(() => ({ value: document.activeElement.value, bottom: document.activeElement.getBoundingClientRect().bottom, keyboardTop: innerHeight - 300 }));
    check(`an empty slot being typed in is above the keyboard (bottom ${field.bottom}, keyboard at ${field.keyboardTop})`, field.value === '' && field.bottom <= field.keyboardTop, true);
  });

  await scenario('rate timing', async (open) => {
    // Re-check every 3 hours until today's rate arrives, then stop for the day.
    const now = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); // local date, like the app
    let rateDate = '2020-01-01'; // the source hasn't published today's rate yet
    let downloads = 0;
    // No service worker here: in WebKit, Playwright can't intercept requests that go through one,
    // so after the first load the app's rate checks would bypass the fake rate server below.
    const context = await open({ serviceWorkers: 'block' });
    await context.route('https://api.frankfurter.dev/**', (r) => {
      downloads++;
      r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ date: rateDate, rates: { MXN: 19 } }) });
    });
    const page = await newPage(context);
    await page.goto(URL);
    await page.waitForTimeout(400);
    check('rates: downloaded on first launch', downloads, 1);
    await page.reload();
    await page.waitForTimeout(400);
    check('rates: not today’s yet, but checked under 3 hours ago, so no download', downloads, 1);
    const hoursAgo = (h) => page.evaluate((ms) => {
      const s = JSON.parse(localStorage.getItem('budget-tracker'));
      s.rates.checkedAt = Date.now() - ms;
      localStorage.setItem('budget-tracker', JSON.stringify(s));
    }, h * 3600 * 1000);
    await hoursAgo(4);
    rateDate = today; // now the source has today's rate
    await page.reload();
    await page.waitForTimeout(400);
    check('rates: checked again after 3 hours', downloads, 2);
    await hoursAgo(4);
    await page.reload();
    await page.waitForTimeout(400);
    check('rates: has today’s rate, so no more checks today', downloads, 2);
  });

  await scenario('upgrading version 1 data', async (open) => {
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
    const context = await open();
    await fakeShareSheet(context);
    await mockRates(context, RATE);
    await context.addInitScript((data) => { if (!localStorage.getItem('budget-tracker')) localStorage.setItem('budget-tracker', data); }, JSON.stringify(v1('saved before the upgrade')));
    const page = await newPage(context);
    await page.goto(URL);
    await page.waitForTimeout(500);
    const upgraded = await saved(page);
    check('v1 data: upgraded to the current version (3)', upgraded.version, 3);
    check('v1 data: gets the default reminder setting', upgraded.settings.backupReminderDays, 30);
    check('v1 data: old rate field gone', 'rate' in upgraded, false);
    check('v1 data: expense keeps its rate as perUsd', JSON.stringify(upgraded.expenses[0].original), '{"currency":"MXN","amount":250,"perUsd":18.5}');
    check('v1 data: the day’s rate downloads into the new shape', upgraded.rates.perUsd.MXN, 20);
    check('v1 data: remembered currency still MXN', await page.locator('.currency-opts .on').textContent(), 'MXN');
    check('v1 data: totals intact', await spentText(page), '$13.51');
    await page.locator('#help').click({ position: { x: 20, y: 30 } });
    await page.waitForTimeout(300);
    await page.locator('.cat-head', { hasText: 'Food' }).tap();
    check('v1 data: expense still shows its pesos', await page.locator('.item .orig').textContent(), 'from MX$250');
    await page.locator('#nav-btn').tap();
    await page.waitForTimeout(250);
    fs.writeFileSync(`${OUT}/v1-backup.json`, JSON.stringify(v1('restored from an old backup')));
    await openMenu(page, 'Backup');
    page.once('dialog', (d) => d.accept());
    await page.locator('.page-body input[type=file]').setInputFiles(`${OUT}/v1-backup.json`);
    await page.waitForTimeout(400);
    check('v1 backup: restores', await page.locator('#help .text').first().textContent(), 'Backup restored');
    const restored = await saved(page);
    check('v1 backup: upgraded on restore', [restored.version, restored.expenses[0].note, restored.expenses[0].original.perUsd].join('|'), '3|restored from an old backup|18.5');
  });

  await scenario('keyboard closing', async (open) => {
    // On a long screen scrolled to its bottom: the room made for the keyboard isn't dropped at once
    // (the screen would snap down by the keyboard's height as it slides away); the screen glides to
    // where it will rest, then the room goes. A stand-in for iOS's visualViewport lets the test open
    // and close a "keyboard".
    const context = await open();
    await mockRates(context, RATE);
    await context.addInitScript(() => {
      const viewport = new EventTarget();
      let keyboard = 0;
      Object.defineProperty(viewport, 'height', { get: () => window.innerHeight - keyboard });
      viewport.offsetTop = 0;
      window.setKeyboard = (height) => { keyboard = height; viewport.dispatchEvent(new Event('resize')); };
      Object.defineProperty(window, 'visualViewport', { get: () => viewport, configurable: true });
    });
    const page = await newPage(context);
    await page.goto(URL);
    await appReady(page);
    await startFirstPeriod(page);
    await openMenu(page, 'Categories');
    const opened = await page.evaluate(async () => {
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
  });

  const realErrors = errors.filter((e) => !/Failed to load resource|frankfurter|network/i.test(e));
  console.log(realErrors.length ? `ERRORS:\n${realErrors.join('\n')}` : 'No console errors');
  await browser.close();
})().catch((e) => { console.error('TEST CRASHED:', e.message); process.exit(1); });
