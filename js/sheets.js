// Bottom sheets: setting a budget, editing an expense, and the category grid.

import { currentPeriod, startPeriod, setBudget, activeCategories, sortedCategories, updateExpense, deleteExpense } from './store.js';
import { formatUsd, pesosToUsdCents } from './money.js';
import { el, keypad, openSheet, closeSheet, toast, nudge, formatDate, categoryChip } from './ui.js';
import { exportBackup } from './backup.js';

const BUDGET_TEXT = {
  first: {
    title: 'Set your first budget',
    hint: () => 'This starts your first period. Start a new one from the menu whenever you get paid.',
    button: 'Start period',
  },
  new: {
    title: 'New Period',
    hint: (current) => `This ends the current period (started ${formatDate(current.start)}) today and starts a new one with this budget.`,
    button: 'Start new period',
  },
  edit: {
    title: 'Edit budget',
    hint: () => 'Changes the budget for the current period only.',
    button: 'Save',
  },
};

// mode: 'first' | 'new' | 'edit'
export function openBudgetSheet(mode) {
  const current = currentPeriod();
  if (!current) mode = 'first';
  const text = BUDGET_TEXT[mode];
  let digits = mode === 'edit' ? String(current.budgetCents) : '';

  const display = el('div', { className: 'sheet-amount' });
  const confirm = el('button', { className: 'primary', textContent: text.button });
  const update = () => {
    display.textContent = formatUsd(Number(digits || '0'));
    display.classList.toggle('empty', !digits);
    confirm.disabled = !digits;
  };
  const pad = keypad(() => digits, (next) => {
    digits = next;
    update();
  }, () => 8);

  confirm.addEventListener('click', () => {
    const cents = Number(digits || '0');
    if (!cents) return;
    closeSheet();
    if (mode === 'edit') setBudget(current.id, cents);
    else startPeriod(cents);
    toast(mode === 'edit' ? `Budget set to ${formatUsd(cents)}` : `New Period started · ${formatUsd(cents)}`);
  });

  const actions = el('div', { className: 'actions' });
  if (mode !== 'first') {
    const cancel = el('button', { className: 'secondary', textContent: 'Cancel' });
    cancel.addEventListener('click', closeSheet);
    actions.append(cancel);
  }
  actions.append(confirm);

  // A natural moment to back up: once per paycheck, right before closing a period.
  let backupButton = null;
  if (mode === 'new') {
    backupButton = el('button', { className: 'wide-btn', textContent: 'Back up first' });
    backupButton.addEventListener('click', async () => {
      if (!(await exportBackup())) return;
      backupButton.textContent = 'Backed up ✓';
      backupButton.disabled = true;
    });
  }

  update();
  openSheet(el('div', {},
    el('h2', { textContent: text.title }),
    el('p', { className: 'hint', textContent: text.hint(current) }),
    display,
    pad,
    backupButton,
    actions,
  ), { dismissable: mode !== 'first', label: 'Budget' });
}

export function openExpenseSheet(expense) {
  const mxn = expense.original?.currency === 'MXN' ? expense.original : null;

  const amount = el('input', {
    type: 'text',
    inputMode: mxn ? 'numeric' : 'decimal',
    value: mxn ? String(mxn.amount) : (expense.usdCents / 100).toFixed(2),
  });
  const category = el('select', {}, ...sortedCategories()
    .filter((c) => !c.archived || c.id === expense.categoryId)
    .map((c) => el('option', { value: c.id, textContent: c.archived ? `${c.name} (archived)` : c.name })));
  category.value = expense.categoryId;
  const date = el('input', { type: 'date', value: expense.date });
  const note = el('input', { type: 'text', value: expense.note, placeholder: 'Optional' });

  const saveButton = el('button', { className: 'primary', textContent: 'Save' });
  saveButton.addEventListener('click', () => {
    const raw = Number(amount.value.replace(/[^0-9.]/g, ''));
    const changes = { categoryId: category.value, date: date.value || expense.date, note: note.value.trim() };
    if (mxn) {
      const pesos = Math.round(raw);
      if (!(pesos > 0)) return nudge(amount);
      changes.original = { ...mxn, amount: pesos };
      changes.usdCents = pesosToUsdCents(pesos, mxn.mxnPerUsd);
    } else {
      const cents = Math.round(raw * 100);
      if (!(cents > 0)) return nudge(amount);
      changes.usdCents = cents;
    }
    closeSheet();
    updateExpense(expense.id, changes);
  });

  const deleteButton = el('button', { className: 'danger', textContent: 'Delete' });
  deleteButton.addEventListener('click', () => {
    closeSheet();
    toast('Expense deleted', deleteExpense(expense.id));
  });

  const field = (label, input) => el('label', { className: 'field' }, el('span', { textContent: label }), input);
  openSheet(el('div', {},
    el('h2', { textContent: 'Edit expense' }),
    mxn && el('p', { className: 'hint', textContent: `Entered in pesos at ${mxn.mxnPerUsd.toFixed(2)} MXN per USD (${formatUsd(expense.usdCents)}).` }),
    field(mxn ? 'Amount (MXN)' : 'Amount (USD)', amount),
    field('Category', category),
    field('Date', date),
    field('Note', note),
    el('div', { className: 'actions' }, deleteButton, saveButton),
  ), { label: 'Expense' });
}

export function openCategoryGrid(selectedId, onPick) {
  const grid = el('div', { className: 'grid' }, ...activeCategories().map((category) => {
    const chip = categoryChip(category, { selected: category.id === selectedId });
    chip.addEventListener('click', () => {
      closeSheet();
      onPick(category.id);
    });
    return chip;
  }));
  openSheet(el('div', {}, el('h2', { textContent: 'Category' }), grid), { label: 'Category' });
}
