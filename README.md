# Budget

A personal budget tracker that runs as a home-screen web app on iPhone, styled after the Final Fantasy VIII menu. Plain HTML, CSS and JS: no build step, no dependencies.

Instead of resetting every month, the budget runs in **periods**: each time you get paid, start a New Period with that paycheck's budget. The previous period closes and keeps its summary.

## Folders

- `app/`: the app itself. This is the folder you deploy.
- `tests/`: browser tests and the tools that generate the hand cursor, the icon and the palette check. Never deployed.

## Run it locally

```sh
cd app
python3 -m http.server 8000
```

Open http://localhost:8000. To try it on your phone on the same Wi-Fi, open `http://<your-mac's-IP>:8000` in Safari (`ipconfig getifaddr en0` prints the IP). Offline support only works once it's hosted on HTTPS.

## Put it on your phone

1. Host the **`app` folder** on a free HTTPS static host, e.g. Netlify (drag the `app` folder onto app.netlify.com/drop) or GitHub Pages.
2. Open the URL in Safari on your iPhone.
3. Tap Share → **Add to Home Screen**.

Your data is tied to the URL, so pick the site's name before you start using it.

## Using it

- **Amounts** fill in from the right. In dollars, 5 1 0 5 0 is $510.50. Pesos are whole numbers, so 5 1 0 5 0 is MX$51,050. Hold ⌫ to clear.
- **Currency**: tap USD/MXN, or swipe left or right on the amount.
- **Category**: swipe the strip; the centered one is selected. Long-press it to see every category at once. Categories are listed alphabetically and take their colors in that order.
- The **HELP** window at the top shows how much is left; tap it for the current period's summary. Messages (with **Undo**) appear there briefly.
- Everything else is under **Menu** (top right). On other screens that window is **‹ Back**.
- A period's summary has **Delete period** at the bottom (it deletes that period's expenses too; deleting the current period reopens the previous one).

Everything is stored in US dollars. Expenses in another currency are converted when you add them, at that day's rate, and keep their original amount so summaries can show "from MX$250".

## Adding a currency

Add one line to `CURRENCIES` in `app/js/money.js`, e.g. `EUR: { decimals: 2, maxDigits: 8, fallbackRate: 0.9 },`. The picker, keypad, formatting, daily rate download, editing and CSV export all pick it up. US dollars stay the home currency. The rate source covers about 30 major currencies (European Central Bank data).

## Exchange rates

When the app opens without today's rates, it downloads them from [Frankfurter](https://frankfurter.dev) (free, publishes European Central Bank rates), checking at most every 3 hours. New rates come out once per business day, around 9am in Mexico City, so checking more often wouldn't help. Offline, it uses the last rates it had. That download is the app's only network request.

## Your data

Data is stored on the phone in `localStorage`, tied to the URL you installed from. A home-screen app's storage is separate from Safari's (opening the URL in a Safari tab shows an empty app) and is exempt from Safari's 7-day cleanup. Deleting the home-screen app erases it; whether clearing Safari's data reaches it isn't documented, so don't count on either way. Use **Menu → Backup → Export backup** now and then. Backups contain your whole history. **Restore from backup** loads one back (it replaces everything; it doesn't merge). Backups from older versions of the app are upgraded when restored.

Two safeguards:

- **Persistent storage.** On launch the app asks the browser not to clear its data when the phone is low on space. The browser decides silently; the Backup screen shows whether it was granted.
- **Safety snapshots.** The app keeps copies of all your data on the phone: one a day and one before anything drastic (restoring a backup, deleting a period, going back to a snapshot). The newest 7 are listed under **Menu → Backup → Snapshots** with **Go back**. They undo mistakes; they're lost with the phone, unlike exported backups.
- **Backup reminders.** The menu shows when you last backed up. After 30 days (or if you've never backed up and have expenses), that line turns red and a dot appears on Menu. Starting a New Period also offers **Back up first**.

## Tests

```sh
cd tests
npm install
npm run setup      # downloads the test browsers (once)
npm test           # all passes on WebKit (Safari's engine) and Chromium
```

`npm test -- webkit` runs one engine; `npm test -- webkit layout` runs one pass. The passes start their own web server for `app/`.

- `main.js`: the core flow, from first launch through entering, editing, summaries, periods, categories and backups
- `more.js`: edge cases (keypad limits, long-press grid, backdating, CSV, restore, deleting periods, offline rates, upgrading old data)
- `layout.js`: centering, spacing and fit on an iPhone 13 mini, SE (3rd gen) and 13
- `failures.js`: when things go wrong: storage full or corrupted, the rate server failing, newer or broken backups, opening offline, the app left open overnight, a period spanning New Year, and lots of data

Tools: `npm run palette` checks the category colors are distinct. `npm run icon` redraws the app icon (the first four category colors). `npm run hand` re-traces the hand cursor from the reference capture in `~/projects/ff8-references/cursor.png`. `npm run screens` screenshots every screen on two iPhone sizes into `tests/output/screens/`.

## App files

- `js/app.js`: startup, the title window and the menu
- `js/store.js`: the data model, saving, upgrading old data, and the rate download
- `js/money.js`: the currency table, formatting and conversion to US dollars
- `js/input.js`: the main entry screen
- `js/pages.js`: summaries, period list, categories, backup, and the budget screen
- `js/sheets.js`: pop-up sheets (edit expense, category grid)
- `js/backup.js`: backup export/restore, CSV export, "last backed up" status
- `js/ui.js`: shared helpers (elements, keypad, gestures, the HELP window, sheets)
- `style.css`: the FF8 look. The hand cursor's outline is traced from a capture of the game's cursor; everything else is drawn with CSS.
- `fonts/`: Nunito (SIL Open Font License, see `fonts/OFL.txt`), bundled so it works offline
- `sw.js`, `manifest.json`, `icons/`: offline support and the home-screen icon
