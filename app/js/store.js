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
//   rates:      { perUsd: { MXN: 18.52, ... }, date, fetchedOn }   (latest downloaded rates)
//   input:      { currency, categoryId }                   (last choices on the main screen)
//   lastBackupAt: timestamp of the last exported backup, or null

import { CURRENCIES, CURRENCY_CODES, FOREIGN_CODES, HOME } from './money.js';

const STORAGE_KEY = 'budget-tracker';
const VERSION = 2;
const RATES_URL = `https://api.frankfurter.dev/v1/latest?base=${HOME}&symbols=${FOREIGN_CODES.join(',')}`;

// 16 colors, each loosely after one of FF8's Guardian Force portraits, in the order the GFs appear
// in the game's GF menu. Categories take them in turn. (Every pair is at least 11 apart in OKLab
// distance x100, where under ~10 starts to look alike.)
const PALETTE = [
  '#94cc3a', // Quezacotl: yellow-green
  '#8fd0f5', // Shiva: ice blue
  '#e2682b', // Ifrit: burnt orange
  '#f2bd33', // Siren: gold
  '#6250d0', // Brothers: indigo
  '#b3173c', // Diablos: crimson
  '#45d6a8', // Carbuncle: mint
  '#1f8e9e', // Leviathan: deep teal
  '#a64ee0', // Pandemona: violet
  '#efe8d4', // Cerberus: pale bone
  '#e0a2d8', // Alexander: lavender-pink
  '#7d4a28', // Doomtrain: dark bronze
  '#253f84', // Bahamut: dark steel blue
  '#3aa64a', // Cactuar: cactus green
  '#6f7e1c', // Tonberry: olive
  '#28b4ff', // Eden: electric blue
];

const DEFAULT_CATEGORIES = ['Groceries', 'Dining', 'Transport', 'Housing', 'Bills', 'Shopping', 'Health', 'Fun', 'Other'];

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export let state = load();

// ---------- basics ----------

// crypto.randomUUID only exists on HTTPS pages, so fall back for local testing over plain HTTP.
function newId() {
  return crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Today's date in local time as "YYYY-MM-DD" (toISOString alone would use UTC).
export function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function freshState() {
  const categories = DEFAULT_CATEGORIES.map((name) => ({ id: newId(), name, color: null, archived: false }));
  return {
    version: VERSION,
    categories,
    periods: [],
    expenses: [],
    rates: { perUsd: {}, date: null, fetchedOn: null },
    input: { currency: HOME, categoryId: categories[0].id },
    lastBackupAt: null,
  };
}

// Brings data saved by an older version (in this browser, or in a backup file) up to date.
// Version 1, from before the currency table, kept one rate as rate.mxnPerUsd and peso expenses'
// rate as original.mxnPerUsd.
export function migrate(data) {
  if (data?.version === 1) {
    const old = data.rate ?? {};
    data.rates = { perUsd: old.mxnPerUsd > 0 ? { MXN: old.mxnPerUsd } : {}, date: old.date ?? null, fetchedOn: old.fetchedOn ?? null };
    delete data.rate;
    for (const expense of data.expenses ?? []) {
      if (expense.original?.mxnPerUsd) {
        expense.original.perUsd = expense.original.mxnPerUsd;
        delete expense.original.mxnPerUsd;
      }
    }
    data.version = 2;
  }
  return data;
}

export function isValid(data) {
  return data?.version === VERSION
    && Array.isArray(data.categories) && data.categories.length > 0
    && Array.isArray(data.periods)
    && Array.isArray(data.expenses)
    && data.rates !== null && typeof data.rates?.perUsd === 'object'
    && data.input !== null && typeof data.input === 'object'; // typeof null is also 'object'
}

function load() {
  let loaded = freshState();
  try {
    const saved = migrate(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    if (isValid(saved)) loaded = saved;
  } catch {
    // Corrupt data: start fresh.
  }
  keepInputCategoryActive(loaded);
  assignColors(loaded);
  return loaded;
}

// The main screen's choices must stay valid: an active category (one may have just been archived
// or deleted, or come from a backup) and a currency the app still offers.
function keepInputCategoryActive(data) {
  const active = data.categories.filter((c) => !c.archived);
  if (!active.some((c) => c.id === data.input.categoryId)) data.input.categoryId = [...active].sort(byName)[0]?.id;
  if (!CURRENCY_CODES.includes(data.input.currency)) data.input.currency = HOME;
}

// Colors follow alphabetical order: the first active category gets color 1, the next color 2, and
// so on. Archived categories come after the active ones, so past summaries still tell them apart.
// Past 16, colors repeat. Renaming, adding or removing a category can shift colors.
function assignColors(data) {
  const sorted = [...data.categories].sort(byName);
  const ordered = [...sorted.filter((c) => !c.archived), ...sorted.filter((c) => c.archived)];
  ordered.forEach((category, i) => { category.color = PALETTE[i % PALETTE.length]; });
}

export function save() {
  keepInputCategoryActive(state);
  assignColors(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

export function addCategory() {
  const category = { id: newId(), name: 'New Category', color: null, archived: false }; // save() assigns the color
  state.categories.push(category);
  save();
  return category;
}

export function updateCategory(id, changes) {
  Object.assign(getCategory(id), changes);
  save();
}

// Categories with expenses are archived so past summaries keep them; unused ones are deleted.
// Returns an undo function.
export function removeCategory(id) {
  const index = state.categories.findIndex((c) => c.id === id);
  const category = state.categories[index];
  if (state.expenses.some((e) => e.categoryId === id)) {
    category.archived = true;
    save();
    return () => updateCategory(id, { archived: false });
  }
  state.categories.splice(index, 1);
  save();
  return () => {
    state.categories.splice(index, 0, category);
    save();
  };
}

// ---------- main screen choices ----------

export function setInputPrefs(prefs) {
  Object.assign(state.input, prefs);
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

// Downloads today's rates for every other currency, unless we already did today.
// Failing (e.g. offline) keeps the last rates.
export async function refreshRate() {
  if (!FOREIGN_CODES.length || state.rates.fetchedOn === todayISO()) return;
  try {
    const response = await fetch(RATES_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const fetched = Object.fromEntries(FOREIGN_CODES.filter((code) => data.rates?.[code] > 0).map((code) => [code, data.rates[code]]));
    if (!Object.keys(fetched).length) return;
    state.rates = { perUsd: { ...state.rates.perUsd, ...fetched }, date: data.date, fetchedOn: todayISO() };
    save();
  } catch {
    // Network error: try again next time the app opens.
  }
}
