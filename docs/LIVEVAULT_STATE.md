# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by an authenticated Cloudflare Worker and private R2. The established production JSON files remain `bands.json`, `concerts.json`, `news.json`, and `apiUsage.json`; ticket PDF bytes are separate authenticated R2 objects.

Security Build 1 is merged and manually deployed at **v74**. The current unreleased branch is **v75** on `security/v75-stale-write-protection`. It adds conditional JSON writes and conflict recovery without changing stored schemas, provider ownership or user-facing design.

## Product purpose and navigation

This is a single-user concert tracker for followed bands, upcoming shows, attended history, alerts/news, releases, venues, statistics and user-owned concert preparation. Bottom navigation is **Concerts**, **Dates**, **Bands**, **Stats**, and **Alerts**. Settings, band profiles, Full Top Bands and venue details are secondary screens.

## Major screens

My Concerts shows a three-band listening preview, the compact concert summary, upcoming/attended shows and preparation. Concert Dates provides concert and venue browsing. My Bands lists followed artists. Alerts has alerts/news subtabs. Settings contains usage, identity coverage, app options and private listening-history import controls. Stats is a primary destination with Listening and Concerts subtabs; Listening is default and the existing concert-statistics content remains under Concerts. A dedicated Top Bands ranking supports 3 months, 1 year and All time. Band profiles use Concerts, Alerts, News, Listening and Data tabs, with Concerts default.

## Listening statistics and private history

Historical Spotify listening data is imported only from a sanitized LiveVault file into browser-local IndexedDB. The raw Spotify ZIP and sanitized personal history are never committed, added to QA, written to R2 or sent to providers in bulk. The import excludes Spotify Kids, podcasts, video, audiobooks and plays shorter than 30 seconds. Retained event fields are timestamp, artist, track, album, played duration, Spotify track ID, deterministic stable ID and source marker.

The sanitized import contains 250,403 eligible unique track listens from 2009-01-16 through 2026-07-29. Imported artist names are matched conservatively to existing LiveVault bands. Listening statistics intentionally include only events mapped to bands already present in LiveVault.

v72 corrects the listening experience to use the term **listens**, supports the complete all-time history without spread-argument failure, shows Top 3 on Start, Top 10 in Stats and up to Top 100 in the full ranking, and derives genre groups from stored LiveVault band genres. Screens retain independent timeframe state.

## v72 visual and concert-card corrections

Only the two summary cards on the My Concerts Start page use a thin blue outline: Your Top Bands and the compact concert summary. Their footer areas stay dark rather than filled blue. The full Concert Stats tab remains unchanged.

Upcoming and past concert cards use the approved subtle blue-tinted surface wherever the shared concert-card design appears. Year groupings show only the year and show count. Upcoming concert cards show the band's rolling previous-three-month listening total; past cards show the three months immediately before the concert. Calculated listening values are never written into concert records.

The Concert Dates header uses the calendar icon family. Past-concert rating stars are doubled in width and height. Spotify Top Track artwork is resolved only from the minimal visible track IDs through the existing browser-side Spotify authorization and cached locally; failures retain placeholders and never affect the listening history.

## v74 focused security hardening

The live v74 release adds proportionate direct-risk protections:

- browser navigation permits same-origin links and HTTPS external links only, adds `noopener noreferrer`, and blocks unsafe schemes;
- the Excel export control is removed so the app no longer executes SheetJS from a third-party CDN; CSV export remains available;
- the document declares a no-referrer policy and a compatible self-script content security policy;
- Worker JSON writes require `application/json`, are limited to 10 MB, and must match the expected top-level array/object shape while preserving unknown fields;
- authenticated Worker responses use `private, no-store`, `nosniff`, and no-referrer headers;
- production service-worker activation deletes only obsolete `concert-tracker-shell-*` caches, while synthetic QA keeps its separate `concert-tracker-qa-*` namespace.

## v75 stale-write protection

The unreleased v75 branch adds one shared concurrency contract across the browser, Cloudflare Worker and GitHub Actions writers:

- Worker JSON reads expose the current R2 `ETag`;
- writes to an existing JSON document require `If-Match` and are performed atomically through R2 conditional `put`;
- creation uses `If-None-Match: *` and remains compatible with first-time setup;
- a stale write receives HTTP `412` instead of silently replacing newer data;
- browser and automation clients reread once, perform a deterministic three-way merge, and retry once with the newest ETag;
- stable-ID record arrays preserve remote additions, locally added records, unknown fields and unrelated concurrent field changes;
- a stale deletion is applied only when the remote record is unchanged from the original read; a remotely changed record is preserved;
- successful conflict recovery reconciles the caller's in-memory array/object so a later save cannot accidentally remove the merged remote data.

Ticket PDF routes are unchanged. No production data, provider calls, credential roles or stored-data migrations are part of v75. The new Worker code requires manual deployment after merge.

## Data model and ownership

Bands contain stable IDs, artist identity and follow state. Concerts contain stable IDs, date/venue/source observations and additive preparation/research data. Alerts/news use stable band IDs. User-owned fields include attendance, manual concerts, ticket price/quantity, ticket PDFs/links, playlists, checklist, ratings, notes, photos, favourites, mute state and review decisions. Provider-owned fields remain confined to their owned allowlists. Browser-local state includes settings, caches, OAuth state and imported listening history.

## Design and QA rules

The app is mobile-first. Focused changes preserve the existing blue/black/grey/white design, text-only top banner, navigation, ticket CTA hierarchy and profile tabs. QA uses fictional data and the fake backend only. Automated tests must not contain the user's listening history. Physical installation, large-file picker behavior, mobile storage quotas, installed-PWA cache refresh and final real-device touch/visual review remain device-specific manual checks.

## Active backlog

1. Complete and deploy security Build 2: v75 ETag and stale-write protection
2. Complete security Build 3: local erasure, credential separation and provider/workflow hardening
3. Real ListenBrainz account connection and incremental synchronization
4. MusicBrainz recording/release matching and optional artwork enrichment
5. Concert Map View
6. Expanded Backup, Restore and Export
7. Native Push Notifications

## Development workflow

Approve scope, use a branch, implement and test, maintain state/decisions/build state, push and review a PR, then merge only after explicit `Merge it`. A version/cache bump is not deployment permission. Production workflows, production data writes and provider calls require separate explicit authorization.
