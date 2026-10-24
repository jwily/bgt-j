// The Backup screen: export a backup or CSV, restore one, the reminder, and safety snapshots.

import { state, currentPeriod, setBackupReminder } from '../store.js';
import { $, el, toast } from '../ui.js';
import { formatMoment } from '../dates.js';
import { exportBackup, exportCsv, readBackup, restoreBackup, backupStatus, REMINDER_CHOICES } from '../backup.js';
import { readSnapshots, restoreSnapshot } from '../snapshots.js';
import { fill, panel, note, showPage } from '../pages.js';

export function render() {
  const status = backupStatus();

  const backupButton = el('button', { className: 'wide-btn', textContent: 'Export backup' });
  backupButton.addEventListener('click', exportBackup);

  const csvButton = el('button', { className: 'wide-btn', textContent: 'Export spreadsheet (CSV)' });
  csvButton.addEventListener('click', exportCsv);

  const file = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    file.value = '';
    if (!chosen) return;
    const { data, error } = await readBackup(chosen);
    if (error) {
      toast(error);
      return;
    }
    if (!confirm(`Replace everything in the app with this backup (${data.periods.length} periods, ${data.expenses.length} expenses)?`)) return;
    restoreBackup(data);
    toast('Backup restored');
    if (!currentPeriod()) showPage('budget', { mode: 'first' });
  });
  const restore = el('label', { className: 'wide-btn' }, 'Restore from backup', file);

  // Whether the browser agreed to protect this app's storage from automatic cleanup.
  const storage = note(''); // filled in once the browser answers
  navigator.storage?.persisted?.().then((protectedStorage) => {
    storage.textContent = protectedStorage
      ? 'Storage: protected from automatic cleanup.'
      : 'Storage: standard. iOS may clear it if the phone runs very low on space.';
  }).catch(() => {});

  // Fills in once IndexedDB answers.
  const snapshotList = el('div', { className: 'snapshot-list' });
  readSnapshots().then((list) => snapshotList.replaceChildren(...list.map((snapshot) => {
    const when = formatMoment(snapshot.at);
    const goBackButton = el('button', { className: 'link', textContent: 'Go back' });
    goBackButton.addEventListener('click', async () => {
      if (!confirm(`Go back to how everything was ${when} (${snapshot.reason})? Your current data is snapshotted first, so you can undo this.`)) return;
      if (await restoreSnapshot(snapshot.at)) toast(`Back to ${when}`);
    });
    return el('div', { className: 'snapshot-row' },
      el('span', { className: 'grow' }, el('span', { textContent: when }), el('small', { textContent: snapshot.reason })),
      goBackButton);
  })));

  fill('Backup', 'Keep a copy of your data somewhere safe.',
    panel('Status',
      el('p', { className: `backup-status${status.stale ? ' bad' : ''}`, textContent: status.label }),
      reminderChoice(),
      el('p', { className: 'hint', textContent: 'Your data lives only on this phone, inside this home-screen app (separate from Safari). Deleting the app from your home screen erases it, so export a backup now and then and keep it in Files or iCloud Drive.' })),
    backupButton,
    csvButton,
    restore,
    note('Restoring replaces everything in the app with the backup.'),
    panel('Snapshots',
      snapshotList,
      el('p', { className: 'hint', textContent: 'Kept on this phone automatically: one a day, and one before anything drastic. For undoing mistakes; they\u2019re lost with the phone, unlike exported backups.' })),
    storage,
  );
}

// "Remind me to back up after: 7 · 14 · 30 · 60 days", in the FF8 Config style.
function reminderChoice() {
  const choices = REMINDER_CHOICES.map((days) => {
    const choice = el('button', { className: days === state.settings.backupReminderDays ? 'on' : '', textContent: String(days), 'aria-label': `${days} days` });
    choice.addEventListener('click', () => setBackupReminder(days));
    return choice;
  });
  return el('div', { className: 'reminder' },
    el('span', { className: 'label', textContent: 'Remind me to back up after' }),
    el('div', { className: 'reminder-row' }, el('div', { className: 'options' }, ...choices), el('span', { textContent: 'days' })));
}
