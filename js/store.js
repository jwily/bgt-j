// Data model and persistence. Everything is saved to localStorage as one JSON object, and
// every save fires a "budget:change" event so the screens can redraw.
//
// Shape:
//   categories: [{ id, name, color, archived }]          (always shown alphabetically)
//   periods:    [{ id, budgetCents, start, end }]          (end is null for the current period)
//   expenses:   [{ id, periodId, categoryId, usdCents, date, note, original, createdAt }]
//               original is { currency: 'MXN', amount, mxnPerUsd } for peso entries, else null
//   rate:       { mxnPerUsd, date, fetchedOn }
//   input:      { currency, categoryId }                   (last choices on the main screen)
//   lastBackupAt: timestamp of the last exported backup, or null

const STORAGE_KEY = 'budget-tracker';
const RATE_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=MXN';
const FALLBACK_RATE = 18.5; // used only until the first successful download

export const PALETTE = [
  '#e5484d', // red
  '#f76b15', // orange
  '#f5a623', // amber
  '#a0b833', // lime
  '#30a46c', // green
  '#12a594', // teal
  '#05a2c2', // cyan
  '#0090ff', // blue
  '#3e63dd', // indigo
  '#8e4ec6', // purple
  '#d6409f', // pink
  '#8d7a68', // brown
];

const DEFAULT_CATEGORIES = [
  ['Groceries', 4], ['Dining', 1], ['Transport', 7], ['Housing', 8], ['Bills', 6],
  ['Shopping', 10], ['Health', 0], ['Fun', 9], ['Other', 11],
];

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export let state = load();

// ---------- basics ----------

// crypto.randomUUID only exists on HTTPS pages, so fall back for local testing over plain HTTP.
export function newId() {
  return crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Today's date in local time as "YYYY-MM-DD" (toISOString alone would use UTC).
export function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function freshState() {
  const categories = DEFAULT_CATEGORIES.map(([name, color]) => ({ id: newId(), name, color: PALETTE[color], archived: false }));
  return {
    version: 1,
    categories,
    periods: [],
    expenses: [],
    rate: { mxnPerUsd: FALLBACK_RATE, date: null, fetchedOn: null },
    input: { currency: 'USD', categoryId: categories[0].id },
    lastBackupAt: null,
  };
}

export function isValid(data) {
  return data?.version === 1
    && Array.isArray(data.categories) && data.categories.length > 0
    && Array.isArray(data.periods)
    && Array.isArray(data.expenses)
    && data.rate?.mxnPerUsd > 0
    && data.input !== null && typeof data.input === 'object'; // typeof null is also 'object'
}

function load() {
  let loaded = freshState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (isValid(saved)) loaded = saved;
  } catch {
    // Corrupt data: start fresh.
  }
  keepInputCategoryActive(loaded);
  return loaded;
}

// The main screen's selected category must always be an active one (it may have just been
// archived or deleted, or come from a backup).
function keepInputCategoryActive(data) {
  const active = data.categories.filter((c) => !c.archived);
  if (!active.some((c) => c.id === data.input.categoryId)) data.input.categoryId = [...active].sort(byName)[0]?.id;
}

export function save() {
  keepInputCategoryActive(state);
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
  const used = new Set(activeCategories().map((c) => c.color));
  const category = { id: newId(), name: 'New category', color: PALETTE.find((c) => !used.has(c)) ?? PALETTE[0], archived: false };
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

// ---------- exchange rate ----------

// Downloads today's USD→MXN rate unless we already did today. Failing (e.g. offline) keeps the last rate.
export async function refreshRate() {
  if (state.rate.fetchedOn === todayISO()) return;
  try {
    const response = await fetch(RATE_URL, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const mxnPerUsd = data.rates?.MXN;
    if (!(mxnPerUsd > 0)) return;
    state.rate = { mxnPerUsd, date: data.date, fetchedOn: todayISO() };
    save();
  } catch {
    // Network error: try again next time the app opens.
  }
}
