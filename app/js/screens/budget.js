// The budget screen: first budget, New Period, and edit budget (any period's, current or past).

import { currentPeriod, getPeriod, startPeriod, setBudget } from '../store.js';
import { CURRENCIES, HOME, formatUsd } from '../money.js';
import { el } from '../ui.js';
import { toast } from '../help.js';
import { keypad } from '../widgets.js';
import { formatDate } from '../dates.js';
import { exportBackup } from '../backup.js';
import { assemble } from '../party.js';
import { fill, panel, goBack, closePages, hidePages, renderPage } from '../pages.js';

let budgetDigits = '';        // what's typed (kept across redraws)
let budgetBackedUp = false;   // whether "Back up first" succeeded
let editHow = 'add';          // editing: 'add' to the budget (what it's mostly for) or 'set' it outright

// Editing, the digits start empty to add to the budget, or as the budget itself to set it.
const startDigits = (period) => (editHow === 'set' ? String(period.budgetCents) : '');

export function enter({ mode, periodId }) {
  editHow = 'add';
  budgetDigits = mode === 'edit' ? startDigits(getPeriod(periodId)) : '';
  budgetBackedUp = false;
}

// Editing: the two ways, as FF8 Config-style choices.
const EDIT_WAYS = { add: 'Add', set: 'Set' };

const BUDGET_SCREENS = {
  first: {
    title: 'First Budget',
    help: () => 'Set a budget to start your first period.',
    button: () => 'Start period',
  },
  new: {
    title: 'New Period',
    help: (current) => `Ends the period that started ${formatDate(current.start)} and starts a new one.`,
    button: () => 'Start new period',
  },
  edit: {
    title: 'Edit Budget',
    help: () => (editHow === 'add' ? "Adds to this period's budget." : "Changes this period's budget only."),
    button: () => (editHow === 'add' ? 'Add to budget' : 'Save'),
  },
};

export function render({ mode, periodId }) {
  const current = currentPeriod();
  if (!current) mode = 'first';
  else if (mode === 'first') {
    // A period again (Undo after deleting the only one): nothing to set up any more.
    hidePages();
    return;
  }
  const period = mode === 'edit' ? getPeriod(periodId) : current; // none yet for a first budget
  if (mode === 'edit' && !period) {
    // e.g. deleted by an Undo, or a restored backup without it
    hidePages();
    return;
  }
  const screen = BUDGET_SCREENS[mode];
  const adding = mode === 'edit' && editHow === 'add';
  const budgetFrom = (cents) => (adding ? period.budgetCents + cents : cents);

  const amount = el('div', { className: 'budget-amount' });
  const after = mode === 'edit' && el('div', { className: 'budget-after' });
  const confirmButton = el('button', { className: 'primary', textContent: screen.button() });
  // Typing updates just the amount and the button, not the whole screen, so the button's hand
  // keeps bobbing smoothly instead of restarting with every digit.
  const showDigits = () => {
    const cents = Number(budgetDigits || '0');
    amount.textContent = `${adding ? '+' : ''}${formatUsd(cents)}`;
    amount.classList.toggle('empty', !budgetDigits);
    if (after) after.textContent = `${formatUsd(period.budgetCents)} → ${formatUsd(budgetFrom(cents))}`;
    confirmButton.disabled = !budgetDigits;
  };
  showDigits();
  const pad = keypad(() => budgetDigits, (next) => {
    budgetDigits = next;
    showDigits();
  }, () => CURRENCIES[HOME].maxDigits); // budgets are in dollars

  confirmButton.addEventListener('click', () => {
    const cents = Number(budgetDigits || '0');
    if (!cents) return;
    if (mode === 'edit') {
      const budget = budgetFrom(cents); // before saving: adding goes from the budget as it was
      const undo = setBudget(period.id, budget);
      goBack(); // to the summary it was opened from
      toast(adding ? `Budget +${formatUsd(cents)} · now ${formatUsd(budget)}` : `Budget set to ${formatUsd(budget)}`, undo);
    } else {
      startPeriod(cents);
      closePages();
      assemble(); // the whole party turns out for a new period
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

  let ways = null;
  if (mode === 'edit') {
    ways = el('div', { className: 'options budget-ways' }, ...Object.entries(EDIT_WAYS).map(([how, label]) => {
      const way = el('button', { className: how === editHow ? 'on' : '', textContent: label });
      way.addEventListener('click', () => {
        if (how === editHow) return;
        editHow = how;
        budgetDigits = startDigits(period);
        renderPage();
      });
      return way;
    }));
  }

  fill(screen.title, screen.help(current), panel('Budget', ways, amount, after), pad, backupButton, confirmButton);
}
