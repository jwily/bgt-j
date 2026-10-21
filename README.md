# Budget

A personal budget tracker that runs as a home-screen web app on iPhone. Plain HTML, CSS and JS: no build step, no dependencies.

Instead of resetting every month, the budget runs in **periods**: each time you get paid, start a New Period with that paycheck's budget. The previous period closes and keeps its summary.

## Run it locally

```sh
cd budget-tracker
python3 -m http.server 8000
```

Open http://localhost:8000. To try it on your phone on the same Wi-Fi, open `http://<your-mac's-IP>:8000` in Safari (`ipconfig getifaddr en0` prints the IP). Offline support only works once it's hosted on HTTPS.

## Put it on your phone

1. Host the folder on a free HTTPS static host: GitHub Pages (push to a repo, then Settings → Pages) or Netlify (drag the folder onto app.netlify.com/drop).
2. Open the URL in Safari on your iPhone.
3. Tap Share → **Add to Home Screen**.

## Using it

- **Amounts** fill in from the right. In dollars, 5 1 0 5 0 is $510.50. Pesos are whole numbers, so 5 1 0 5 0 is MX$51,050. Hold ⌫ to clear.
- **Currency**: tap the USD/MXN switch, or swipe left or right on the amount.
- **Category**: swipe the colored strip; the centered one is selected. Long-press the strip to see every category at once. Categories are always listed alphabetically.
- **Undo** appears for a few seconds after adding or deleting.
- The **HELP** window at the top shows how much is left; tap it for the current period's summary. Messages (with **Undo**) appear there briefly. Everything else is under **Menu**, top right; on other screens that same window is the **‹ Back** button.

Everything is stored in US dollars. Peso entries are converted when you add them, using that day's rate, and also keep the original peso amount so summaries can show "from MX$250".

## Adding a currency

Add one line to `CURRENCIES` in `js/money.js`, e.g. `EUR: { decimals: 2, maxDigits: 8, fallbackRate: 0.9 },`. The picker, keypad, formatting, daily rate download, editing and CSV export all pick it up. US dollars stay the home currency: everything is stored and totaled in USD. The rate source covers about 30 major currencies (European Central Bank data).

## Exchange rate

Each time the app opens, it downloads today's rates for every currency in the table from [Frankfurter](https://frankfurter.dev) (free, publishes European Central Bank rates) unless it already has today's. Offline, it uses the last rate it had. That download is the app's only network request.

## Your data

Data is stored on the phone in `localStorage`, tied to the URL you installed from. Deleting the home-screen app or clearing Safari's website data erases it, so use **≡ → Backup → Export backup** now and then. **Restore from backup** loads that file back (it replaces everything; it doesn't merge).

Two safeguards:

- **Persistent storage.** On launch the app asks the browser not to clear its data when the phone is low on space. The browser decides silently; the Backup screen shows whether it was granted. This doesn't protect against deleting the app or clearing Safari data.
- **Backup reminders.** The menu shows when you last backed up. After 30 days (or if you've never backed up and have expenses), that line turns red and a dot appears on ≡. Starting a New Period also offers a **Back up first** button.

## Files

- `js/app.js`: startup and the menu
- `js/store.js`: the data model, saving, and the exchange-rate download
- `js/input.js`: the main entry screen
- `js/pages.js`: summaries, period list, categories, backup
- `js/sheets.js`: pop-up sheets (budget, edit expense, category grid)
- `js/backup.js`: backup export/restore, CSV export, "last backed up" status
- `js/ui.js`: shared helpers (keypad, swipe and long-press, toasts)
- `js/money.js`: the currency table, formatting and conversion to US dollars
- `style.css`: the look, styled after the Final Fantasy VIII menu (grey bevelled windows with label tabs, HELP window, pointing-hand cursor). Everything is drawn with CSS and an original SVG; no game assets are used.
- `fonts/`: Nunito (SIL Open Font License, see `fonts/OFL.txt`), bundled so it works offline
- `sw.js`, `manifest.json`, `icons/`: offline support and the home-screen icon
