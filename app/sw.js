// Makes the app launch instantly and work offline. Every launch is served entirely from a saved
// copy of the app's files on the phone, so starting never waits on the network. In the background,
// each launch downloads the files again (asking the server, past the browser's own cache, which
// GitHub Pages lets keep files for 10 minutes); if all of them arrive and any has changed, they're
// saved together as a complete new version, which the next launch uses. So a deployed change
// shows up one launch later, and the app never runs a mix of old and new files: each launch keeps
// to the version it started with for every file it loads, even if a newer one arrives meanwhile.

const PREFIX = 'bgt-j-';       // saved versions are caches named bgt-j-<time saved>
const COMPLETE = '__complete__'; // written last: a version without it is unfinished and never used
const FILES = [
  './', 'index.html', 'style.css', 'manifest.json', 'icons/icon-180.png', 'icons/icon-512.png',
  'js/app.js', 'js/store.js', 'js/money.js', 'js/ui.js', 'js/input.js', 'js/sheets.js', 'js/pages.js', 'js/backup.js', 'js/snapshots.js', 'js/dates.js',
  'js/palette.js', 'js/presses.js', 'js/keyboard.js', 'js/help.js', 'js/widgets.js',
  'js/screens/summary.js', 'js/screens/periods.js', 'js/screens/categories.js', 'js/screens/backup.js', 'js/screens/budget.js',
  'js/party.js', 'sprites/party.png', 'fonts/nunito-latin.woff2',
];

// The newest complete saved version's name, or null if there isn't one yet.
async function currentVersion() {
  const names = (await caches.keys()).filter((name) => name.startsWith(PREFIX)).sort().reverse();
  for (const name of names) {
    if (await (await caches.open(name)).match(COMPLETE)) return name;
  }
  return null;
}

// Which version each open launch (page) started with, so all of its files come from that one. Kept
// in a cache as well (iOS stops an idle service worker, and its memory goes with it), and read back
// the first time it's needed after a restart.
const LAUNCHES = 'launches-bgt-j'; // not PREFIX: it's not a version, and version clean-up skips it
let loadingLaunches = null;
// (Never fails: every file is served through it, so a problem here means starting with no record.)
const launches = () => (loadingLaunches ??= (async () => {
  try {
    const saved = await (await caches.open(LAUNCHES)).match('launches');
    return new Map(saved ? Object.entries(await saved.json()) : []);
  } catch {
    return new Map();
  }
})());
async function rememberLaunches() {
  try {
    const versionOf = await launches();
    await (await caches.open(LAUNCHES)).put('launches', new Response(JSON.stringify(Object.fromEntries(versionOf))));
  } catch {
    // Kept in memory still; written next time.
  }
}

const sameBytes = (a, b) => {
  if (a.byteLength !== b.byteLength) return false;
  const [x, y] = [new Uint8Array(a), new Uint8Array(b)];
  return x.every((byte, i) => byte === y[i]);
};

// Downloads every file; if all arrived and any differs from the saved version, saves them as a new
// complete version, keeping just the one it replaces. A failure (e.g. offline) changes nothing.
async function checkForUpdate() {
  try {
    const downloads = await Promise.all(FILES.map(async (file) => {
      const response = await fetch(new Request(file, { cache: 'no-cache' }));
      if (!response.ok) throw new Error(`${file}: ${response.status}`);
      return [file, response];
    }));
    const savedName = await currentVersion();
    const saved = savedName && await caches.open(savedName);
    if (saved) {
      let changed = false;
      for (const [file, response] of downloads) {
        const old = await saved.match(file);
        if (!old || !sameBytes(await old.arrayBuffer(), await response.clone().arrayBuffer())) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
    }
    const name = `${PREFIX}${Date.now()}`;
    const next = await caches.open(name);
    await Promise.all(downloads.map(([file, response]) => next.put(file, response)));
    await next.put(COMPLETE, new Response('ok'));
    // Keep the version just replaced and any an open launch is still using (a resumed one can stay
    // open for days, across deploys); drop the rest, and forget launches that have closed. Only
    // this app's caches: other pages on the same site have their own.
    const inUse = new Set([name, savedName]);
    const versionOf = await launches();
    for (const [client, version] of versionOf) {
      if (await self.clients.get(client)) inUse.add(version);
      else versionOf.delete(client);
    }
    await rememberLaunches();
    for (const other of await caches.keys()) if (other.startsWith(PREFIX) && !inUse.has(other)) await caches.delete(other);
  } catch {
    // Offline or a download failed: keep the saved version; try again next launch.
  }
}

// One check at a time. A launch while one is running asks for another right after it: the running
// one may have started before the newest version was deployed.
let updating = null;
let checkAgain = false;
function update() {
  if (updating) {
    checkAgain = true;
    return updating;
  }
  updating = (async () => {
    do {
      checkAgain = false;
      await checkForUpdate();
    } while (checkAgain);
    updating = null;
  })();
  return updating;
}

self.addEventListener('install', (event) => {
  event.waitUntil(update());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// The app asks for a check too when it comes back from the background (iOS resumes it more than it
// relaunches it), and at launch which version it's running (app.js says "App updated" when that
// changes).
self.addEventListener('message', (event) => {
  if (event.data === 'check-for-update') event.waitUntil(update());
  if (event.data === 'which-version') {
    event.waitUntil(launches().then((versionOf) => event.source.postMessage({ version: versionOf.get(event.source.id) ?? null })));
  }
});

self.addEventListener('fetch', (event) => {
  // Leave other sites (like the exchange-rate API) alone; the app handles those itself.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const launching = event.request.mode === 'navigate';
  event.respondWith((async () => {
    const versionOf = await launches();
    let name = launching ? null : versionOf.get(event.clientId);
    if (name && !(await caches.has(name))) name = null; // gone after all: opening it would make an empty one
    if (!name) {
      name = await currentVersion();
      if (launching && name) {
        versionOf.set(event.resultingClientId, name);
        const remembering = rememberLaunches(); // written in the background: the launch doesn't wait for it
        try {
          event.waitUntil(remembering);
        } catch {
          // The event can no longer be extended; the write goes ahead regardless.
        }
      }
    }
    const saved = name && await caches.open(name);
    return (await saved?.match(event.request, { ignoreSearch: true })) ?? fetch(event.request);
  })());
  // Each launch (the page itself loading) fetches any new version in the background, for next time.
  if (launching) event.waitUntil(update());
});
