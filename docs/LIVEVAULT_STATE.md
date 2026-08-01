# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by an authenticated Cloudflare Worker and private R2. The established production JSON files remain `bands.json`, `concerts.json`, `news.json`, and `apiUsage.json`; ticket PDF bytes are separate authenticated R2 objects.

The current build is synchronized at **v73**. It contains the private local Spotify-history importer, the v72 listening and concert-card corrections, and a focused service-worker cache refresh so already-installed PWAs fetch the corrected shell instead of remaining on the earlier v72 cache.

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

## Data model and ownership

Bands contain stable IDs, artist identity and follow state. Concerts contain stable IDs, date/venue/source observations and additive preparation/research data. Alerts/news use stable band IDs. User-owned fields include attendance, manual concerts, ticket price/quantity, ticket PDFs/links, playlists, checklist, ratings, notes, photos, favourites, mute state and review decisions. Provider-owned fields remain confined to their owned allowlists. Browser-local state includes settings, caches, OAuth state and imported listening history.

## Design and QA rules

The app is mobile-first. Focused changes preserve the existing blue/black/grey/white design, text-only top banner, navigation, ticket CTA hierarchy and profile tabs. QA uses fictional data and the fake backend only. Automated tests must not contain the user's listening history. Physical installation, large-file picker behavior, mobile storage quotas, installed-PWA cache refresh and final real-device touch/visual review remain device-specific manual checks.

## Active backlog

1. Real ListenBrainz account connection and incremental synchronization
2. MusicBrainz recording/release matching and optional artwork enrichment
3. Concert Map View
4. Expanded Backup, Restore and Export
5. Native Push Notifications

## Development workflow

Approve scope, use a branch, implement and test, maintain state/decisions/build state, push and review a PR, then merge only after explicit `Merge it`. A version/cache bump is not deployment permission. Production workflows, production data writes and provider calls require separate explicit authorization.
