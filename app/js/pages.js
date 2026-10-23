// Secondary screens: period summaries, the list of periods, categories, backup, and the budget
// screen (first budget, New Period, edit budget).
// Each screen sets its title (shown in the top-right title window) and its HELP line, then
// fills the page with labelled windows.

import {
  state, currentPeriod, getPeriod, periodNumber, periodExpenses, spentIn, totalUsd, getCategory, activeCategories, sortedCategories,
  saveCategories, categoryIsUsed, paletteColor, startPeriod, setBudget, deletePeriod, setBackupReminder,
} from './store.js';
import { HOME, formatMoney, formatUsd, formatDiff } from './money.js';
import { $, el, toast, setHelp, colorDot, gauge, keypad } from './ui.js';
import { formatDate, formatMoment } from './dates.js';
import { openExpenseSheet } from './sheets.js';
import { exportBackup, exportCsv, readBackup, restoreBackup, backupStatus, REMINDER_CHOICES } from './backup.js';
import { readSnapshots, takeSnapshot, restoreSnapshot } from './snapshots.js';

const page = $('page');
const body = $('page-body');

const PAGES = { summary: renderSummary, periods: renderPeriods, categories: renderCategories, backup: renderBackup, budget: renderBudget };

let stack = [];               // [{ name, params }], so Back returns to the previous screen
let title = '';               // the showing screen's name, for the title window
const expanded = new Set();   // category ids opened on the summary screen
let budgetDigits = '';        // what's typed on the budget screen (kept across redraws)
let budgetBackedUp = false;   // whether "Back up first" succeeded on the budget screen
let categoryDraft = null;     // the Categories screen's unsaved edits: [{ key, id, name, archived }]
let newCategoryKeys = 0;      // row keys for categories added in the draft (they have no id yet)
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
  const windows = nodes.filter((node) => node != null && node !== false);
  if (arrivingNext) windows.forEach((node) => node.classList.add('arriving'));
  arrivingNext = false;
  body.replaceChildren(...windows);
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
  if (name === 'categories') categoryDraft = null;
  page.hidden = false;
  page.scrollTop = 0;
  arrive();
  onNavigate();
}

export function goBack() {
  stack.pop();
  if (stack.length) arrive();
  else page.hidden = true;
  onNavigate();
}

// Leave every screen and return to the main screen.
function closePages() {
  stack = [];
  page.hidden = true;
  onNavigate();
}

// Windows fade in when you arrive at a screen, not on every redraw: only the windows the screen
// arrives with get the animation. (Marking the whole screen for a moment instead replayed it when
// something redrew the screen just after, like the exchange rate arriving on first launch.)
let arrivingNext = false;
function arrive() {
  arrivingNext = true;
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

  const stats = panel('Budget',
    el('div', { className: 'stat' }, el('span', { textContent: 'Budget' }), el('span', { className: 'value', textContent: formatUsd(period.budgetCents) })),
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

  // The screen's actions sit at the bottom, under the thumb; the safer one on the right, nearer it.
  const remove = el('button', { className: 'wide-btn delete-btn', textContent: 'Delete period' });
  remove.addEventListener('click', () => removePeriod(period));
  let edit = null;
  if (isCurrent) {
    edit = el('button', { className: 'wide-btn edit-budget', textContent: 'Edit budget' });
    edit.addEventListener('click', () => showPage('budget', { mode: 'edit' }, { push: true }));
  }

  fill(periodName(period), periodDates(period),
    panel('Spent', waveRing(rows.map((r) => ({ value: r.cents, color: r.category.color })), spent, period.budgetCents)),
    stats,
    panel('Categories', rows.length ? list : note('No expenses yet.')),
    el('div', { className: 'actions' }, remove, edit),
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

// The spending ring, after the bar of Squall's Renzokuken: each category a wave going clockwise
// from 12 o'clock, smallest first so the largest comes last, rising from black to its color at a
// hard leading edge (its clockwise end, so the last edge marks where spending stops). Drawn against
// the budget, so what's unspent stays black; over budget, against the spending, all of it waves.
// Arriving, the waves cascade: each travels clockwise from 12 o'clock to its place at much the same
// speed, the first setting off first and each next a moment later, sliding out from under the
// waves before it: about 1.6s for a typical period, never more than about 2s.
function waveRing(slices, total, budget) {
  const whole = Math.max(budget, total);
  const ordered = [...slices].sort((a, b) => a.value - b.value);
  const stagger = Math.min(0.14, 0.6 / Math.max(1, ordered.length - 1));
  let at = 0;
  const waves = ordered.map(({ value, color }, i) => {
    const from = (at / whole) * 360;
    at += value;
    const to = (at / whole) * 360;
    const wave = el('span', { className: 'wave' });
    const place = el('span', { className: 'wave-place' }, wave);
    place.style.cssText = `--to: ${to}deg; z-index: ${ordered.length - i}`;
    wave.style.cssText = `--c: ${color}; --from: ${from}deg; --len: ${to - from}deg; `
      + `--delay: ${(i * stagger).toFixed(3)}s; --dur: ${(0.5 + 0.9 * (to / 360)).toFixed(3)}s`;
    return place;
  });
  return el('div', { className: `ring-chart${total > budget ? ' over' : ''}` },
    el('div', { className: 'waves' }, ...waves),
    el('span', { className: 'tick' }),
    el('div', { className: 'ring-center' },
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

// The Categories screen edits a draft: renaming, adding, removing and restoring change only the
// draft, and Save applies it all at once, which sorts the categories alphabetically then and
// there. Colors always go by position down the list (GF order), in the draft as after saving.
const categoriesFromState = () => [...activeCategories(), ...sortedCategories().filter((c) => c.archived)]
  .map(({ id, name, archived }) => ({ key: id, id, name, archived }));
const sameCategories = (a, b) => JSON.stringify(a.map((c) => [c.id, c.name.trim(), c.archived]))
  === JSON.stringify(b.map((c) => [c.id, c.name.trim(), c.archived]));
const categoryDraftChanged = () => Boolean(categoryDraft) && !sameCategories(categoryDraft, categoriesFromState());

// Back from the Categories screen with unsaved changes asks first. Returns whether to leave.
export function confirmLeave() {
  if (stack.at(-1)?.name !== 'categories' || !categoryDraftChanged()) return true;
  if (!confirm('Discard your unsaved category changes?')) return false;
  categoryDraft = null;
  return true;
}

// Two categories can't share a name (ignoring capitalization), and names can't be empty. Returns
// the problem to show, or null.
function categoryDraftProblem() {
  const savedNames = new Map(categoriesFromState().map((c) => [c.id, c.name]));
  const unrenamed = (c) => c.id && savedNames.get(c.id) === c.name.trim();
  for (const [i, category] of categoryDraft.entries()) {
    const earlier = categoryDraft.slice(0, i).find((c) => c.name.trim().toLowerCase() === category.name.trim().toLowerCase());
    // Name the one that was already called that, not the one just renamed to it.
    const other = earlier && (unrenamed(earlier) || !unrenamed(category) ? earlier : category);
    if (other) return `There's already ${other.archived ? 'an archived' : 'a'} category called ${other.name.trim()}${other.archived ? '. Restore it instead' : ''}.`;
  }
  return null;
}

function renderCategories() {
  if (!categoryDraftChanged()) categoryDraft = categoriesFromState();
  const draft = categoryDraft;
  const active = draft.filter((c) => !c.archived);
  const archived = draft.filter((c) => c.archived);
  const dot = (category) => colorDot(paletteColor([...active, ...archived].indexOf(category)));
  const editDraft = (change) => {
    const before = draft.map((c) => ({ ...c }));
    const message = change();
    renderPage();
    if (message) toast(message, () => { categoryDraft = before; renderPage(); });
  };

  const saveButton = el('button', { className: 'primary', textContent: 'Save', disabled: !categoryDraftChanged() });
  saveButton.addEventListener('click', () => {
    // A category left blank is dropped: a new one just goes, an existing one is removed like with ✕
    // (saveCategories archives it if it has expenses, so past summaries keep it).
    const blank = draft.filter((c) => !c.name.trim());
    if (blank.length && draft.every((c) => c.archived || !c.name.trim())) {
      toast('You need at least one category.');
      return;
    }
    blank.forEach((category) => draft.splice(draft.indexOf(category), 1));
    const problem = categoryDraftProblem();
    if (problem) {
      toast(problem);
      return;
    }
    const undo = saveCategories(draft.map(({ id, name, archived: isArchived }) => ({ id, name, archived: isArchived })));
    categoryDraft = null;
    renderPage();
    toast('Categories saved', undo);
  });

  // Diamonds go by position down the screen; after a row is dropped in place, repaint them.
  const repaintDots = () => body.querySelectorAll('.cat-row .dot').forEach((old, i) => old.replaceWith(colorDot(paletteColor(i))));

  const list = panel('Categories', ...active.map((category) => {
    const name = el('input', { type: 'text', value: category.name, placeholder: 'New category', enterKeyHint: 'done', 'aria-label': 'Category name' });
    name.dataset.key = category.key;
    name.addEventListener('keydown', (event) => { if (event.key === 'Enter') name.blur(); });
    name.addEventListener('input', () => {
      category.name = name.value;
      saveButton.disabled = !categoryDraftChanged();
    });
    // Spaces at either end go when you finish typing the name (and are never saved).
    name.addEventListener('change', () => {
      name.value = name.value.trim();
      category.name = name.value;
    });
    // A new category still blank when the keyboard closes is dropped. Just its row goes, not the
    // whole screen redrawn, so a tap on Save that closed the keyboard still lands on Save.
    name.addEventListener('blur', () => {
      if (category.id || name.value.trim()) return;
      draft.splice(draft.indexOf(category), 1);
      name.closest('.cat-row').remove();
      repaintDots();
      saveButton.disabled = !categoryDraftChanged();
    });

    const remove = el('button', { className: 'mini', textContent: '✕', 'aria-label': `Remove ${category.name}` });
    remove.addEventListener('click', () => {
      if (draft.filter((c) => !c.archived && (c.id || c.name.trim())).length === 1) {
        toast('You need at least one category.');
        return;
      }
      editDraft(() => {
        draft.splice(draft.indexOf(category), 1);
        // One with expenses is archived, so past summaries keep it.
        if (category.id && categoryIsUsed(category.id)) {
          draft.push({ ...category, archived: true });
          return `${category.name.trim()} archived`;
        }
        return `${category.name.trim()} removed`;
      });
    });

    return el('div', { className: 'cat-row' }, dot(category), name, remove);
  }));

  const addButton = el('button', { className: 'wide-btn', textContent: 'Add category' });
  addButton.addEventListener('click', () => {
    const key = `new-${++newCategoryKeys}`;
    // New ones start blank and go after the other active categories, until Save sorts them.
    draft.splice(draft.filter((c) => !c.archived).length, 0, { key, id: null, name: '', archived: false });
    renderPage();
    // Bring the new row into view (a long list puts it below the buttons pinned at the bottom), then
    // type into it. Scrolling it ourselves rather than leaving it to focus(), which iOS doesn't do
    // reliably inside a scrolling screen.
    const field = body.querySelector(`.cat-row input[data-key="${key}"]`);
    field?.closest('.cat-row').scrollIntoView({ block: 'center' });
    field?.focus({ preventScroll: true });
  });

  const archivedPanel = archived.length > 0 && panel('Archived',
    ...archived.map((category) => {
      const restore = el('button', { className: 'link', textContent: 'Restore' });
      restore.addEventListener('click', () => editDraft(() => {
        draft.splice(draft.indexOf(category), 1);
        draft.splice(draft.filter((c) => !c.archived).length, 0, { ...category, archived: false });
      }));
      return el('div', { className: 'cat-row' }, dot(category), el('span', { className: 'grow', textContent: category.name }), restore);
    }));

  fill('Categories', 'Rename, add or remove, then save.', list, archivedPanel,
    note('Saving sorts categories alphabetically, and colors follow that order. Removing a category that has expenses archives it, so past summaries stay intact.'),
    el('div', { className: 'actions pinned' }, addButton, saveButton));
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

  const amount = el('div', { className: 'budget-amount' });
  const confirmButton = el('button', { className: 'primary', textContent: screen.button });
  // Typing updates just the amount and the button, not the whole screen, so the button's hand
  // keeps bobbing smoothly instead of restarting with every digit.
  const showDigits = () => {
    amount.textContent = formatUsd(Number(budgetDigits || '0'));
    amount.classList.toggle('empty', !budgetDigits);
    confirmButton.disabled = !budgetDigits;
  };
  showDigits();
  const pad = keypad(() => budgetDigits, (next) => {
    budgetDigits = next;
    showDigits();
  }, () => 8);

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
