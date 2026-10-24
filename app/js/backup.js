// Backup files: a full JSON copy of the app's data (restorable), a CSV for spreadsheets,
// and how long it has been since the last backup.

import { state, getPeriod, getCategory, isValid, migrate, replaceState, markBackedUp, VERSION } from './store.js';
import { todayISO, localDay, daysBetween } from './dates.js';
import { takeSnapshot } from './snapshots.js';
import { el } from './ui.js';
import { HOME, plainAmount } from './money.js';

export const REMINDER_CHOICES = [7, 14, 30, 60]; // days; the user picks one on the Backup screen

// Returns true if the file was saved (or at least not cancelled).
export async function exportBackup() {
  const saved = await saveFile(`bgt-j-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  if (saved) markBackedUp();
  return saved;
}

export function exportCsv() {
  return saveFile(`bgt-j-${todayISO()}.csv`, toCsv(), 'text/csv');
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

// { short, label, stale }: short is "today" / "3 days ago" / "never" for tight spaces,
// label is the full sentence, stale means it's time to nudge (never backed up with data, or past the
// reminder setting).
export function backupStatus() {
  const last = state.lastBackupAt;
  if (!last) return { short: 'never', label: 'Never backed up', stale: state.expenses.length > 0 };
  const days = daysBetween(localDay(last));
  const short = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return { short, label: `Backed up ${short}`, stale: days >= state.settings.backupReminderDays };
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

// On iPhone the share sheet is the reliable way to save a file ("Save to Files", AirDrop, Mail).
// Returns false if the person cancelled, true otherwise.
async function saveFile(filename, text, type) {
  const file = new File([text], filename, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
