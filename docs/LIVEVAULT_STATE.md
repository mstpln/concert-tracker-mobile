# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by an authenticated Cloudflare Worker and private R2. The established production JSON files remain `bands.json`, `concerts.json`, `news.json`, and `apiUsage.json`; ticket PDF bytes are separate authenticated R2 objects.

Security Builds 1-3 are merged. The v76 Worker security changes are deployed, browser writes are verified on computer and mobile, and a successful production structured research run verified the separate `AUTOMATION_TOKEN`. The temporary legacy `API_TOKEN` has been removed from Cloudflare and browser alert-status writes were verified afterward.

v77 is merged on `main` at `50ee9cb9cafb1af7d89cc2ea3f1020bef1c889fd`. The current correction branch is `fix/v77-ticketmaster-cap-enable-schedules`. It keeps the unreleased app version/cache at v77, raises the Ticketmaster run cap for complete band coverage and enables the approved recurring research schedules after merge.

## Product purpose and navigation

This is a single-user concert tracker for followed bands, upcoming shows, attended history, concert alerts, Spotify releases, venues, statistics and user-owned concert preparation. Bottom navigation is **Concerts**, **Dates**, **Bands**, **Stats**, and **Alerts**. Settings, band profiles, Full Top Bands and venue details are secondary screens.

## Major screens

My Concerts shows a three-band listening preview, the compact concert summary, upcoming/attended shows and preparation. Concert Dates provides concert and venue browsing. My Bands lists followed artists. Alerts is headed **ALERTS** and uses **Concerts** and **Releases** subtabs. Band profiles use **Concerts**, **Alerts**, **Releases**, **Listening**, and **Data** tabs. Internal `news` identifiers and `news.json` remain for backward compatibility.

## Listening statistics and private history

Historical Spotify listening data is imported only from a sanitized LiveVault file into browser-local IndexedDB. The raw Spotify ZIP and sanitized personal history are never committed, added to QA, written to R2 or sent to providers in bulk. The import excludes Spotify Kids, podcasts, video, audiobooks and plays shorter than 30 seconds. Retained event fields are timestamp, artist, track, album, played duration, Spotify track ID, deterministic stable ID and source marker.

The sanitized import contains 250,403 eligible unique track listens from 2009-01-16 through 2026-07-29. Imported artist names are matched conservatively to existing LiveVault bands. Listening statistics intentionally include only events mapped to bands already present in LiveVault. The broken Top Tracks artwork path is deferred to the next Listening UI project and is not part of v77.

## Security foundation and credential rollout

The deployed security builds provide:

- safe external navigation, no-referrer/CSP protections, scoped service-worker caches and removal of the third-party Excel runtime;
- authenticated Worker validation, bounded JSON writes and private no-store responses;
- ETag-based conditional writes with one deterministic reread/merge/retry on stale data;
- preservation of stable IDs, unknown fields, user-owned fields and unrelated provider updates;
- distinct Disconnect and Erase this device controls;
- separate browser, automation and read-only credential roles;
- default 30-second browser and automation request timeouts without hidden generic retries;
- read-only workflow repository permissions and pinned GitHub Action SHAs.

The credential migration is complete: `BROWSER_TOKEN` and `AUTOMATION_TOKEN` are verified, `READ_ONLY_TOKEN` remains scoped to smoke checks, and the legacy `API_TOKEN` has been removed.

## v77 focused research workflows

v77 narrows research to the information the user wants and separates providers by their appropriate cadence.

### Structured provider workflow

- Runs Monday, Wednesday and Friday at 01:00 UTC after the correction branch is merged.
- Uses Ticketmaster for structured concert discovery across all bands.
- Uses Spotify for actual catalogue releases that are available to listen to.
- Retains MusicBrainz identity/deduplication support and existing setlist/prediction maintenance.
- Makes no Tavily or Groq calls.
- Spotify and MusicBrainz release refresh eligibility is three days.
- The Ticketmaster per-run cap is 650, providing coverage for the current 296-band library plus identity resolution, retries and growth headroom while remaining well below the 5,000-call daily allowance.

### Focused Tavily concert workflow

- Runs on the 1st and 15th of each month after the correction branch is merged.
- Uses Tavily plus Groq only for upcoming concert and festival dates missed by structured sources.
- Does not search for releases, hiatuses, breakups, reunions, lineup changes, interviews or general news.
- Prioritizes each newly added band’s first web concert check.
- Repeated empty results back off for 30 days, then 60 days, then recurring 90-day intervals.
- A later concert observation resets the backoff to the active 28-day supplemental cadence.
- Existing mandatory full-date, upcoming-only, tribute-act, source and duplicate protections remain.

Both workflows use the shared `live-vault-data-writes` concurrency group, existing UsageTracker controls and conditional Worker writes.

## Spotify Releases feed

The visible Releases feed accepts only actual Spotify catalogue releases with a trusted Spotify release ID and album URL. It displays available artwork, release title/type/date and an Open in Spotify action. Missing artwork falls back locally without suppressing an otherwise valid release.

The v77 production rollout includes an idempotent cleanup of `news.json` that removes legacy general articles, status news, Tavily release announcements and concert/ticket articles. Concert alerts continue to derive from `concerts.json`. The cleanup logs aggregate before/after counts only, creates a rollback artifact and has not yet been run against production.

## Data model and ownership

Bands contain stable IDs, artist identity, follow state and additive research-routing state. Concerts contain stable IDs, date/venue/source observations and additive preparation/research data. `news.json` remains the compatibility container for Spotify release items only after cleanup. User-owned fields include attendance, manual concerts, ticket price/quantity, ticket PDFs/links, playlists, checklist, ratings, notes, photos, favourites, mute state and review decisions. Provider-owned fields remain confined to their owned allowlists. Browser-local state includes settings, caches, OAuth state and imported listening history.

## Design and QA rules

The app is mobile-first. Focused changes preserve the existing blue/black/grey/white design, text-only top banner, navigation, ticket CTA hierarchy and profile structure. QA uses fictional data and the fake backend only. Automated tests must not contain the user's listening history or call live providers. Physical installation, installed-PWA cache refresh and final real-device touch/visual review remain device-specific manual checks.

## Active backlog

1. Review and merge the focused v77 Ticketmaster-cap and schedule-activation correction only after explicit `Merge it`
2. Separately authorize and run the backed-up `news.json` cleanup
3. Verify v77 on mobile and computer after GitHub Pages refresh
4. Listening UI project, including reliable Top Tracks artwork
5. Real ListenBrainz account connection and incremental synchronization
6. Concert Map View
7. Expanded Backup, Restore and Export
8. Native Push Notifications

## Development workflow

Approve scope, use a branch, implement and test, maintain state/decisions/build state, push and review a PR, then merge only after explicit `Merge it`. A version/cache bump is not deployment permission. Production workflows, production data writes, cleanup, provider calls and schedule activation require separate explicit authorization.
