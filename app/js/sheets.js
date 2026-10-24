// Sheets: small windows over the screen for quick edits (editing an expense, the category grid).

import { activeCategories, sortedCategories, updateExpense, deleteExpense } from './store.js';
import { CURRENCIES, HOME, formatMoney, formatUsd, plainAmount, parseAmount, toUsdCents } from './money.js';
import { $, el, nudge } from './ui.js';
import { toast } from './help.js';
import { categoryChip } from './widgets.js';

// label: the small tab on the sheet's top edge, like FF8's "HELP" / "STATUS" tabs.
// anchor: optional element. The sheet then opens with its top edge level with the anchor's top
// (moving up only as far as it must to stay on screen) instead of at the bottom of the screen.
export function openSheet(content, { dismissable = true, label = '', anchor = null } = {}) {
  const sheet = $('sheet');
  sheet.dataset.label = label;
  sheet.replaceChildren(content);
  sheet.scrollTop = 0;
  sheet.style.top = '';
  sheet.style.bottom = '';
  if (anchor) {
    const margin = 8;
    const lowestTop = window.innerHeight - sheet.offsetHeight - margin;
    sheet.style.top = `${Math.max(margin, Math.min(anchor.getBoundingClientRect().top, lowestTop))}px`;
    sheet.style.bottom = 'auto';
  }
  const backdrop = $('sheet-backdrop');
  backdrop.classList.add('open');
  backdrop.onclick = dismissable ? (event) => { if (event.target === backdrop) closeSheet(); } : null;
}

export function closeSheet() {
  $('sheet-backdrop').classList.remove('open');
  document.activeElement?.blur();
}

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
  const categories = activeCategories();
  const grid = el('div', { className: 'grid' }, ...categories.map((category) => {
    const chip = categoryChip(category, { selected: category.id === selectedId });
    chip.addEventListener('click', () => {
      closeSheet();
      onPick(category.id);
    });
    return chip;
  }));
  // Two columns, filled top to bottom (left column first), so the list reads alphabetically downward.
  grid.style.setProperty('--rows', Math.ceil(categories.length / 2));
  openSheet(grid, { label: 'Category', anchor });
}
