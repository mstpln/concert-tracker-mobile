'use strict';
// Human-readable build/version label, displayed in Settings so a
// stale-cache issue is obvious at a glance (this is exactly what caused
// the "new Settings section isn't showing up" bug on 2026-07-10).
//
// IMPORTANT — found during a later QA pass: bumping this value ALONE does
// NOT bust old installs' cache. service-worker.js deliberately does not
// derive its actual CACHE_NAME from this file at runtime, because browsers
// only detect a service worker update by byte-comparing service-worker.js
// itself — an unrelated file's content changing (this one) is invisible to
// that check. Whenever you bump APP_VERSION here, you must ALSO bump
// CACHE_NAME_LITERAL in service-worker.js to the same value; that second
// edit is what actually forces old installs to update. service-worker.js
// has a console.warn() safety check if the two ever drift apart.
const APP_VERSION = 'v60';
