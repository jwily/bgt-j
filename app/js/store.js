// Data model and persistence. Everything is saved to localStorage as one JSON object, and
// every save fires a "budget:change" event so the screens can redraw.
//
// Shape:
//   categories: [{ id, name, color, archived }]          (always shown alphabetically; color is
//                                                         assigned automatically, see assignColors)
//   periods:    [{ id, budgetCents, start, end }]          (end is null for the current period)
//   expenses:   [{ id, periodId, categoryId, usdCents, date, note, original, createdAt }]
//               original is { currency, amount, perUsd } when entered in another currency
//               (amount in that currency's typed units, perUsd = its rate that day), else null
//   rates:      { perUsd: { MXN: 18.52, ... }, date, checkedAt }   (latest rates; date is the day they're
//               for, checkedAt when we last downloaded)
//   input:      { currency, categoryId }                   (last choices on the main screen)
//   lastBackupAt: timestamp of the last exported backup, or null
//   settings:   { backupReminderDays }                   (the backup nudge's timing, 30 by default)

import { CURRENCIES, CURRENCY_CODES, FOREIGN_CODES, HOME } from './money.js';
import { todayISO } from './dates.js';

const STORAGE_KEY = 'budget-tracker';
const UNREADABLE_KEY = 'budget-tracker-unreadable'; // saved data that couldn't be read, kept just in case
export const VERSION = 3;
const RATES_URL = `https://api.frankfurter.dev/v1/latest?base=${HOME}&symbols=${FOREIGN_CODES.join(',')}`;

// 16 colors, each loosely after one of FF8's Guardian Force portraits, in the order the GFs appear
// in the game's GF menu: [base, accent]. Categories take them in turn. The base is the category's
// color everywhere (gauges, the spending ring, ...); the accent, a second color from the same portrait, is
// only the glint on its gem, so it's always a light one: where the portrait's color is dark (a red
// eye, a ruby), it's that color lit. (Cerberus is steel grey: a true near-black would vanish in
// the gauges.) (Every pair is at least 10 apart in OKLab
// distance x100, where under ~10 starts to look alike; check with npm run palette.)
const PALETTE = [
  ['#94cc3a', '#ffd43f'], // Quezacotl: yellow-green, the yellow its tail fades to
  ['#8fd0f5', '#f7dc7a'], // Shiva: ice blue, golden hair
  ['#e2682b', '#f6c445'], // Ifrit: burnt orange, gold earring
  ['#f2bd33', '#ffc4cc'], // Siren: gold, rose lips
  ['#6250d0', '#e2c26a'], // Brothers: indigo, horns
  ['#b3173c', '#f2d043'], // Diablos: crimson, yellow eye
  ['#45d6a8', '#ffbccb'], // Carbuncle: mint, ruby (lit)
  ['#1f8e9e', '#a6ead9'], // Leviathan: deep teal, pale fins
  ['#a64ee0', '#f2d443'], // Pandemona: violet, yellow eyes
  ['#8a93a3', '#ff9a88'], // Cerberus: steel grey, red eyes (lit)
  ['#e0a2d8', '#f6d65a'], // Alexander: lavender-pink, gold trim
  ['#7d4a28', '#a77be8'], // Doomtrain: dark bronze, purple glow
  ['#253f84', '#bfcbe8'], // Bahamut: dark steel blue, silver
  ['#3aa64a', '#ffad6b'], // Cactuar: cactus green, spikes
  ['#6f7e1c', '#ffd84a'], // Tonberry: olive, lantern
  ['#28b4ff', '#d7c2ff'], // Eden: electric blue, violet streaks
];

const DEFAULT_CATEGORIES = ['Groceries', 'Dining', 'Transport', 'Housing', 'Bills', 'Shopping', 'Health', 'Fun', 'Other'];

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

// True when the saved data couldn't be read (app.js then recovers from a snapshot; see snapshots.js).
export let needsRecovery = false;
export let state = load();

// ---------- basics ----------

// crypto.randomUUID only exists on HTTPS pages, so fall back for local testing over plain HTTP.
function newId() {
  return crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function freshState() {
  const categories = DEFAULT_CATEGORIES.map((name) => ({ id: newId(), name, color: null, archived: false }));
  return {
    version: VERSION,
    categories,
    periods: [],
    expenses: [],
    rates: { perUsd: {}, date: null, checkedAt: 0 },
    input: { currency: HOME, categoryId: categories[0].id },
    lastBackupAt: null,
    settings: { backupReminderDays: 30 },
  };
}

// Brings data saved by an older version (in this browser, or in a backup file) up to date.
// Version 1, from before the currency table, kept one rate as rate.mxnPerUsd and peso expenses'
// rate as original.mxnPerUsd.
export function migrate(data) {
  if (data?.version === 1) {
    const old = data.rate ?? {};
    data.rates = { perUsd: old.mxnPerUsd > 0 ? { MXN: old.mxnPerUsd } : {}, date: old.date ?? null, checkedAt: 0 };
    delete data.rate;
    for (const expense of data.expenses ?? []) {
      if (expense.original?.mxnPerUsd) {
        expense.original.perUsd = expense.original.mxnPerUsd;
        delete expense.original.mxnPerUsd;
      }
    }
    data.version = 2;
  }
  // Version 2 had no settings.
  if (data?.version === 2) {
    data.settings = { backupReminderDays: 30 };
    data.version = 3;
  }
  return data;
}

export function isValid(data) {
  return data?.version === VERSION
    && Array.isArray(data.categories) && data.categories.length > 0
    && Array.isArray(data.periods)
    && Array.isArray(data.expenses)
    && data.rates !== null && typeof data.rates?.perUsd === 'object'
    && data.settings?.backupReminderDays > 0
    && data.input !== null && typeof data.input === 'object'; // typeof null is also 'object'
}

// Saved data (as JSON text), upgraded and checked, or null if it can't be used.
export function parse(text) {
  try {
    const data = migrate(JSON.parse(text));
    return isValid(data) ? data : null;
  } catch {
    return null;
  }
}

// If the saved data can't be read, keep it aside (never overwrite it) and flag it, so the app can
// recover from a snapshot rather than silently starting over.
function load() {
  const text = localStorage.getItem(STORAGE_KEY);
  let loaded = text === null ? null : parse(text);
  if (text !== null && !loaded) {
    needsRecovery = true;
    try {
      localStorage.setItem(UNREADABLE_KEY, text);
    } catch {
      // No room to keep it; recovering matters more.
    }
  }
  loaded ??= freshState();
  tidy(loaded);
  return loaded;
}

// Run on every load and save: category names without stray spaces at either end, a valid chosen
// category and currency on the main screen, and colors in alphabetical order.
function tidy(data) {
  for (const category of data.categories) category.name = category.name.trim();
  keepInputCategoryActive(data);
  assignColors(data);
}

// The main screen's choices must stay valid: an active category (one may have just been archived
// or deleted, or come from a backup) and a currency the app still offers.
function keepInputCategoryActive(data) {
  const active = data.categories.filter((c) => !c.archived);
  if (!active.some((c) => c.id === data.input.categoryId)) data.input.categoryId = [...active].sort(byName)[0]?.id;
  if (!CURRENCY_CODES.includes(data.input.currency)) data.input.currency = HOME;
}

// The color for the category in position i (alphabetical, active first), wrapping after 16.
// (A function declaration: load() runs near the top of this file, before a const here would exist.)
export function paletteColor(i) {
  return PALETTE[i % PALETTE.length][0];
}

// The accent that goes with a palette color (the color itself for any other color).
export const accentFor = (color) => PALETTE.find(([base]) => base === color)?.[1] ?? color;

// Colors follow alphabetical order: the first active category gets color 1, the next color 2, and
// so on. Archived categories come after the active ones, so past summaries still tell them apart.
// Past 16, colors repeat. Renaming, adding or removing a category can shift colors.
function assignColors(data) {
  const sorted = [...data.categories].sort(byName);
  const ordered = [...sorted.filter((c) => !c.archived), ...sorted.filter((c) => c.archived)];
  ordered.forEach((category, i) => { category.color = paletteColor(i); });
}

// Returns false if the data couldn't be saved (the phone's storage for the app is full).
function write() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// A failed save fires "budget:save-failed" (app.js warns); the screen still redraws so it shows
// what you did.
export function save() {
  tidy(state);
  if (!write()) window.dispatchEvent(new Event('budget:save-failed'));
  window.dispatchEvent(new Event('budget:change'));
}

export function replaceState(data) {
  state = data;
  save();
}

// ---------- reading ----------

export const currentPeriod = () => state.periods.find((p) => !p.end);
export const getPeriod = (id) => state.periods.find((p) => p.id === id);
export const periodNumber = (period) => state.periods.indexOf(period) + 1;
export const getCategory = (id) => state.categories.find((c) => c.id === id);
export const sortedCategories = () => [...state.categories].sort(byName);
export const activeCategories = () => sortedCategories().filter((c) => !c.archived);
export const periodExpenses = (periodId) => state.expenses.filter((e) => e.periodId === periodId);
export const totalUsd = (expenses) => expenses.reduce((sum, e) => sum + e.usdCents, 0);
export const spentIn = (periodId) => totalUsd(periodExpenses(periodId));

// ---------- periods ----------

// Ends the current period today (if there is one) and starts a new one.
export function startPeriod(budgetCents) {
  const today = todayISO();
  const current = currentPeriod();
  if (current) current.end = today;
  state.periods.push({ id: newId(), budgetCents, start: today, end: null });
  save();
}

// Deletes a period and all of its expenses. Deleting the current period reopens the one before it
// (as if that New Period never happened). Returns an undo function.
export function deletePeriod(id) {
  const index = state.periods.findIndex((p) => p.id === id);
  const [period] = state.periods.splice(index, 1);
  const expenses = state.expenses.filter((e) => e.periodId === id);
  state.expenses = state.expenses.filter((e) => e.periodId !== id);
  const reopened = period.end ? null : state.periods.at(-1) ?? null;
  const reopenedEnd = reopened?.end;
  if (reopened) reopened.end = null;
  save();
  return () => {
    if (reopened) reopened.end = reopenedEnd;
    state.periods.splice(index, 0, period);
    state.expenses.push(...expenses);
    save();
  };
}

export function setBudget(periodId, budgetCents) {
  getPeriod(periodId).budgetCents = budgetCents;
  save();
}

// ---------- expenses ----------
// Changes that can be undone return a function that undoes them.

export function addExpense(fields) {
  const expense = { id: newId(), periodId: currentPeriod().id, createdAt: Date.now(), ...fields };
  state.expenses.push(expense);
  save();
  return () => deleteExpense(expense.id);
}

export function updateExpense(id, changes) {
  Object.assign(state.expenses.find((e) => e.id === id), changes);
  save();
}

export function deleteExpense(id) {
  const index = state.expenses.findIndex((e) => e.id === id);
  const [removed] = state.expenses.splice(index, 1);
  save();
  return () => {
    state.expenses.splice(index, 0, removed);
    save();
  };
}

// ---------- categories ----------

export const categoryIsUsed = (id) => state.expenses.some((e) => e.categoryId === id);

// Applies the Categories screen's edits in one go. draft: [{ id (null for a new one), name,
// archived }] for every category to keep. Categories left out are removed: archived if they have
// expenses (so past summaries keep them), deleted otherwise. save() then sorts and recolors.
// Returns an undo function.
export function saveCategories(draft) {
  const before = state.categories.map((c) => ({ ...c }));
  const kept = draft.map((d) => {
    const existing = d.id && getCategory(d.id);
    const { name, archived } = d; // save() trims the names
    return existing ? { ...existing, name, archived } : { id: newId(), name, color: null, archived };
  });
  const keptIds = new Set(kept.map((c) => c.id));
  const archivedNow = state.categories.filter((c) => !keptIds.has(c.id) && categoryIsUsed(c.id)).map((c) => ({ ...c, archived: true }));
  state.categories.splice(0, state.categories.length, ...kept, ...archivedNow);
  save();
  return () => {
    state.categories.splice(0, state.categories.length, ...before);
    save();
  };
}

export function setInputPrefs(prefs) {
  Object.assign(state.input, prefs);
  save();
}

export function setBackupReminder(days) {
  state.settings.backupReminderDays = days;
  save();
}

export function markBackedUp() {
  state.lastBackupAt = Date.now();
  save();
}

// ---------- exchange rates ----------

// How many units of `code` one US dollar buys: today's downloaded rate, or the currency's
// fallback until one has been downloaded.
export const rateFor = (code) => (code === HOME ? 1 : state.rates.perUsd[code] ?? CURRENCIES[code].fallbackRate);
export const rateIsEstimate = (code) => code !== HOME && !(state.rates.perUsd[code] > 0);

// The source publishes new rates once per business day (around 9am in Mexico City), so: download
// whenever the app opens without today's rates, but at most every 3 hours (weekends and holidays
// never get a "today" rate). Failing (e.g. offline) keeps the last rates and tries next time.
const RECHECK_MS = 3 * 60 * 60 * 1000;

export async function refreshRate() {
  if (!FOREIGN_CODES.length || state.rates.date === todayISO()) return;
  if (Date.now() - (state.rates.checkedAt ?? 0) < RECHECK_MS) return;
  try {
    const response = await fetch(RATES_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const fetched = Object.fromEntries(FOREIGN_CODES.filter((code) => data.rates?.[code] > 0).map((code) => [code, data.rates[code]]));
    if (!Object.keys(fetched).length) return;
    state.rates = { perUsd: { ...state.rates.perUsd, ...fetched }, date: data.date, checkedAt: Date.now() };
    save();
  } catch {
    // Network error: try again next time the app opens.
  }
}
