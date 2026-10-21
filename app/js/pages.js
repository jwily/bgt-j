// Secondary screens: period summaries, the list of periods, categories, backup, and the budget
// screen (first budget, New Period, edit budget).
// Each screen sets its title (shown in the top-right title window) and its HELP line, then
// fills the page with labelled windows.

import {
  state, currentPeriod, getPeriod, periodNumber, periodExpenses, spentIn, totalUsd, getCategory, activeCategories, sortedCategories,
  addCategory, updateCategory, removeCategory, categoryNamed, startPeriod, setBudget, deletePeriod, setBackupReminder,
} from './store.js';
import { HOME, formatMoney, formatUsd, formatDiff } from './money.js';
import { el, svg, toast, setHelp, colorDot, gauge, keypad } from './ui.js';
import { formatDate, formatMoment } from './dates.js';
import { openExpenseSheet } from './sheets.js';
import { exportBackup, exportCsv, readBackup, restoreBackup, backupStatus, REMINDER_CHOICES } from './backup.js';
import { readSnapshots, takeSnapshot, restoreSnapshot } from './snapshots.js';

const page = document.getElementById('page');
const body = document.getElementById('page-body');

const PAGES = { summary: renderSummary, periods: renderPeriods, categories: renderCategories, backup: renderBackup, budget: renderBudget };

let stack = [];               // [{ name, params }], so Back returns to the previous screen
let title = '';               // the showing screen's name, for the title window
const expanded = new Set();   // category ids opened on the summary screen
let budgetDigits = '';        // what's typed on the budget screen (kept across redraws)
let budgetBackedUp = false;   // whether "Back up first" succeeded on the budget screen
let onNavigate = () => {};    // redraws the app after showing or leaving a screen

// A small grey footnote.
const note = (text) => el('p', { className: 'empty-note', textContent: text });

// A window with an FF8-style label tab on its top edge.
const panel = (label, ...children) => el('div', { className: 'window panel', 'data-label': label }, ...children);

// Set up a screen: its title and help line, then its windows. Skips empty slots like
// `condition && el(...)` that came out false.
function fill(screenTitle, help, ...nodes) {
  title = screenTitle;
  setHelp(help);
  body.replaceChildren(...nodes.filter((node) => node != null && node !== false));
}

export function initPages(options) {
  onNavigate = options.onNavigate;
}

export const isPageOpen = () => !page.hidden;
export const pageTitle = () => title;
// The first-budget screen can't be left: the app needs a period before anything else works.
export const canGoBack = () => !(stack.at(-1)?.name === 'budget' && !currentPeriod());

// push: keep the current screen underneath (Back returns to it).
export function showPage(name, params = {}, { push = false } = {}) {
  stack = push ? [...stack, { name, params }] : [{ name, params }];
  expanded.clear();
  if (name === 'budget') {
    budgetDigits = params.mode === 'edit' ? String(currentPeriod().budgetCents) : '';
    budgetBackedUp = false;
  }
  page.hidden = false;
  page.scrollTop = 0;
  unfold();
  onNavigate();
}

export function goBack() {
  stack.pop();
  if (stack.length) unfold();
  else page.hidden = true;
  onNavigate();
}

// Leave every screen and return to the main screen.
function closePages() {
  stack = [];
  page.hidden = true;
  onNavigate();
}

// Windows unfold when you arrive at a screen, not on every redraw.
function unfold() {
  body.classList.add('unfold');
  setTimeout(() => body.classList.remove('unfold'), 250);
}

export function renderPage() {
  const top = stack.at(-1);
  if (!top || page.hidden) return;
  PAGES[top.name](top.params);
}

const periodDates = (period) => `${formatDate(period.start)} – ${period.end ? formatDate(period.end) : 'ongoing'}`;
const periodName = (period) => (period.end ? `Period ${periodNumber(period)}` : 'Current Period');
const tone = (diffCents) => (diffCents >= 0 ? 'good' : 'bad'); // budget minus spent: under is good

// ---------- period summary ----------

function renderSummary({ periodId }) {
  const period = getPeriod(periodId);
  if (!period) {
    // e.g. after restoring a backup that doesn't contain it
    stack = [];
    page.hidden = true;
    return;
  }
  const isCurrent = !period.end;
  const spent = spentIn(period.id);
  const diff = period.budgetCents - spent;

  const groups = new Map();
  for (const expense of periodExpenses(period.id)) {
    if (!groups.has(expense.categoryId)) groups.set(expense.categoryId, []);
    groups.get(expense.categoryId).push(expense);
  }
  const rows = [...groups]
    .map(([id, items]) => ({
      category: getCategory(id) ?? { id, name: 'Unknown', color: '#888888' },
      items: items.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
      cents: totalUsd(items),
    }))
    .sort((a, b) => b.cents - a.cents);

  const budgetValue = el('span', { className: 'value', textContent: formatUsd(period.budgetCents) });
  if (isCurrent) {
    const edit = el('button', { className: 'link', textContent: 'Edit' });
    edit.addEventListener('click', () => showPage('budget', { mode: 'edit' }, { push: true }));
    budgetValue.append(edit);
  }

  const stats = panel('Budget',
    el('div', { className: 'stat' }, el('span', { textContent: 'Budget' }), budgetValue),
    el('div', { className: 'stat' }, el('span', { textContent: 'Spent' }), el('span', { className: 'value', textContent: formatUsd(spent) })),
    el('div', { className: `stat diff ${tone(diff)}` },
      el('span', { textContent: diff >= 0 ? 'Under budget' : 'Over budget' }),
      el('span', { className: 'value', textContent: formatDiff(diff) })),
  );

  const list = el('ul', { className: 'cat-list' });
  for (const row of rows) {
    const isOpen = expanded.has(row.category.id);
    const head = el('button', { className: 'cat-head', 'aria-expanded': String(isOpen) },
      colorDot(row.category.color),
      el('span', { className: 'name', textContent: row.category.name }),
      el('span', { className: 'pct', textContent: `${Math.round((row.cents / spent) * 100)}%` }),
      el('span', { className: 'value', textContent: formatUsd(row.cents) }),
      el('span', { className: 'chev', textContent: '›' }),
      gauge(row.cents / spent, row.category.color));
    head.addEventListener('click', () => {
      if (isOpen) expanded.delete(row.category.id);
      else expanded.add(row.category.id);
      renderPage();
    });
    list.append(el('li', { className: isOpen ? 'open' : '' }, head,
      isOpen && el('ul', { className: 'items' }, ...row.items.map(itemRow))));
  }

  const remove = el('button', { className: 'wide-btn delete-btn', textContent: 'Delete period' });
  remove.addEventListener('click', () => removePeriod(period));

  fill(periodName(period), periodDates(period),
    panel('Spent', donut(rows.map((r) => ({ value: r.cents, color: r.category.color })), spent)),
    stats,
    panel('Categories', rows.length ? list : note('No expenses yet.')),
    remove,
  );
}

// Asks first: this deletes every expense in the period. Undo is offered afterwards too.
function removePeriod(period) {
  const name = periodName(period);
  const count = periodExpenses(period.id).length;
  const what = `${name} and its ${count} expense${count === 1 ? '' : 's'}`;
  const reopens = !period.end && state.periods.length > 1;
  if (!confirm(`Delete ${what}?${reopens ? ' The previous period becomes current again.' : ''}`)) return;
  takeSnapshot(`before deleting ${name}`);
  goBack(); // leave this summary first; it can't be shown once its period is gone
  const undo = deletePeriod(period.id);
  if (!currentPeriod()) showPage('budget', { mode: 'first' }); // that was the only period
  toast(`${name} deleted`, undo);
}

function itemRow(expense) {
  const amount = el('span', { className: 'much', textContent: formatUsd(expense.usdCents) });
  const { original } = expense;
  if (original && original.currency !== HOME) {
    amount.append(el('span', { className: 'orig', textContent: `from ${formatMoney(original.amount, original.currency)}` }));
  }
  const row = el('button', { className: 'item' },
    el('span', { className: 'when', textContent: formatDate(expense.date) }),
    el('span', { className: `what${expense.note ? '' : ' muted'}`, textContent: expense.note || 'No note' }),
    amount);
  row.addEventListener('click', () => openExpenseSheet(expense));
  return el('li', {}, row);
}

// Ring chart drawn as one SVG circle per category, each dashed to cover its share. A shading
// overlay makes it a rounded tube, with a soft dark outline on both edges.
function donut(slices, total) {
  const r = 40, width = 14;
  const [inner, outer] = [r - width / 2, r + width / 2];
  const circumference = 2 * Math.PI * r;
  const sum = slices.reduce((s, slice) => s + slice.value, 0);
  const gap = slices.length > 1 ? 0.8 : 0;
  const chart = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  // Across the ring's width: shadow at the inner edge, highlight just past the middle, shadow outside.
  const shade = svg('radialGradient', { id: 'donut-shade', gradientUnits: 'userSpaceOnUse', cx: 50, cy: 50, r: outer });
  for (const [at, color, opacity] of [[inner, '#000', 0.4], [r - 2, '#fff', 0.05], [r + 2, '#fff', 0.32], [outer - 2, '#fff', 0.05], [outer, '#000', 0.35]]) {
    shade.append(svg('stop', { offset: (at / outer).toFixed(3), 'stop-color': color, 'stop-opacity': opacity }));
  }
  chart.append(svg('defs'), svg('circle', { class: 'ring', cx: 50, cy: 50, r, fill: 'none', 'stroke-width': width }));
  chart.firstChild.append(shade);
  let offset = 0;
  for (const slice of slices) {
    const length = (slice.value / sum) * circumference;
    chart.append(svg('circle', {
      class: 'slice', cx: 50, cy: 50, r, fill: 'none', stroke: slice.color, 'stroke-width': width,
      'stroke-dasharray': `${Math.max(length - gap, 0.01)} ${circumference}`,
      'stroke-dashoffset': -offset,
      transform: 'rotate(-90 50 50)',
    }));
    offset += length;
  }
  chart.append(
    svg('circle', { cx: 50, cy: 50, r, fill: 'none', stroke: 'url(#donut-shade)', 'stroke-width': width }),
    svg('circle', { cx: 50, cy: 50, r: outer - 0.3, fill: 'none', stroke: '#000', 'stroke-opacity': 0.45, 'stroke-width': 0.6 }),
    svg('circle', { cx: 50, cy: 50, r: inner + 0.3, fill: 'none', stroke: '#000', 'stroke-opacity': 0.45, 'stroke-width': 0.6 }),
  );
  return el('div', { className: 'donut' }, chart,
    el('div', { className: 'donut-center' },
      el('strong', { textContent: formatUsd(total) }),
      el('span', { textContent: 'spent' })));
}

// ---------- list of periods ----------

function renderPeriods() {
  const rows = [...state.periods].reverse().map((period) => {
    const spent = spentIn(period.id);
    const diff = period.budgetCents - spent;
    const row = el('button', { className: `period-row${period.end ? '' : ' current'}` },
      el('span', {}, el('strong', { textContent: periodName(period) }), el('small', { textContent: periodDates(period) })),
      el('span', { className: 'right' },
        el('span', { textContent: `${formatUsd(spent)} of ${formatUsd(period.budgetCents)}` }),
        el('small', { className: tone(diff), textContent: formatDiff(diff) })));
    row.addEventListener('click', () => showPage('summary', { periodId: period.id }, { push: true }));
    return row;
  });
  fill('Past Periods', 'Select a period to see its summary.', ...rows,
    state.periods.length < 2 && note('Past periods show up here after you start a new period.'));
}

// ---------- categories ----------

function renderCategories() {
  const active = activeCategories();
  const list = panel('Categories');

  for (const category of active) {
    const name = el('input', { type: 'text', value: category.name, enterKeyHint: 'done', 'aria-label': 'Category name' });
    name.dataset.id = category.id;
    name.addEventListener('keydown', (event) => { if (event.key === 'Enter') name.blur(); });
    name.addEventListener('change', () => {
      const value = name.value.trim();
      const clash = categoryNamed(value);
      if (clash && clash.id !== category.id) {
        toast(`There's already ${clash.archived ? 'an archived' : 'a'} category called ${clash.name}${clash.archived ? '. Restore it instead' : ''}.`);
        name.value = category.name;
      } else if (value && value !== category.name) {
        updateCategory(category.id, { name: value });
      } else {
        name.value = category.name;
      }
    });

    const remove = el('button', { className: 'mini', textContent: '✕', 'aria-label': `Remove ${category.name}` });
    remove.addEventListener('click', () => {
      if (active.length === 1) {
        toast('You need at least one category.');
        return;
      }
      const undo = removeCategory(category.id);
      toast(`${category.name} ${getCategory(category.id) ? 'archived' : 'deleted'}`, undo);
    });

    list.append(el('div', { className: 'cat-row' }, colorDot(category.color), name, remove));
  }

  const addButton = el('button', { className: 'wide-btn', textContent: 'Add category' });
  addButton.addEventListener('click', () => {
    const { id } = addCategory();
    // Categories are alphabetical, so find the new one's name field and select it for typing.
    [...body.querySelectorAll('.cat-row input')].find((input) => input.dataset.id === id)?.select();
  });

  const archived = sortedCategories().filter((c) => c.archived);
  const archivedPanel = archived.length > 0 && panel('Archived',
    ...archived.map((category) => {
      const restore = el('button', { className: 'link', textContent: 'Restore' });
      restore.addEventListener('click', () => updateCategory(category.id, { archived: false }));
      return el('div', { className: 'cat-row' }, colorDot(category.color), el('span', { className: 'grow', textContent: category.name }), restore);
    }));

  fill('Categories', 'Tap a name to rename it.', list, addButton, archivedPanel,
    note('Colors follow alphabetical order. Removing a category that has expenses archives it, so past summaries stay intact.'));
}

// ---------- backup ----------

function renderBackup() {
  const status = backupStatus();

  const backupButton = el('button', { className: 'wide-btn', textContent: 'Export backup' });
  backupButton.addEventListener('click', exportBackup);

  const csvButton = el('button', { className: 'wide-btn', textContent: 'Export spreadsheet (CSV)' });
  csvButton.addEventListener('click', exportCsv);

  const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    file.value = '';
    if (!chosen) return;
    const { data, error } = await readBackup(chosen);
    if (error) {
      toast(error);
      return;
    }
    if (!confirm(`Replace everything in the app with this backup (${data.periods.length} periods, ${data.expenses.length} expenses)?`)) return;
    restoreBackup(data);
    toast('Backup restored');
    if (!currentPeriod()) showPage('budget', { mode: 'first' });
  });
  const restore = el('label', { className: 'wide-btn' }, 'Restore from backup', file);

  // Whether the browser agreed to protect this app's storage from automatic cleanup.
  const storage = note(''); // filled in once the browser answers
  navigator.storage?.persisted?.().then((protectedStorage) => {
    storage.textContent = protectedStorage
      ? 'Storage: protected from automatic cleanup.'
      : 'Storage: standard. iOS may clear it if the phone runs very low on space.';
  }).catch(() => {});

  // Fills in once IndexedDB answers.
  const snapshotList = el('div');
  readSnapshots().then((list) => snapshotList.replaceChildren(...list.map((snapshot) => {
    const when = formatMoment(snapshot.at);
    const goBackButton = el('button', { className: 'link', textContent: 'Go back' });
    goBackButton.addEventListener('click', async () => {
      if (!confirm(`Go back to how everything was ${when} (${snapshot.reason})? Your current data is snapshotted first, so you can undo this.`)) return;
      if (await restoreSnapshot(snapshot.at)) toast(`Back to ${when}`);
    });
    return el('div', { className: 'snapshot-row' },
      el('span', { className: 'grow' }, el('span', { textContent: when }), el('small', { textContent: snapshot.reason })),
      goBackButton);
  })));

  fill('Backup', 'Keep a copy of your data somewhere safe.',
    panel('Status',
      el('p', { className: `backup-status${status.stale ? ' bad' : ''}`, textContent: status.label }),
      reminderChoice(),
      el('p', { className: 'hint', textContent: 'Your data lives only on this phone, inside this home-screen app (separate from Safari). Deleting the app from your home screen erases it, so export a backup now and then and keep it in Files or iCloud Drive.' })),
    backupButton,
    csvButton,
    restore,
    note('Restoring replaces everything in the app with the backup.'),
    panel('Snapshots',
      snapshotList,
      el('p', { className: 'hint', textContent: 'Kept on this phone automatically: one a day, and one before anything drastic. For undoing mistakes; they\u2019re lost with the phone, unlike exported backups.' })),
    storage,
  );
}

// "Remind me to back up after: 7 · 14 · 30 · 60 days", in the FF8 Config style.
function reminderChoice() {
  const choices = REMINDER_CHOICES.map((days) => {
    const choice = el('button', { className: days === state.settings.backupReminderDays ? 'on' : '', textContent: String(days), 'aria-label': `${days} days` });
    choice.addEventListener('click', () => setBackupReminder(days));
    return choice;
  });
  return el('div', { className: 'reminder' },
    el('span', { className: 'label', textContent: 'Remind me to back up after' }),
    el('div', { className: 'reminder-row' }, el('div', { className: 'options' }, ...choices), el('span', { textContent: 'days' })));
}

// ---------- budget: first budget, New Period, edit budget ----------

const BUDGET_SCREENS = {
  first: {
    title: 'First Budget',
    help: () => 'Set a budget to start your first period.',
    button: 'Start period',
  },
  new: {
    title: 'New Period',
    help: (current) => `Ends the period that started ${formatDate(current.start)} and starts a new one.`,
    button: 'Start new period',
  },
  edit: {
    title: 'Edit Budget',
    help: () => "Changes this period's budget only.",
    button: 'Save',
  },
};

function renderBudget({ mode }) {
  const current = currentPeriod();
  if (!current) mode = 'first';
  const screen = BUDGET_SCREENS[mode];

  const amount = el('div', { className: `budget-amount${budgetDigits ? '' : ' empty'}`, textContent: formatUsd(Number(budgetDigits || '0')) });
  const pad = keypad(() => budgetDigits, (next) => {
    budgetDigits = next;
    renderPage();
  }, () => 8);

  const confirmButton = el('button', { className: 'primary', textContent: screen.button, disabled: !budgetDigits });
  confirmButton.addEventListener('click', () => {
    const cents = Number(budgetDigits || '0');
    if (!cents) return;
    if (mode === 'edit') {
      setBudget(current.id, cents);
      goBack(); // to the summary it was opened from
      toast(`Budget set to ${formatUsd(cents)}`);
    } else {
      startPeriod(cents);
      closePages();
      toast(`New period started · ${formatUsd(cents)}`);
    }
  });

  // A natural moment to back up: once per paycheck, right before closing a period.
  let backupButton = null;
  if (mode === 'new') {
    backupButton = el('button', { className: 'wide-btn', textContent: budgetBackedUp ? 'Backed up ✓' : 'Back up first', disabled: budgetBackedUp });
    backupButton.addEventListener('click', async () => {
      if (!(await exportBackup())) return;
      budgetBackedUp = true;
      renderPage();
    });
  }

  fill(screen.title, screen.help(current), panel('Budget', amount), pad, backupButton, confirmButton);
}
