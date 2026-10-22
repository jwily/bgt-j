// Network-first: fetch the latest files when online, fall back to the cache when offline.
// Because of this, changes you deploy show up on the next launch without bumping a version.
// Every fetch skips the browser's own HTTP cache ('no-cache': it asks the server whether the file
// changed, a tiny "not modified" reply when it hasn't). GitHub Pages lets browsers reuse files
// for 10 minutes unchecked, which otherwise kept old files running after a deploy, sometimes
// mixed with new ones.

const CACHE = 'budget-tracker';
const FILES = [
  './', 'index.html', 'style.css', 'manifest.json', 'icons/icon-180.png', 'icons/icon-512.png',
  'js/app.js', 'js/store.js', 'js/money.js', 'js/ui.js', 'js/input.js', 'js/sheets.js', 'js/pages.js', 'js/backup.js', 'js/snapshots.js', 'js/dates.js',
  'fonts/nunito-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'no-cache' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// The font and icons never change between versions, so they come straight from the cache when it
// has them: no waiting on the network at launch (on a slow connection that made the font arrive
// after the app appeared, so its text visibly swapped fonts).
const UNCHANGING = /\/(fonts|icons)\//;

self.addEventListener('fetch', (event) => {
  // Leave other sites (like the exchange-rate API) alone; the app handles those itself.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (UNCHANGING.test(new URL(event.request.url).pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    })));
    return;
  }
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
