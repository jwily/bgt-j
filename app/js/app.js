// Entry point: wires the top bar, menu, screens and data together.

import { currentPeriod, spentIn, refreshRate, needsRecovery } from './store.js';
import { daysBetween, formatMoment } from './dates.js';
import { formatUsd } from './money.js';
import { setHelp, keepFieldsAboveKeyboard } from './ui.js';
import { initInput, renderInput } from './input.js';
import { initPages, showPage, renderPage, isPageOpen, pageTitle, canGoBack, goBack, confirmLeave } from './pages.js';
import { backupStatus } from './backup.js';
import { moveOldSnapshots, recoverFromSnapshot, takeDailySnapshot } from './snapshots.js';

const $ = (id) => document.getElementById(id);
const navButton = $('nav-btn');
const menuBackdrop = $('menu-backdrop');
const isMenuOpen = () => menuBackdrop.classList.contains('open');
const openMenu = () => menuBackdrop.classList.add('open');
const closeMenu = () => menuBackdrop.classList.remove('open');
const openCurrentSummary = () => {
  closeMenu(); // the HELP window can be tapped while the menu is open
  showPage('summary', { periodId: currentPeriod().id });
};

// The button at the bottom right: "Menu" on the main screen, "‹ Back" everywhere else.
navButton.addEventListener('click', () => {
  if (isPageOpen()) {
    if (canGoBack() && confirmLeave()) goBack();
  } else if (isMenuOpen()) {
    closeMenu();
  } else {
    openMenu();
  }
});

menuBackdrop.addEventListener('click', (event) => { if (event.target === menuBackdrop) closeMenu(); });
$('menu').addEventListener('click', (event) => {
  const action = event.target.closest('button')?.dataset.action;
  if (!action) return;
  closeMenu();
  if (action === 'current') openCurrentSummary();
  else if (action === 'new-period') showPage('budget', { mode: 'new' });
  else showPage(action);
});

// Opened in a Safari tab on an iPhone rather than from the home screen. (navigator.standalone only
// exists on iOS, so this is never true anywhere else.)
const inSafariTab = navigator.standalone === false;
const explainInstall = () => alert('To install Bgt-J, tap Share, then Add to Home Screen, and open it from there from now on. Data entered in a Safari tab stays separate from the installed app.');

// Day 1 is the day the period started.
const periodDay = (period) => daysBetween(period.start) + 1;

// The parts that don't belong to one screen: the title window, the Menu/Back button, menu stats,
// and the main screen's help line.
function renderChrome() {
  const pageOpen = isPageOpen();
  document.body.classList.toggle('page-open', pageOpen);
  const status = backupStatus();
  $('title').hidden = !pageOpen;
  $('title').textContent = pageOpen ? pageTitle() : '';
  navButton.textContent = pageOpen ? '‹ Back' : 'Menu';
  // The first-budget screen can't be left, so it has no Back.
  navButton.hidden = pageOpen && !canGoBack();
  navButton.classList.toggle('alert', !pageOpen && status.stale);
  $('backup-status').textContent = status.short;
  $('backup-status').classList.toggle('bad', status.stale);

  const period = currentPeriod();
  if (!period) return;
  const left = period.budgetCents - spentIn(period.id);
  const over = left < 0;
  $('stat-day').textContent = String(periodDay(period));
  $('stat-left-label').textContent = over ? 'Over' : 'Left';
  $('stat-left').textContent = formatUsd(Math.abs(left));
  $('stat-left').classList.toggle('bad', over);
  if (!pageOpen && inSafariTab) {
    setHelp('Install: Share → Add to Home Screen', { onTap: explainInstall });
  } else if (!pageOpen) {
    setHelp(`${formatUsd(Math.abs(left))} ${over ? 'over' : 'left'} this period`, { tone: over ? 'bad' : '', onTap: openCurrentSummary });
  }
}

// Every save, and every change of screen, redraws whatever is showing.
function refresh() {
  renderInput();
  renderPage();
  renderChrome();
}

// Saving failed (the phone's storage for the app is full): say so plainly, since the change is on
// screen but won't survive closing the app.
window.addEventListener('budget:save-failed', () => {
  alert("Couldn't save: this phone's storage for the app is full. Export a backup now (Menu → Backup).");
});

await moveOldSnapshots(); // from older versions, which kept them in localStorage
if (needsRecovery) {
  const recoveredFrom = await recoverFromSnapshot();
  if (recoveredFrom) alert(`Your saved data couldn't be read, so the app restored its snapshot from ${formatMoment(recoveredFrom)}. Anything after that is lost unless it's in a backup.`);
}

takeDailySnapshot(); // before anything changes today
keepFieldsAboveKeyboard();
initInput();
initPages({ onNavigate: refresh });
refresh();
window.addEventListener('budget:change', refresh);

if (!currentPeriod()) showPage('budget', { mode: 'first' });

// Ask the browser not to clear this app's data when the phone is low on space.
// The browser decides silently; the Backup screen shows the answer.
navigator.storage?.persist?.().catch(() => {});

// Fetch today's exchange rate on launch, and when the app comes back from the background.
// Coming back is also when the date, the period's day count and "days since last backup" may tick over.
refreshRate();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refreshRate();
  refresh(); // e.g. "Today" may be a new day
});

// The service worker lets the app open offline. It only registers on HTTPS or localhost.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
