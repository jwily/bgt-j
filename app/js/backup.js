// Backup files: a full JSON copy of the app's data (restorable), a CSV for spreadsheets,
// and how long it has been since the last backup.

import { state, getPeriod, getCategory, isValid, migrate, replaceState, markBackedUp, todayISO, readSnapshots, SNAPSHOT_KEY, VERSION } from './store.js';
import { saveFile } from './ui.js';
import { HOME, plainAmount } from './money.js';

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

// Returns { data } (brought up to date if it came from an older version), or { error } saying why
// the file can't be used.
export async function readBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    data = null;
  }
  if (data?.version > VERSION) return { error: 'That backup is from a newer version of the app. Reopen the app to update it, then try again.' };
  data = migrate(data);
  return isValid(data) ? { data } : { error: "That file isn't a budget backup." };
}

// The restored data is, by definition, backed up, so the reminder clock restarts.
export function restoreBackup(data) {
  takeSnapshot('before restoring a backup');
  replaceState({ ...data, lastBackupAt: Date.now() });
}

// ---------- safety snapshots ----------
// Copies of all the data, kept on the phone apart from it: one a day (as it was when the app was
// first opened that day) and one before anything drastic. They undo mistakes; they don't protect
// against losing the phone (exported backups do). Never included in exported backups.

const SNAPSHOT_LIMIT = 7;
const DAILY = 'start of the day';

export function takeSnapshot(reason) {
  const list = [{ at: Date.now(), reason, data: JSON.stringify(state) }, ...readSnapshots()].slice(0, SNAPSHOT_LIMIT);
  // If the phone's storage for the app is full, drop the oldest snapshots until it fits;
  // snapshots must never get in the way of saving the real data.
  while (list.length) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list));
      return;
    } catch {
      list.pop();
    }
  }
}

// Frees the space snapshots use (when the phone's storage for the app is full). Returns whether
// there were any to remove.
export function clearSnapshots() {
  const had = readSnapshots().length > 0;
  localStorage.removeItem(SNAPSHOT_KEY);
  return had;
}

export function takeDailySnapshot() {
  const last = readSnapshots().find((snapshot) => snapshot.reason === DAILY);
  if (last && new Date(last.at).toDateString() === new Date().toDateString()) return;
  takeSnapshot(DAILY);
}

// Goes back to a snapshot, after snapshotting the current data so this can be undone too.
// Keeps the newer "last backed up" time, since backups made since then still exist.
export function restoreSnapshot(at) {
  const snapshot = readSnapshots().find((s) => s.at === at);
  const data = snapshot && migrate(JSON.parse(snapshot.data));
  if (!isValid(data)) return false;
  takeSnapshot('before going back to a snapshot');
  replaceState({ ...data, lastBackupAt: Math.max(data.lastBackupAt ?? 0, state.lastBackupAt ?? 0) || null });
  return true;
}

// { short, label, stale }: short is "today" / "3 days ago" / "never" for tight spaces,
// label is the full sentence, stale means it's time to nudge (never backed up with data, or 30+ days).
export function backupStatus() {
  const last = state.lastBackupAt;
  if (!last) return { short: 'never', label: 'Never backed up', stale: state.expenses.length > 0 };
  const startOfDay = (time) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(Date.now()) - startOfDay(last)) / DAY_MS);
  const short = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return { short, label: `Backed up ${short}`, stale: days >= REMINDER_DAYS };
}

function toCsv() {
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = ['period_start,date,category,amount_usd,note,original_currency,original_amount,rate_per_usd'];
  const sorted = [...state.expenses].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  for (const e of sorted) {
    lines.push([
      getPeriod(e.periodId)?.start, e.date, getCategory(e.categoryId)?.name, plainAmount(e.usdCents, HOME), e.note,
      e.original?.currency, e.original && plainAmount(e.original.amount, e.original.currency), e.original?.perUsd,
    ].map(cell).join(','));
  }
  return lines.join('\n');
}
