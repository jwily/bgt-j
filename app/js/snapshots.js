// Safety snapshots: copies of all the data, kept on the phone in IndexedDB (which has far more room
// than localStorage): one a day (as the data was when the app was first opened that day) and one
// before anything drastic. The newest 7 are kept. They undo mistakes; they don't protect against
// losing the phone (exported backups do), and they're never included in backups.
//
// IndexedDB answers asynchronously, but a snapshot's data is captured the moment takeSnapshot() is
// called, so one taken just before a change never includes that change.

import { state, parse, replaceState } from './store.js';

const STORE = 'snapshots';
const LIMIT = 7;
const DAILY = 'start of the day';
const LEGACY_KEY = 'budget-tracker-snapshots'; // where snapshots lived before IndexedDB

let opening = null;
function database() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('budget-tracker', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'at' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

// Runs work against the snapshot store in one transaction; resolves with the request's result
// once it's committed.
async function run(mode, work) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = work(transaction.objectStore(STORE));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

// Newest first: [{ at, reason, data }] (data is the saved JSON text). Empty if IndexedDB fails.
export async function readSnapshots() {
  try {
    return (await run('readonly', (store) => store.getAll())).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

let lastAt = 0;
// Captures the data now; stores it in the background. Never throws: a snapshot failing must not
// get in the way of what the person is doing.
export function takeSnapshot(reason) {
  lastAt = Math.max(Date.now(), lastAt + 1); // unique keys, even for two in the same millisecond
  return keep([{ at: lastAt, reason, data: JSON.stringify(state) }]);
}

async function keep(snapshots) {
  try {
    await run('readwrite', (store) => { snapshots.forEach((s) => store.put(s)); });
    const extra = (await readSnapshots()).slice(LIMIT);
    if (extra.length) await run('readwrite', (store) => { extra.forEach((s) => store.delete(s.at)); });
  } catch {
    // No snapshot this time.
  }
}

export async function takeDailySnapshot() {
  const data = JSON.stringify(state); // as it is right now, before today's changes
  const last = (await readSnapshots()).find((s) => s.reason === DAILY);
  if (last && new Date(last.at).toDateString() === new Date().toDateString()) return;
  lastAt = Math.max(Date.now(), lastAt + 1);
  await keep([{ at: lastAt, reason: DAILY, data }]);
}

// Goes back to a snapshot, after snapshotting the current data so this can be undone too.
// Keeps the newer "last backed up" time, since backups made since then still exist.
export async function restoreSnapshot(at) {
  const snapshot = (await readSnapshots()).find((s) => s.at === at);
  const data = snapshot && parse(snapshot.data);
  if (!data) return false;
  takeSnapshot('before going back to a snapshot');
  replaceState({ ...data, lastBackupAt: Math.max(data.lastBackupAt ?? 0, state.lastBackupAt ?? 0) || null });
  return true;
}

// Snapshots saved by earlier versions of the app lived in localStorage; move them here.
export async function moveOldSnapshots() {
  let old;
  try {
    old = JSON.parse(localStorage.getItem(LEGACY_KEY));
  } catch {
    old = null;
  }
  if (Array.isArray(old) && old.length) await keep(old);
  localStorage.removeItem(LEGACY_KEY);
}

// When the saved data couldn't be read: load the newest readable snapshot. Returns its time, or
// null if there wasn't one.
export async function recoverFromSnapshot() {
  for (const snapshot of await readSnapshots()) {
    const data = parse(snapshot.data);
    if (data) {
      replaceState(data);
      return snapshot.at;
    }
  }
  return null;
}
