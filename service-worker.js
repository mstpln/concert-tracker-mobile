'use strict';
// Minimal service worker — only here to satisfy PWA installability
// (Chrome requires one) and let the app shell load instantly/offline.
// It deliberately does NOT cache anything from the Cloudflare Worker (your
// actual data) — those requests always go straight to the network so you
// never see stale bands/concerts. Bump CACHE_NAME when you change any of
// the shell files below, so old installs pick up the update.

const CACHE_NAME = 'concert-tracker-shell-v4';
const SHELL_FILES = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './dataLib.js',
  './icons.js',
  './remoteStore.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
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
