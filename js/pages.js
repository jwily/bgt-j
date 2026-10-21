// Secondary screens behind the menu: period summaries, the list of periods, categories, backup.
// Each screen sets its title (shown in the top-right title window) and its HELP line, then
// fills the page with labelled windows.

import {
  state, currentPeriod, getPeriod, periodNumber, periodExpenses, spentIn, totalUsd, getCategory, activeCategories, sortedCategories, PALETTE,
  addCategory, updateCategory, removeCategory, todayISO,
} from './store.js';
import { formatUsd, formatMxn, formatDiff } from './money.js';
import { el, svg, toast, setHelp, formatDate, colorDot, gauge } from './ui.js';
import { openBudgetSheet, openExpenseSheet } from './sheets.js';
import { exportBackup, exportCsv, readBackup, restoreBackup, backupStatus } from './backup.js';

const page = document.getElementById('page');
const body = document.getElementById('page-body');

const PAGES = { summary: renderSummary, periods: renderPeriods, categories: renderCategories, backup: renderBackup };

let stack = [];               // [{ name, params }], so Back returns to the previous screen
let title = '';               // the showing screen's name, for the title window
const expanded = new Set();   // category ids opened on the summary screen
let paletteFor = null;        // category id whose color choices are showing
let onNavigate = () => {};    // redraws the app after showing or leaving a screen

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

// push: keep the current screen underneath (Back returns to it).
export function showPage(name, params = {}, { push = false } = {}) {
  stack = push ? [...stack, { name, params }] : [{ name, params }];
  expanded.clear();
  paletteFor = null;
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

// "Oct 20" this year, "Oct 20, 2025" otherwise (keeps the HELP line short).
const longDate = (iso) => formatDate(iso, iso.startsWith(todayISO().slice(0, 4))
  ? { month: 'short', day: 'numeric' }
  : { month: 'short', day: 'numeric', year: 'numeric' });
const periodDates = (period) => `${longDate(period.start)} – ${period.end ? longDate(period.end) : 'ongoing'}`;
const periodName = (period) => (period.end ? `Period ${periodNumber(period)}` : 'Current Period');

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
    edit.addEventListener('click', () => openBudgetSheet('edit'));
    budgetValue.append(edit);
  }

  const stats = panel('Budget',
    el('div', { className: 'stat' }, el('span', { textContent: 'Budget' }), budgetValue),
    el('div', { className: 'stat' }, el('span', { textContent: 'Spent' }), el('span', { className: 'value', textContent: formatUsd(spent) })),
    el('div', { className: `stat diff ${diff >= 0 ? 'good' : 'bad'}` },
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

  fill(periodName(period), periodDates(period),
    panel('Spent', donut(rows.map((r) => ({ value: r.cents, color: r.category.color })), spent)),
    stats,
    panel('Categories', rows.length ? list : el('p', { className: 'empty-note', textContent: 'No expenses yet.' })),
  );
}

function itemRow(expense) {
  const amount = el('span', { className: 'much', textContent: formatUsd(expense.usdCents) });
  if (expense.original?.currency === 'MXN') {
    amount.append(el('span', { className: 'orig', textContent: `from ${formatMxn(expense.original.amount)}` }));
  }
  const row = el('button', { className: 'item' },
    el('span', { className: 'when', textContent: formatDate(expense.date) }),
    el('span', { className: `what${expense.note ? '' : ' muted'}`, textContent: expense.note || 'No note' }),
    amount);
  row.addEventListener('click', () => openExpenseSheet(expense));
  return el('li', {}, row);
}

// Ring chart drawn as one SVG circle per category, each dashed to cover its share.
function donut(slices, total) {
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const sum = slices.reduce((s, slice) => s + slice.value, 0);
  const gap = slices.length > 1 ? 0.8 : 0;
  const chart = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  chart.append(svg('circle', { class: 'ring', cx: 50, cy: 50, r, fill: 'none', 'stroke-width': 14 }));
  let offset = 0;
  for (const slice of slices) {
    const length = (slice.value / sum) * circumference;
    chart.append(svg('circle', {
      cx: 50, cy: 50, r, fill: 'none', stroke: slice.color, 'stroke-width': 14,
      'stroke-dasharray': `${Math.max(length - gap, 0.01)} ${circumference}`,
      'stroke-dashoffset': -offset,
      transform: 'rotate(-90 50 50)',
    }));
    offset += length;
  }
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
        el('small', { className: diff >= 0 ? 'good' : 'bad', textContent: formatDiff(diff) })));
    row.addEventListener('click', () => showPage('summary', { periodId: period.id }, { push: true }));
    return row;
  });
  fill('Periods', 'Select a period to see its summary.', ...rows,
    state.periods.length < 2 && el('p', { className: 'empty-note', textContent: 'Past Periods show up here after you start a New Period.' }));
}

// ---------- categories ----------

function renderCategories() {
  const active = activeCategories();
  const list = panel('Categories');

  for (const category of active) {
    const swatch = el('button', { className: 'swatch', 'aria-label': `Color for ${category.name}` });
    swatch.style.setProperty('--c', category.color);
    swatch.addEventListener('click', () => {
      paletteFor = paletteFor === category.id ? null : category.id;
      renderPage();
    });

    const name = el('input', { type: 'text', value: category.name, enterKeyHint: 'done', 'aria-label': 'Category name' });
    name.dataset.id = category.id;
    name.addEventListener('keydown', (event) => { if (event.key === 'Enter') name.blur(); });
    name.addEventListener('change', () => {
      const value = name.value.trim();
      if (value && value !== category.name) updateCategory(category.id, { name: value });
      else name.value = category.name;
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

    list.append(el('div', { className: 'cat-row' }, swatch, name, remove));
    if (paletteFor === category.id) list.append(palette(category));
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

  fill('Categories', 'Tap a color to change it.', list, addButton, archivedPanel,
    el('p', { className: 'empty-note', textContent: 'Removing a category that has expenses archives it, so past summaries stay intact.' }));
}

function palette(category) {
  return el('div', { className: 'palette' }, ...PALETTE.map((color) => {
    const choice = el('button', { className: color === category.color ? 'selected' : '', 'aria-label': `Use color ${color}` });
    choice.style.setProperty('--c', color);
    choice.addEventListener('click', () => {
      paletteFor = null;
      updateCategory(category.id, { color });
    });
    return choice;
  }));
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
    const data = await readBackup(chosen);
    if (!data) {
      toast("That file isn't a budget backup.");
      return;
    }
    if (!confirm(`Replace everything in the app with this backup (${data.periods.length} periods, ${data.expenses.length} expenses)?`)) return;
    restoreBackup(data);
    toast('Backup restored');
    if (!currentPeriod()) openBudgetSheet('first');
  });
  const restore = el('label', { className: 'wide-btn' }, 'Restore from backup', file);

  // Whether the browser agreed to protect this app's storage from automatic cleanup.
  const storage = el('p', { className: 'empty-note' });
  navigator.storage?.persisted?.().then((protectedStorage) => {
    storage.textContent = protectedStorage
      ? 'Storage: protected from automatic cleanup.'
      : 'Storage: standard. iOS may clear it if the phone runs very low on space.';
  }).catch(() => {});

  fill('Backup', 'Keep a copy of your data somewhere safe.',
    panel('Status',
      el('p', { className: `backup-status${status.stale ? ' bad' : ''}`, textContent: status.label }),
      el('p', { className: 'hint', textContent: 'Your data lives only on this phone. Deleting the app from your home screen or clearing Safari’s website data erases it, so export a backup now and then and keep it in Files or iCloud Drive.' })),
    backupButton,
    csvButton,
    restore,
    el('p', { className: 'empty-note', textContent: 'Restoring replaces everything in the app with the backup.' }),
    storage,
  );
}
