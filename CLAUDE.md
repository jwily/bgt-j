# Budget tracker: notes for Claude

A personal iPhone budget tracker (home-screen web app) for one user, who is paid in USD and also
spends in Mexican pesos. Styled after the Final Fantasy VIII menu. Personal use only, not shared.
Read README.md for what the app does; this file covers how to work on it.

## Layout and commands

- `app/` is the deployable app: plain HTML/CSS/ES modules, no build step, no dependencies.
  Serve it with `cd app && python3 -m http.server 8000`.
- `tests/` holds the Playwright suites and design tools. `cd tests && npm test` runs every pass on
  WebKit and Chromium (it starts its own server on port 8765). First time: `npm install && npm run setup`.
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
- Build DOM with `el()` from `ui.js`; it skips `false`/`null` children (so `cond && el(...)` is safe).

## Design rules (measured from the reference screenshots, not guessed)

- Windows: square corners; fill shades **left to right** (dark at the edges, flat `#646464` in the
  middle), no stripes or texture; a dark outer line plus an inner bevel (light `#747474` top/left,
  dark `#323232` bottom/right). Pure black background.
- Small uppercase label tabs on a window's top-left edge (HELP, AMOUNT, CATEGORY...).
- White text with a hard dark shadow. **Yellow** marks the selected thing; **grey** marks unchosen
  or unavailable options.
- The pointing-hand cursor sits outside whatever it points at: centering ignores it (the USD/MXN
  pair, category chips). It bobs beside buttons you'd press and sits still beside selections.
- Font: Nunito. A pixel FF8 font was tried (branch `ff8-font`) and rejected for readability.
- Before imitating any visual style, get references and measure them (pixel sampling, tracing).
  Styling from memory produced FF7's look the first time.

## Working with this user

- Likes DRY code and periodic refactor passes; asks for them by name.
- Wants honest reasons when something went wrong, and wants things verified (tests, measurements,
  screenshots) before you report them done.
- Often sends several small requests while you're working; handle them in order and report each.
- Propose one recommendation for open design questions and let them choose; ask before large visual
  changes. Commit each change separately with a descriptive message, so one change can be reverted alone.

## Decisions already made (don't re-litigate without being asked)

- Periods are paycheck-to-paycheck, started manually with New Period. Deleting the current period
  reopens the previous one.
- Main screen: AMOUNT window on top (swipe for currency), horizontal CATEGORY strip below it.
  A vertical category list beside the amount was tried and reverted (spacing problems).
- Category chips are as wide as their name; long-pressing the strip opens the grid level with it.
- New Period / first budget / edit budget is a full screen, not a sheet.
- Backups are whole-history JSON; CSV export is for spreadsheets only.

## Branches

- `master`: the app before the FF8 re-skin. `ff8-reskin`: current work, not yet merged.
  `ff8-font`: the rejected pixel-font trial.
- Not deployed yet. When it is, deploy the `app/` folder only.
