'use strict';
// Minimal service worker — only here to satisfy PWA installability
// (Chrome requires one) and let the app shell load instantly/offline.
// It deliberately does NOT cache anything from the Cloudflare Worker (your
// actual data) — those requests always go straight to the network so you
// never see stale bands/concerts.
//
// CACHE_NAME_LITERAL below is intentionally a hardcoded literal, NOT
// derived from version.js via importScripts (an earlier version did that,
// and it was a real bug found during a QA pass): browsers only re-check a
// service worker for updates by re-fetching service-worker.js itself and
// byte-comparing it to the currently-installed copy. If this file's own
// bytes are unchanged, the browser never notices anything changed and
// never reinstalls — even if an imported file's *content* changed — so an
// already-installed user stays on the old cached shell indefinitely,
// regardless of what version.js says. The fetch handler below is
// cache-first for every same-origin request, which is exactly what made
// this silent-staleness bug possible in the first place.
//
// So: every time you bump APP_VERSION in version.js, you MUST also bump
// CACHE_NAME_LITERAL here to the same value — that's what actually forces
// old installs to update. version.js's importScripts is kept below purely
// so this file can sanity-assert the two stay in sync (see the console
// warning) — it is NOT what drives cache invalidation.
importScripts('./version.js');
const CACHE_NAME_LITERAL = 'v50';
if (CACHE_NAME_LITERAL !== APP_VERSION) {
  console.warn(
    `service-worker.js CACHE_NAME_LITERAL ("${CACHE_NAME_LITERAL}") is out of sync with version.js APP_VERSION ("${APP_VERSION}") — bump CACHE_NAME_LITERAL in service-worker.js to match, otherwise old installs won't update.`
  );
}
const CACHE_NAME = 'concert-tracker-shell-' + CACHE_NAME_LITERAL;
const SHELL_FILES = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './dataLib.js',
  './icons.js',
  './remoteStore.js',
  './musicbrainzState.js',
  './weather.js',
  './spotifyUser.js',
  './version.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Plain cache.addAll(urls) issues default-mode fetch() calls, which
      // are free to be satisfied from the browser's ordinary HTTP disk
      // cache instead of the network — found via a live QA check: a fresh
      // 'v14' cache still had 'v13' bytes for version.js because the
      // install-time fetch reused a stale disk-cached response instead of
      // actually hitting the network. { cache: 'reload' } forces every
      // shell file to be freshly fetched from the network on install,
      // which is the whole point of bumping CACHE_NAME_LITERAL in the
      // first place.
      Promise.all(
        SHELL_FILES.map((url) => fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res)))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin) return; // let Worker/API/CDN requests go straight to network, uncached

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
