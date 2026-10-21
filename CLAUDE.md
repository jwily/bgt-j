# Bgt-J (Budget Junction): notes for Claude

A personal iPhone budget tracker (home-screen web app) for one user, who is paid in USD and also
spends in Mexican pesos. Styled after the Final Fantasy VIII menu; the app is named Bgt-J ("Budget Junction", after FF8's
stat junctions). Personal use only, not shared. Storage keys stay `budget-tracker*` (renaming them
would orphan saved data).
Read README.md for what the app does; this file covers how to work on it.

## Layout and commands

- `app/` is the deployable app: plain HTML/CSS/ES modules, no build step, no dependencies.
  Serve it with `cd app && python3 -m http.server 8000`.
- `tests/` holds the Playwright suites and design tools. `cd tests && npm test` runs every pass on
  WebKit and Chromium (it starts its own server on port 8765). First time: `npm install && npm run setup`.
- Four passes: `main` (core flow), `more` (edge cases), `layout` (spacing/fit on three iPhones),
  `failures` (storage full/corrupt, rate server down, bad backups, offline, overnight, big data).
- Shared test helpers live in `tests/helpers.js` (`mockRates`, `startFirstPeriod`, `messageCleared`,
  `asInstalledApp`, ...). Prefer waiting for a condition over fixed `waitForTimeout` sleeps.
- Run `npm test` before every commit. When behavior changes, update or add checks in the same
  commit; when you fix a bug, add a check that would have caught it.
- FF8 reference screenshots are in `~/projects/ff8-references/`, outside the repo on purpose
  (they're the game's artwork). Never copy them into `app/`.

## How the code fits together

- **Data:** `app/js/store.js` owns `state` (one JSON object in localStorage). Every change goes through
  a store function that calls `save()`, which fires `budget:change`; `app.js` then redraws everything
  (`renderInput`, `renderPage`, `renderChrome`). Don't render from inside store code.
- **Changing the saved shape:** bump `VERSION` in store.js, add a step to `migrate()` (it runs on load
  and on backup restore), and add a test that loads data/backups in the old shape (see `more.js`).
- **Currencies:** everything is in `CURRENCIES` in `app/js/money.js`. Adding a currency is one line
  there; nothing else should mention specific currencies. USD is the home currency: all amounts are
  stored as US cents; foreign expenses keep `original: { currency, amount, perUsd }`.
- **Undo:** store changes that can be undone return an undo function; pass it to `toast(message, undo)`.
- **Screens:** `pages.js` screens call `fill(title, helpLine, ...windows)`; `panel(label, ...)` makes a
  labelled window. Navigation is a stack (`showPage`, `goBack`). Sheets (`sheets.js`) are for small
  edits only (edit expense, category grid).
- **Category colors** are assigned automatically, never picked: alphabetical order, active first, using
  `PALETTE` (16 colors after FF8's Guardian Forces, in GF-menu order). Check changes with `npm run palette`.
- **Category names are unique** ignoring case (`categoryNamed`); new ones get a free name.
- **The Categories screen holds its order and colors while it's open** (`categoryView` in pages.js):
  edits save immediately, but rows don't jump; new and restored ones join at the bottom. It's
  alphabetical again on the next visit (the user found the instant re-sort annoying).
- **Saving can fail** (storage full): `save()` fires `budget:save-failed` and app.js alerts. Unreadable
  saved data is kept under `budget-tracker-unreadable` and app.js recovers from the newest snapshot.
- **Snapshots** (`snapshots.js`, in IndexedDB, async): taken once a day and before anything drastic; call
  `takeSnapshot(reason)` before any new destructive action (it captures the data immediately). Never in
  backups. Older versions kept them in localStorage; `moveOldSnapshots()` moves them at startup.
- **Settings** live in `state.settings` (currently `backupReminderDays`, default 30); data is version 3.
- Tests run as the installed app (`asInstalledApp` in helpers.js); in a Safari tab the app shows an
  install hint in the HELP window instead of the amount left.
- **Rates** download when the app opens without today's rates, at most every 3 hours (the source
  publishes once per business day).
- **Dates** all go through `app/js/dates.js`: `todayISO`, `localDay`, `daysBetween`, `formatDate` (year
  only when it isn't this year), `formatMoment`. Never do day arithmetic with milliseconds elsewhere.
- Build DOM with `el()` from `ui.js`; it skips `false`/`null` children (so `cond && el(...)` is safe).

## Design rules (measured from the reference screenshots, not guessed)

- Windows: square corners; fill shades **left to right** (dark at the edges, flat `#646464` in the
  middle), no stripes or texture; a dark outer line plus an inner bevel (light `#747474` top/left,
  dark `#323232` bottom/right). Pure black background.
- Spacing: one gap, `--gap` (8px), between any two windows or buttons in either direction; keypad
  keys use the tighter `--gap-keys` (6px). Use the variables, not new numbers.
- Small uppercase label tabs on a window's top-left edge (HELP, AMOUNT, CATEGORY...).
- White text with a hard dark shadow. **Yellow** marks the selected thing; **grey** marks unchosen
  or unavailable options.
- The pointing-hand cursor sits outside whatever it points at: centering ignores it (the USD/MXN
  pair, category chips). It bobs beside buttons you'd press and sits still beside selections.
- Capitalization: Title Case for names (screens, menu commands, period and category names:
  Current Period, Past Periods, Edit Budget, New Category); sentence case for everything else
  (buttons, labels, help lines, messages: Start new period, Under budget, New period started).
  ALL CAPS only as styling (window tabs, menu stat labels, ADD, UNDO).
- Font: Nunito. A pixel FF8 font was tried (branch `ff8-font`) and rejected for readability.
- Before imitating any visual style, get references and measure them (pixel sampling, tracing).
  Styling from memory produced FF7's look the first time.

## Working with this user

- Their phone is an iPhone 14 Pro (in the layout tests).

- Likes DRY code and periodic refactor passes; asks for them by name.
- Wants honest reasons when something went wrong, and wants things verified (tests, measurements,
  screenshots) before you report them done.
- Often sends several small requests while you're working; handle them in order and report each.
- Propose one recommendation for open design questions and let them choose; ask before large visual
  changes. Commit each change separately with a descriptive message, so one change can be reverted alone.

## Decisions already made (don't re-litigate without being asked)

- Periods are paycheck-to-paycheck, started manually with New Period. Deleting the current period
  reopens the previous one.
- Main screen: AMOUNT window on top (swipe for currency; swipes follow the finger and stop at the
  ends, taps cycle), then NOTE + DATE, then the horizontal CATEGORY strip (nearer the thumb, since
  it changes more often), then a 3-column keypad. A vertical category list
  beside the amount was tried and reverted (spacing problems).
- Thumb reach (right-handed): the top is for reading, the bottom for tapping. HELP and the title
  window stay at the top (user's choice, like FF8); a bottom bar holds ADD (main screen, long, with
  the hand), Undo while offered, and Menu/Back. The menu opens upward, period commands nearest the
  thumb. A tall ADD and a currency switch key in a 4th keypad column were tried and replaced by this.
  Short screens sit at the bottom; a screen's actions go at its bottom.
- Category chips are as wide as their name; double-tapping the strip opens the grid level with it
  (it was a long-press before; the user asked for double tap).
- New Period / first budget / edit budget is a full screen, not a sheet.
- Backups are whole-history JSON; CSV export is for spreadsheets only.
- Animations ignore the phone's Reduce Motion setting: the user keeps it on elsewhere but wants the
  hand to bob and windows to unfold here.

## Branches

- `master`: the current app. `ff8-reskin`: where the FF8 work happened (merged).
  `ff8-font`: the rejected pixel-font trial.
- Deployed with GitHub Pages: pushing `master` to `origin` (the user's personal repo, `jwily/bgt-j`,
  through a deploy key set in this repo's git config) publishes `app/` via `.github/workflows/pages.yml`.
  The live address is under the user's own domain, `https://www.johnjylee.com/bgt-j/`. Never change
  the address: the phone's saved data is tied to it. Ask before pushing. Commit email for this repo
  is the user's personal one (set in the repo's git config), not their work email.
