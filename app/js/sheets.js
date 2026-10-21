// Bottom sheets: editing an expense, and the category grid.

import { activeCategories, sortedCategories, updateExpense, deleteExpense } from './store.js';
import { CURRENCIES, HOME, formatMoney, formatUsd, plainAmount, parseAmount, toUsdCents } from './money.js';
import { el, openSheet, closeSheet, toast, nudge, categoryChip } from './ui.js';

export function openExpenseSheet(expense) {
  // Expenses entered in another currency are edited in that currency, at the rate saved with them.
  const foreign = expense.original && expense.original.currency !== HOME ? expense.original : null;
  const currency = foreign?.currency ?? HOME;

  const amount = el('input', {
    type: 'text',
    inputMode: CURRENCIES[currency].decimals ? 'decimal' : 'numeric',
    value: plainAmount(foreign ? foreign.amount : expense.usdCents, currency),
  });
  const category = el('select', {}, ...sortedCategories()
    .filter((c) => !c.archived || c.id === expense.categoryId)
    .map((c) => el('option', { value: c.id, textContent: c.archived ? `${c.name} (archived)` : c.name })));
  category.value = expense.categoryId;
  const date = el('input', { type: 'date', value: expense.date });
  const note = el('input', { type: 'text', value: expense.note, placeholder: 'Optional' });

  const saveButton = el('button', { className: 'primary', textContent: 'Save' });
  saveButton.addEventListener('click', () => {
    const units = parseAmount(amount.value, currency);
    if (!(units > 0)) return nudge(amount);
    const changes = { categoryId: category.value, date: date.value || expense.date, note: note.value.trim() };
    if (foreign) {
      changes.original = { ...foreign, amount: units };
      changes.usdCents = toUsdCents(units, currency, foreign.perUsd);
    } else {
      changes.usdCents = units;
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
    el('h2', { textContent: 'Edit Expense' }),
    foreign && el('p', { className: 'hint', textContent: `Entered as ${formatMoney(foreign.amount, currency)} at ${foreign.perUsd.toFixed(2)} ${currency} per ${HOME} (${formatUsd(expense.usdCents)}).` }),
    field(`Amount (${currency})`, amount),
    field('Category', category),
    field('Date', date),
    field('Note', note),
    el('div', { className: 'actions' }, deleteButton, saveButton),
  ), { label: 'Expense' });
}

// anchor: the element the grid opens level with (the category strip).
export function openCategoryGrid(selectedId, onPick, anchor) {
  const grid = el('div', { className: 'grid' }, ...activeCategories().map((category) => {
    const chip = categoryChip(category, { selected: category.id === selectedId });
    chip.addEventListener('click', () => {
      closeSheet();
      onPick(category.id);
    });
    return chip;
  }));
  openSheet(grid, { label: 'Category', anchor });
}
