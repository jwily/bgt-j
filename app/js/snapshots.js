// Safety snapshots: copies of all the data, kept on the phone in IndexedDB (which has far more room
// than localStorage): one a day (as the data was when the app was first opened that day) and one
// before anything drastic. Three are kept: the latest day's, and the newest two others (the user's
// choice of three; the day's is kept so a burst of drastic actions can't push it out). They undo mistakes; they don't protect against
// losing the phone (exported backups do), and they're never included in backups.
//
// IndexedDB answers asynchronously, but a snapshot's data is captured the moment takeSnapshot() is
// called, so one taken just before a change never includes that change.

import { state, parse, replaceState } from './store.js';
import { localDay, todayISO } from './dates.js';

const STORE = 'snapshots';     // { at, reason }: what the Backup screen lists, small
const DATA = 'snapshot-data';  // { at, data }: the copy itself (the saved JSON text), read only to use it
const LIMIT = 3;
const DAILY = 'start of the day';
const LEGACY_KEY = 'budget-tracker-snapshots'; // where snapshots lived before IndexedDB

let opening = null;
function database() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('budget-tracker', 2);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) db.createObjectStore(STORE, { keyPath: 'at' });
      if (event.oldVersion < 2) {
        // Version 1 kept each copy with its time and reason, so listing them read every copy in
        // full: the copies move to a store of their own.
        db.createObjectStore(DATA, { keyPath: 'at' });
        const [listed, copies] = [STORE, DATA].map((name) => request.transaction.objectStore(name));
        listed.openCursor().onsuccess = ({ target }) => {
          const cursor = target.result;
          if (!cursor) return;
          const { at, reason, data } = cursor.value;
          if (data !== undefined) {
            copies.put({ at, data });
            cursor.update({ at, reason });
          }
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opening;
}

// Runs work against the stores named (the list by default) in one transaction; resolves with the
// request's result once it's committed.
async function run(mode, work, stores = [STORE]) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    const request = work(...stores.map((name) => transaction.objectStore(name)));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error); // e.g. out of space, which fires no error
  });
}

// Newest first: [{ at, reason }]. Empty if IndexedDB fails.
export async function readSnapshots() {
  try {
    return (await run('readonly', (store) => store.getAll())).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

// A snapshot's data, as saved (JSON text), or null.
async function readCopy(at) {
  try {
    return (await run('readonly', (copies) => copies.get(at), [DATA]))?.data ?? null;
  } catch {
    return null;
  }
}

// Snapshot times, unique even for two in the same millisecond (they're the keys).
let lastAt = 0;
const nextAt = () => (lastAt = Math.max(Date.now(), lastAt + 1));

// Captures the data now; stores it in the background. Never throws: a snapshot failing must not
// get in the way of what the person is doing.
export function takeSnapshot(reason) {
  return keep([{ at: nextAt(), reason, data: JSON.stringify(state) }]);
}

// Stores snapshots ({ at, reason, data }), then drops all but LIMIT: the latest day's and the
// newest others.
async function keep(snapshots) {
  try {
    await run('readwrite', (listed, copies) => {
      for (const { at, reason, data } of snapshots) {
        listed.put({ at, reason });
        copies.put({ at, data });
      }
    }, [STORE, DATA]);
    const all = await readSnapshots();
    const daily = all.find((s) => s.reason === DAILY);
    const kept = new Set([daily, ...all.filter((s) => s !== daily).slice(0, daily ? LIMIT - 1 : LIMIT)]);
    const extra = all.filter((s) => !kept.has(s));
    if (extra.length) {
      await run('readwrite', (listed, copies) => {
        for (const { at } of extra) {
          listed.delete(at);
          copies.delete(at);
        }
      }, [STORE, DATA]);
    }
  } catch {
    // No snapshot this time.
  }
}

export async function takeDailySnapshot() {
  const data = JSON.stringify(state); // as it is right now, before today's changes
  const last = (await readSnapshots()).find((s) => s.reason === DAILY);
  if (last && localDay(last.at) === todayISO()) return;
  await keep([{ at: nextAt(), reason: DAILY, data }]);
}

// Goes back to a snapshot, after snapshotting the current data so this can be undone too.
// Keeps the newer "last backed up" time, since backups made since then still exist. Resolves once
// that new snapshot is stored (so a list read afterwards has it).
export async function restoreSnapshot(at) {
  const text = await readCopy(at);
  const data = text && parse(text);
  if (!data) return false;
  const taken = takeSnapshot('before going back to a snapshot');
  replaceState({ ...data, lastBackupAt: Math.max(data.lastBackupAt ?? 0, state.lastBackupAt ?? 0) || null });
  await taken;
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
  for (const { at } of await readSnapshots()) {
    const text = await readCopy(at);
    const data = text && parse(text);
    if (data) {
      replaceState(data);
      return at;
    }
  }
  return null;
}
