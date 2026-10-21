// Entry point: wires the menu, screens and data together.

import { currentPeriod, refreshRate } from './store.js';
import { initInput, renderInput } from './input.js';
import { initPages, showPage, renderPage } from './pages.js';
import { openBudgetSheet } from './sheets.js';
import { backupStatus } from './backup.js';

const menuBackdrop = document.getElementById('menu-backdrop');
const openMenu = () => menuBackdrop.classList.add('open');
const closeMenu = () => menuBackdrop.classList.remove('open');
const openCurrentSummary = () => showPage('summary', { periodId: currentPeriod().id });

menuBackdrop.addEventListener('click', (event) => { if (event.target === menuBackdrop) closeMenu(); });
document.getElementById('menu').addEventListener('click', (event) => {
  const action = event.target.closest('button')?.dataset.action;
  if (!action) return;
  closeMenu();
  if (action === 'current') openCurrentSummary();
  else if (action === 'new-period') openBudgetSheet('new');
  else showPage(action);
});

// The backup line in the menu, plus a dot on ≡ when a backup is overdue.
function renderMenu() {
  const status = backupStatus();
  const line = document.getElementById('backup-status');
  line.textContent = status.label;
  line.classList.toggle('bad', status.stale);
  document.getElementById('menu-btn').classList.toggle('alert', status.stale);
}

initInput({ openMenu, openSummary: openCurrentSummary });
initPages();
renderMenu();

// Every save redraws whatever is on screen.
window.addEventListener('budget:change', () => {
  renderInput();
  renderPage();
  renderMenu();
});

if (!currentPeriod()) openBudgetSheet('first');

// Ask the browser not to clear this app's data when the phone is low on space.
// The browser decides silently; the Backup screen shows the answer.
navigator.storage?.persist?.().catch(() => {});

// Fetch today's exchange rate on launch, and when the app comes back from the background.
// Coming back is also when "days since last backup" may have ticked over.
refreshRate();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refreshRate();
  renderMenu();
});

// The service worker lets the app open offline. It only registers on HTTPS or localhost.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
