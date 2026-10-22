// The main screen: type an amount, swipe to pick currency and category, tap Add.

import { state, activeCategories, getCategory, addExpense, setInputPrefs, rateFor, rateIsEstimate } from './store.js';
import { todayISO, daysBetween, formatDate } from './dates.js';
import { CURRENCIES, CURRENCY_CODES, HOME, formatMoney, formatUsd, toUsdCents } from './money.js';
import { $, el, keypad, onDoubleTap, toast, nudge, categoryChip } from './ui.js';
import { openCategoryGrid } from './sheets.js';

let digits = '';
let pickedDate = null; // a date chosen with the date button; null means "today" (whenever Add is tapped)
let stripKey = ''; // which categories the strip was last built from
let recentering = false; // true while the app (not the person) is moving the strip
// The phone held sideways: the app is hidden then (style.css), and the strip's width changes, which
// can shift it; that mustn't change the chosen category. Same query as in style.css.
const SIDEWAYS = matchMedia('(orientation: landscape) and (max-height: 500px)');
const parts = {};

export function initInput() {
  // Currency: tap anywhere in the Amount window for the next one. The choices sit in a row like the
  // category strip: the chosen one centered, bright, with the hand beside it; the others grey.
  parts.currencies = CURRENCY_CODES.map((code) => el('span', { textContent: code }));
  parts.currencyTrack = el('div', { className: 'options currency-track' }, ...parts.currencies);
  const options = el('div', { className: 'currency-opts' }, parts.currencyTrack);
  parts.amount = el('div', { className: 'amount' });
  parts.sub = el('div', { className: 'amount-sub' });
  // No window around it: the amount floats on the black under a plain heading, like the groups on
  // FF8's GF screen ("Compatibility", "Learning").
  const zone = el('div', { className: 'currency-zone', role: 'button', tabIndex: 0, 'aria-label': 'Switch currency' },
    el('div', { className: 'floating-heading', textContent: 'Amount' }), options, parts.amount, parts.sub);
  zone.addEventListener('click', cycleCurrency);
  // Re-center when the row's width or the font changes (it measures the choices' widths).
  new ResizeObserver(() => centerCurrency(false)).observe(options);
  document.fonts?.ready.then(() => centerCurrency(false));

  // Category: a snapping strip; whichever chip is centered is selected. Double-tap for a grid.
  parts.strip = el('div', { className: 'strip' });
  parts.strip.addEventListener('scroll', pickCenteredChip, { passive: true });
  onDoubleTap(parts.strip, () => openCategoryGrid(state.input.categoryId, selectCategory, parts.strip.parentElement));

  parts.note = el('input', { type: 'text', className: 'note', placeholder: 'Optional', enterKeyHint: 'done', 'aria-label': 'Note' });
  parts.note.addEventListener('keydown', (event) => { if (event.key === 'Enter') parts.note.blur(); });
  parts.dateLabel = el('span');
  parts.dateInput = el('input', { type: 'date', 'aria-label': 'Expense date' });
  parts.dateInput.addEventListener('change', () => {
    const chosen = parts.dateInput.value;
    pickedDate = chosen && chosen !== todayISO() ? chosen : null;
    renderInput();
  });
  // A click anywhere on the button opens the picker. Desktop browsers otherwise only open it from
  // the input's small calendar icon (a click elsewhere just selects the hidden day or month), and
  // iPhone Safari doesn't always stretch the input over the whole button. A tap on the input itself
  // on a touch screen already opens the native picker, so that one is left alone.
  const dateButton = el('label', { className: 'window date-btn', 'data-label': 'Date' }, parts.dateLabel, parts.dateInput);
  dateButton.addEventListener('click', (event) => {
    if (event.target === parts.dateInput && matchMedia('(pointer: coarse)').matches) return;
    event.preventDefault();
    try {
      parts.dateInput.showPicker();
    } catch {
      parts.dateInput.focus(); // older iOS: focusing a date input opens its picker
    }
  });

  const pad = keypad(() => digits, (next) => {
    digits = next;
    renderInput();
  }, () => CURRENCIES[state.input.currency].maxDigits);
  // Add sits in the bottom bar, left of Undo and the Menu button, under a right thumb.
  parts.add = el('button', { className: 'add-btn', textContent: 'Add' });
  parts.add.addEventListener('click', add);
  $('undo-btn').before(parts.add);

  $('view-input').append(
    zone,
    el('div', { className: 'details' },
      el('label', { className: 'window note-window', 'data-label': 'Note' }, parts.note),
      dateButton),
    // Category sits below Note and Date: it changes more often, so it's nearer the thumb.
    el('div', { className: 'window strip-window', 'data-label': 'Category' }, parts.strip),
    pad,
  );
  renderInput();
  document.fonts?.ready.then(recenter);
  SIDEWAYS.addEventListener('change', () => { if (!SIDEWAYS.matches) recenter(); });
}

export function renderInput() {
  if (!parts.amount) return;
  const { currency } = state.input;
  const amount = Number(digits || '0');

  parts.currencies.forEach((span, i) => span.classList.toggle('on', CURRENCY_CODES[i] === currency));
  centerCurrency(true);
  parts.amount.textContent = formatMoney(amount, currency);
  parts.amount.classList.toggle('empty', !amount);
  parts.sub.replaceChildren(...(currency === HOME ? [] : [
    el('span', { className: 'converted', textContent: `≈ ${formatUsd(toUsdCents(amount, currency, rateFor(currency)))}` }),
    el('span', { textContent: rateText(currency) }),
  ]));

  renderStrip();
  parts.add.style.setProperty('--c', getCategory(state.input.categoryId).color);

  parts.dateLabel.textContent = pickedDate ? formatDate(pickedDate) : 'Today';
  parts.dateInput.value = pickedDate ?? todayISO();
}

// "1 USD = 18.52 MXN", with the rate's date if it's more than 4 days old (offline, or the source
// is down), or "~18.5 MXN per USD (estimate...)" before any rate has downloaded.
function rateText(code) {
  const rate = rateFor(code);
  if (rateIsEstimate(code)) return `~${rate} ${code} per ${HOME} (estimate: no rates downloaded yet)`;
  return `1 ${HOME} = ${rate.toFixed(2)} ${code}${daysBetween(state.rates.date) > 4 ? ` (rate from ${formatDate(state.rates.date)})` : ''}`;
}

// The next currency, wrapping around; the new amount slides in from the right, like the row.
function cycleCurrency() {
  const next = CURRENCY_CODES[(CURRENCY_CODES.indexOf(state.input.currency) + 1) % CURRENCY_CODES.length];
  digits = digits.slice(0, CURRENCIES[next].maxDigits);
  parts.amount.classList.remove('slide-in');
  void parts.amount.offsetWidth; // restart the animation
  parts.amount.classList.add('slide-in');
  setInputPrefs({ currency: next });
}

// Moves the row so the chosen currency's name is centered (the hand hangs outside it and doesn't
// count). glide: animate, as after a tap; not when only the layout changed.
function centerCurrency(glide) {
  const on = parts.currencies.find((span) => span.classList.contains('on'));
  const row = parts.currencyTrack.parentElement;
  if (!on || !row.clientWidth) return;
  parts.currencyTrack.classList.toggle('gliding', glide);
  parts.currencyTrack.style.transform = `translateX(${row.clientWidth / 2 - (on.offsetLeft + on.offsetWidth / 2)}px)`;
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
    recenter();
  }
  for (const chip of parts.strip.children) chip.classList.toggle('selected', chip.dataset.id === state.input.categoryId);
}

// Put the selected chip back in the middle after the strip's layout changed (rebuilt, or its font
// finished loading and chip widths shifted). The scrolling this causes isn't a choice by the
// person, so pickCenteredChip ignores it until things settle.
function recenter() {
  recentering = true;
  requestAnimationFrame(() => {
    centerChip(chipFor(state.input.categoryId), 'auto');
    setTimeout(() => { recentering = false; }, 150);
  });
}

const chipFor = (id) => [...parts.strip.children].find((chip) => chip.dataset.id === id);

function centerChip(chip, behavior) {
  if (!chip) return;
  parts.strip.scrollTo({ left: chip.offsetLeft - (parts.strip.clientWidth - chip.offsetWidth) / 2, behavior });
}

function pickCenteredChip() {
  if (recentering || SIDEWAYS.matches) return;
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
  const rate = rateFor(currency);
  const usdCents = toUsdCents(amount, currency, rate);
  const note = parts.note.value.trim();
  const expenseDate = pickedDate ?? todayISO(); // today as of now, even if the app was left open overnight

  // Reset the form before saving so the redraw shows it cleared.
  digits = '';
  pickedDate = null;
  parts.note.value = '';
  parts.note.blur();

  const undo = addExpense({
    categoryId,
    usdCents,
    date: expenseDate,
    note,
    original: currency === HOME ? null : { currency, amount, perUsd: rate },
  });
  toast(`Added ${formatUsd(usdCents)} · ${getCategory(categoryId).name}`, undo);
}
