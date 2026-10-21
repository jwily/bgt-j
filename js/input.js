// The main screen: type an amount, swipe to pick currency and category, tap Add.

import { state, todayISO, activeCategories, getCategory, currentPeriod, spentIn, addExpense, setInputPrefs } from './store.js';
import { formatUsd, formatMxn, pesosToUsdCents } from './money.js';
import { el, keypad, onSwipe, onLongPress, toast, textOn, nudge, formatDate, categoryChip } from './ui.js';
import { openCategoryGrid } from './sheets.js';

const MAX_DIGITS = { USD: 8, MXN: 7 }; // $999,999.99 and MX$9,999,999

let digits = '';
let date = todayISO();
let stripKey = ''; // which categories the strip was last built from
const parts = {};

export function initInput({ openMenu, openSummary }) {
  const menuButton = el('button', { id: 'menu-btn', className: 'icon-btn', textContent: '≡', 'aria-label': 'Menu' });
  menuButton.addEventListener('click', openMenu);
  parts.left = el('button', { className: 'left-btn' });
  parts.left.addEventListener('click', openSummary);

  // Currency: tap the pill, or swipe anywhere in this area.
  parts.usd = el('span', { textContent: 'USD' });
  parts.mxn = el('span', { textContent: 'MXN' });
  const pill = el('button', { className: 'currency-pill', 'aria-label': 'Switch currency' }, parts.usd, parts.mxn);
  pill.addEventListener('click', () => switchCurrency('left'));
  parts.amount = el('div', { className: 'amount' });
  parts.sub = el('div', { className: 'amount-sub' });
  const zone = el('div', { className: 'currency-zone' }, pill, parts.amount, parts.sub);
  onSwipe(zone, switchCurrency);

  // Category: a snapping strip; whichever chip is centered is selected. Long-press for a grid.
  parts.strip = el('div', { className: 'strip' });
  parts.strip.addEventListener('scroll', pickCenteredChip, { passive: true });
  onLongPress(parts.strip, () => openCategoryGrid(state.input.categoryId, selectCategory));

  parts.note = el('input', { type: 'text', className: 'note', placeholder: 'Add note', enterKeyHint: 'done' });
  parts.note.addEventListener('keydown', (event) => { if (event.key === 'Enter') parts.note.blur(); });
  parts.dateLabel = el('span');
  parts.dateInput = el('input', { type: 'date', 'aria-label': 'Expense date' });
  parts.dateInput.addEventListener('change', () => {
    date = parts.dateInput.value || todayISO();
    renderInput();
  });

  const pad = keypad(() => digits, (next) => {
    digits = next;
    renderInput();
  }, () => MAX_DIGITS[state.input.currency]);
  parts.add = el('button', { className: 'add-btn', textContent: 'Add' });
  parts.add.addEventListener('click', add);

  document.getElementById('view-input').append(
    el('header', { className: 'topbar' }, menuButton, parts.left),
    zone,
    parts.strip,
    el('div', { className: 'details' }, parts.note, el('label', { className: 'date-btn' }, parts.dateLabel, parts.dateInput)),
    pad,
    parts.add,
  );
  renderInput();
}

export function renderInput() {
  if (!parts.amount) return;
  const { currency } = state.input;
  const amount = Number(digits || '0');

  parts.usd.classList.toggle('on', currency === 'USD');
  parts.mxn.classList.toggle('on', currency === 'MXN');
  parts.amount.textContent = currency === 'USD' ? formatUsd(amount) : formatMxn(amount);
  parts.amount.classList.toggle('empty', !amount);
  parts.sub.textContent = currency === 'MXN'
    ? `≈ ${formatUsd(pesosToUsdCents(amount, state.rate.mxnPerUsd))} · ${rateText()}`
    : '';

  const period = currentPeriod();
  if (period) {
    const left = period.budgetCents - spentIn(period.id);
    parts.left.textContent = `${formatUsd(Math.abs(left))} ${left >= 0 ? 'left' : 'over'}`;
    parts.left.classList.toggle('over', left < 0);
  }

  renderStrip();
  const category = getCategory(state.input.categoryId);
  parts.add.style.background = category.color;
  parts.add.style.color = textOn(category.color);

  parts.dateLabel.textContent = date === todayISO() ? 'Today' : formatDate(date);
  parts.dateInput.value = date;
}

function rateText() {
  const { mxnPerUsd, date: rateDate } = state.rate;
  return rateDate ? `1 USD = ${mxnPerUsd.toFixed(2)} MXN` : `~${mxnPerUsd} MXN per USD (estimate until online)`;
}

function switchCurrency(direction) {
  const next = state.input.currency === 'USD' ? 'MXN' : 'USD';
  digits = digits.slice(0, MAX_DIGITS[next]);
  parts.amount.classList.remove('slide-left', 'slide-right');
  void parts.amount.offsetWidth; // restart the animation
  parts.amount.classList.add(direction === 'right' ? 'slide-right' : 'slide-left');
  setInputPrefs({ currency: next });
}

// ---------- category strip ----------

function renderStrip() {
  const categories = activeCategories();
  const key = categories.map((c) => `${c.id}:${c.name}:${c.color}`).join('|');
  if (key !== stripKey) {
    stripKey = key;
    parts.strip.replaceChildren(...categories.map((category) => {
      const chip = categoryChip(category);
      chip.addEventListener('click', () => centerChip(chip, 'smooth'));
      return chip;
    }));
    requestAnimationFrame(() => centerChip(chipFor(state.input.categoryId), 'auto'));
  }
  for (const chip of parts.strip.children) chip.classList.toggle('selected', chip.dataset.id === state.input.categoryId);
}

const chipFor = (id) => [...parts.strip.children].find((chip) => chip.dataset.id === id);

function centerChip(chip, behavior) {
  if (!chip) return;
  parts.strip.scrollTo({ left: chip.offsetLeft - (parts.strip.clientWidth - chip.offsetWidth) / 2, behavior });
}

function pickCenteredChip() {
  const middle = parts.strip.scrollLeft + parts.strip.clientWidth / 2;
  let best = null;
  let bestDistance = Infinity;
  for (const chip of parts.strip.children) {
    const distance = Math.abs(chip.offsetLeft + chip.offsetWidth / 2 - middle);
    if (distance < bestDistance) {
      best = chip;
      bestDistance = distance;
    }
  }
  if (best && best.dataset.id !== state.input.categoryId) setInputPrefs({ categoryId: best.dataset.id });
}

function selectCategory(id) {
  setInputPrefs({ categoryId: id });
  centerChip(chipFor(id), 'smooth');
}

// ---------- adding ----------

function add() {
  const amount = Number(digits || '0');
  if (!amount) {
    nudge(parts.amount);
    return;
  }
  const { currency, categoryId } = state.input;
  const rate = state.rate.mxnPerUsd;
  const usdCents = currency === 'USD' ? amount : pesosToUsdCents(amount, rate);
  const note = parts.note.value.trim();
  const expenseDate = date;

  // Reset the form before saving so the redraw shows it cleared.
  digits = '';
  date = todayISO();
  parts.note.value = '';
  parts.note.blur();

  const undo = addExpense({
    categoryId,
    usdCents,
    date: expenseDate,
    note,
    original: currency === 'MXN' ? { currency, amount, mxnPerUsd: rate } : null,
  });
  toast(`Added ${formatUsd(usdCents)} · ${getCategory(categoryId).name}`, undo);
}
