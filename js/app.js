// Entry point: wires the top bar, menu, screens and data together.

import { currentPeriod, spentIn, refreshRate, todayISO } from './store.js';
import { formatUsd } from './money.js';
import { setHelp } from './ui.js';
import { initInput, renderInput } from './input.js';
import { initPages, showPage, renderPage, isPageOpen, pageTitle, canGoBack, goBack } from './pages.js';
import { backupStatus } from './backup.js';

const $ = (id) => document.getElementById(id);
const navButton = $('nav-btn');
const menuBackdrop = $('menu-backdrop');
const isMenuOpen = () => menuBackdrop.classList.contains('open');
const openMenu = () => menuBackdrop.classList.add('open');
const closeMenu = () => menuBackdrop.classList.remove('open');
const openCurrentSummary = () => showPage('summary', { periodId: currentPeriod().id });

// The title window: "Menu" on the main screen, "‹ <screen>" (Back) everywhere else.
navButton.addEventListener('click', () => {
  if (isPageOpen()) {
    if (canGoBack()) goBack();
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

// Day 1 is the day the period started.
const periodDay = (period) => Math.round((new Date(`${todayISO()}T00:00`) - new Date(`${period.start}T00:00`)) / 86400000) + 1;

// The parts that don't belong to one screen: title window, menu stats, and the main screen's help line.
function renderChrome() {
  const pageOpen = isPageOpen();
  const status = backupStatus();
  const back = pageOpen && canGoBack();
  navButton.textContent = pageOpen ? `${back ? '‹ ' : ''}${pageTitle()}` : 'Menu';
  navButton.setAttribute('aria-label', back ? 'Back' : pageOpen ? pageTitle() : 'Menu');
  navButton.disabled = pageOpen && !back;
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
  if (!pageOpen) {
    setHelp(`${formatUsd(Math.abs(left))} ${over ? 'over' : 'left'} this period`, { tone: over ? 'bad' : '', onTap: openCurrentSummary });
  }
}

// Every save, and every change of screen, redraws whatever is showing.
function refresh() {
  renderInput();
  renderPage();
  renderChrome();
}

initInput();
initPages({ onNavigate: refresh });
refresh();
window.addEventListener('budget:change', refresh);

if (!currentPeriod()) showPage('budget', { mode: 'first' });

// Ask the browser not to clear this app's data when the phone is low on space.
// The browser decides silently; the Backup screen shows the answer.
navigator.storage?.persist?.().catch(() => {});

// Fetch today's exchange rate on launch, and when the app comes back from the background.
// Coming back is also when the period's day count and "days since last backup" may tick over.
refreshRate();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refreshRate();
  renderChrome();
});

// The service worker lets the app open offline. It only registers on HTTPS or localhost.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
