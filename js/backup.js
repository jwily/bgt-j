// Backup files: a full JSON copy of the app's data (restorable), a CSV for spreadsheets,
// and how long it has been since the last backup.

import { state, getPeriod, getCategory, isValid, replaceState, markBackedUp, todayISO } from './store.js';
import { saveFile } from './ui.js';

const REMINDER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Returns true if the file was saved (or at least not cancelled).
export async function exportBackup() {
  const saved = await saveFile(`budget-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  if (saved) markBackedUp();
  return saved;
}

export function exportCsv() {
  return saveFile(`budget-${todayISO()}.csv`, toCsv(), 'text/csv');
}

// Returns the backup's data, or null if the file isn't a backup.
export async function readBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    return isValid(data) ? data : null;
  } catch {
    return null;
  }
}

// The restored data is, by definition, backed up, so the reminder clock restarts.
export function restoreBackup(data) {
  replaceState({ ...data, lastBackupAt: Date.now() });
}

// { label, stale }: stale means it's time to nudge (never backed up with data, or 30+ days).
export function backupStatus() {
  const last = state.lastBackupAt;
  if (!last) return { label: 'Never backed up', stale: state.expenses.length > 0 };
  const startOfDay = (time) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(Date.now()) - startOfDay(last)) / DAY_MS);
  const label = days === 0 ? 'Backed up today' : days === 1 ? 'Backed up yesterday' : `Backed up ${days} days ago`;
  return { label, stale: days >= REMINDER_DAYS };
}

function toCsv() {
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = ['period_start,date,category,amount_usd,note,original_currency,original_amount,mxn_per_usd'];
  const sorted = [...state.expenses].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  for (const e of sorted) {
    lines.push([
      getPeriod(e.periodId)?.start, e.date, getCategory(e.categoryId)?.name, (e.usdCents / 100).toFixed(2), e.note,
      e.original?.currency, e.original?.amount, e.original?.mxnPerUsd,
    ].map(cell).join(','));
  }
  return lines.join('\n');
}
