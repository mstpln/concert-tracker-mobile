# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by an authenticated Cloudflare Worker and private R2. The production JSON files remain `bands.json`, `concerts.json`, `news.json`, and `apiUsage.json`; ticket PDF bytes are separate authenticated R2 objects.

`main` is at matching app/cache version **v70** and contains the merged listening-statistics Phase 1. The pending branch `feature/spotify-history-import` prepares **v71** with matching `APP_VERSION` and `CACHE_NAME_LITERAL`. Nothing from v71 is merged or deployed.

## Product purpose and navigation

This is a single-user concert tracker for followed bands, upcoming shows, attended history, alerts/news, releases, venues, statistics and user-owned concert preparation. Bottom navigation is **Concerts**, **Dates**, **Bands**, **Stats**, and **Alerts**. Settings, band profiles, Full Top Bands and venue details are secondary screens.

## Major screens

My Concerts shows a three-band listening preview, the existing concert summary, upcoming/attended shows and preparation. Concert Dates provides concert and venue browsing. My Bands lists followed artists. Alerts has alerts/news subtabs. Settings contains usage, identity coverage, app options and, on the pending v71 branch, private listening-history import controls. Stats is a primary destination with Listening and Concerts subtabs; Listening is default and the existing concert-statistics content remains under Concerts. A dedicated Top Bands ranking supports 3 months, 1 year and All time. Band profiles use Concerts, Alerts, News, Listening and Data tabs, with Concerts default.

## Concert preparation and show day

Upcoming attending concerts support a readiness checklist, manual or generated playlist state, weather, predicted setlist, owned tickets and directions. Past cards can show actual setlists, Spotify song links, ratings, notes, photos and live-performance insights. One saved ticket uses the established yellow ticket CTA with an outlined directions CTA beside it; two PDFs use equal Ticket 1/Ticket 2 controls and full-width outlined directions beneath.

## Data model and ownership

Bands contain stable IDs, artist identity and follow state. Concerts contain stable IDs, date/venue/source observations and additive preparation/research data. Alerts/news use stable band IDs. User-owned fields include attendance, manual concerts, ticket price/quantity, ticket PDFs/links, playlists, checklist, ratings, notes, photos, favourites, mute state and review decisions. Provider-owned fields are confined to their owned allowlists. Browser-local state includes settings, caches, OAuth state and, on v71, imported Spotify listening history stored in IndexedDB. R2 stores the established production JSON files and private ticket bytes only.

## Listening statistics

v70 provides the five-item navigation, Stats shell, Listening/Concerts subtabs, My Concerts Top Bands preview, Full Top Bands page and Band Detail Listening tab. `listeningStats.js` is the shared pure aggregation layer. QA uses deterministic synthetic events from `listeningFixtures.js` only when the explicit QA flag is enabled; production never presents those fixtures as user history.

Listening periods use shared deterministic rules: three months uses weekly buckets, one year uses monthly buckets and All time uses yearly buckets. Movement compares the immediately preceding equivalent period and is omitted for All time. MusicBrainz MBID remains the preferred future local-band identity bridge. ListenBrainz remains the planned ongoing listening source.

## Pending v71 private Spotify history import

The pending v71 branch adds a browser-local import path for the user's sanitized Spotify extended streaming history. The original Spotify ZIP and the sanitized personal history file are never committed to GitHub, added to QA fixtures, written to Cloudflare R2 or sent to Spotify, ListenBrainz, MusicBrainz or any other provider.

The approved sanitizer rules are:

- exclude the separate Spotify Kids export;
- exclude podcasts, video and audiobooks;
- exclude plays shorter than 30 seconds;
- retain only timestamp, artist, track, album, played duration and Spotify track ID, plus a deterministic stable import ID and source marker required by the app;
- discard IP address, country/location, platform/device, playback context, search history, account identifiers, usernames, email addresses, passwords and all unexpected fields.

The sanitized import contains **250,403** eligible unique track listens from **2009-01-16** through **2026-07-29**. During sanitization, 35,650 plays under 30 seconds, 3,883 non-track records and 4,999 duplicate stable events were excluded. The private file is stored only when the user selects it through Settings; the app then validates every event again against the strict allowlist before replacing the browser-local IndexedDB collection.

Imported artist names are matched conservatively to existing followed bands by normalized exact name for band-specific rankings and drill-down. The stable import ID is deterministic so a future ListenBrainz adapter can deduplicate overlapping events instead of double-counting them. No provider call, production schema change, Worker allowlist change or R2 migration is part of v71.

## Identity and research

MusicBrainz MBID is the artist backbone. Ticketmaster attraction and Spotify artist identifiers are nested under the MusicBrainz identity. `confirmed`, `manual_confirmed` and `auto_confirmed` are trusted; review and error states retain retry/candidate metadata. Research uses Ticketmaster, Tavily, Groq, MusicBrainz, Spotify, setlist.fm and geocoding through UsageTracker pacing and caps. Coordinated writes reread latest records and preserve user-owned and unknown fields.

## Structured release lifecycle

The release lifecycle has Album Announced, New Single, Upcoming Release and Out Today stages. Initial, partial and historical provider baselines remain silent. Upcoming Release is album/EP-only, fires exactly seven days before a full date and is suppressed for 14 days after Album Announced. Singles never receive Upcoming Release. Existing generic structured album alerts remain compatible and render safely.

## Ticketmaster precedence and data safety

Ticketmaster can enrich an existing Tavily/Groq concert only for confident same-band/same-date evidence. Exact event-ID matches also require the same band and date. Different dates, IDs or ambiguous records remain separate. Stable IDs are never recreated, user fields and unknown future fields survive, and latest remote records are reread before merging.

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
