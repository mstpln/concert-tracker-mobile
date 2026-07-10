'use strict';
// Single source of truth for the app's build/cache version. Referenced by
// both app.js (displayed in Settings, so a stale-cache issue is obvious at
// a glance — this is exactly what caused the "new Settings section isn't
// showing up" bug on 2026-07-10) and service-worker.js (as CACHE_NAME, via
// importScripts). Bump this whenever you change any shell file (app.js,
// app.css, dataLib.js, icons.js, remoteStore.js, index.html) so old installs
// pick up the update.
const APP_VERSION = 'v13';
