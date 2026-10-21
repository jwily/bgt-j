// Bottom sheets: editing an expense, and the category grid.

import { activeCategories, sortedCategories, updateExpense, deleteExpense } from './store.js';
import { formatUsd, pesosToUsdCents } from './money.js';
import { el, openSheet, closeSheet, toast, nudge, categoryChip } from './ui.js';

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
