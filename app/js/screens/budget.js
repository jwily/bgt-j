// The budget screen: first budget, New Period, and edit budget.

import { currentPeriod, startPeriod, setBudget } from '../store.js';
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

export function enter({ mode }) {
  budgetDigits = mode === 'edit' ? String(currentPeriod().budgetCents) : '';
  budgetBackedUp = false;
}

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

export function render({ mode }) {
  const current = currentPeriod();
  if (!current) mode = 'first';
  else if (mode === 'first') {
    // A period again (Undo after deleting the only one): nothing to set up any more.
    hidePages();
    return;
  }
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
  }, () => CURRENCIES[HOME].maxDigits); // budgets are in dollars

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

  fill(screen.title, screen.help(current), panel('Budget', amount), pad, backupButton, confirmButton);
}
