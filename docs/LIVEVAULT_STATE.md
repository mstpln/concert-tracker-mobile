# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by an authenticated Cloudflare Worker and private R2. The established production JSON files remain `bands.json`, `concerts.json`, `news.json`, and `apiUsage.json`; ticket PDF bytes are separate authenticated R2 objects.

Security Build 1 is merged and deployed at **v74**. Security Build 2 is merged at **v75**. Security Build 3 and its focused R2 conditional-write correction are merged and manually deployed at **v76**. Browser writes have been verified on computer and mobile. GitHub Actions now holds the separate automation credential, but the legacy `API_TOKEN` must remain until one production automation run succeeds with that credential.

The current development branch is `feature/v77-focused-research-workflows`. It prepares **v77** and has not been merged or deployed.

## Product purpose and navigation

This is a single-user concert tracker for followed bands, upcoming shows, attended history, concert alerts, Spotify releases, venues, statistics and user-owned concert preparation. Bottom navigation is **Concerts**, **Dates**, **Bands**, **Stats**, and **Alerts**. Settings, band profiles, Full Top Bands and venue details are secondary screens.

## Major screens

My Concerts shows a three-band listening preview, the compact concert summary, upcoming/attended shows and preparation. Concert Dates provides concert and venue browsing. My Bands lists followed artists. Alerts is headed **ALERTS** and v77 changes its subtabs to **Concerts** and **Releases**. Band profiles use **Concerts**, **Alerts**, **Releases**, **Listening**, and **Data** tabs. Internal `news` identifiers and `news.json` remain for backward compatibility.

## Listening statistics and private history

Historical Spotify listening data is imported only from a sanitized LiveVault file into browser-local IndexedDB. The raw Spotify ZIP and sanitized personal history are never committed, added to QA, written to R2 or sent to providers in bulk. The import excludes Spotify Kids, podcasts, video, audiobooks and plays shorter than 30 seconds. Retained event fields are timestamp, artist, track, album, played duration, Spotify track ID, deterministic stable ID and source marker.

The sanitized import contains 250,403 eligible unique track listens from 2009-01-16 through 2026-07-29. Imported artist names are matched conservatively to existing LiveVault bands. Listening statistics intentionally include only events mapped to bands already present in LiveVault. The broken Top Tracks artwork path is deferred to the next Listening UI project and is not part of v77.

## v74-v76 security foundation

The deployed security builds provide:

- safe external navigation, no-referrer/CSP protections, scoped service-worker caches and removal of the third-party Excel runtime;
- authenticated Worker validation, bounded JSON writes and private no-store responses;
- ETag-based conditional writes with one deterministic reread/merge/retry on stale data;
- preservation of stable IDs, unknown fields, user-owned fields and unrelated provider updates;
- distinct Disconnect and Erase this device controls;
- separate browser, automation and read-only credential roles with temporary legacy fallback;
- default 30-second browser and automation request timeouts without hidden generic retries;
- read-only workflow repository permissions and pinned GitHub Action SHAs.

The credential rollout is documented in `docs/SECURITY_BUILD_3_ROLLOUT.md`. Remove `API_TOKEN` only after a production automation run succeeds with `AUTOMATION_TOKEN`.

## v77 focused research workflows

The v77 branch narrows research to the information the user actually wants and separates providers by their appropriate cadence.

### Structured provider workflow

- Runs Monday, Wednesday and Friday at 01:00 UTC after release.
- Uses Ticketmaster for structured concert discovery across all bands.
- Uses Spotify for actual catalogue releases that are available to listen to.
- Retains existing MusicBrainz identity/deduplication support and existing setlist/prediction maintenance.
- Makes no Tavily or Groq calls.
- Spotify and MusicBrainz release refresh eligibility is reduced to three days.

### Focused Tavily concert workflow

- Runs on the 1st and 15th of each month after release.
- Uses Tavily plus Groq only for upcoming concert and festival dates missed by structured sources.
- Does not search for releases, hiatuses, breakups, reunions, lineup changes, interviews or general news.
- Prioritizes each newly added band’s first web concert check.
- Repeated empty results back off for 30 days, then 60 days, then recurring 90-day intervals.
- A later concert observation resets the backoff to the active 28-day supplemental cadence.
- Existing mandatory full-date, upcoming-only, tribute-act, source and duplicate protections remain.

Both workflows use the shared `live-vault-data-writes` concurrency group, existing UsageTracker caps and conditional Worker writes.

## Spotify Releases feed

The visible Releases feed accepts only actual Spotify catalogue releases with a trusted Spotify release ID and album URL. It displays available artwork, release title/type/date and an Open in Spotify action. Missing artwork falls back locally without suppressing an otherwise valid release.

The v77 production rollout includes an idempotent cleanup of `news.json` that removes legacy general articles, status news, Tavily release announcements and concert/ticket articles. Concert alerts continue to derive from `concerts.json`. The cleanup logs aggregate before/after counts only and must not be run against production until the production workflow is separately authorized.

## Data model and ownership

Bands contain stable IDs, artist identity, follow state and additive research-routing state. Concerts contain stable IDs, date/venue/source observations and additive preparation/research data. `news.json` remains the compatibility container for Spotify release items only after cleanup. User-owned fields include attendance, manual concerts, ticket price/quantity, ticket PDFs/links, playlists, checklist, ratings, notes, photos, favourites, mute state and review decisions. Provider-owned fields remain confined to their owned allowlists. Browser-local state includes settings, caches, OAuth state and imported listening history.

## Design and QA rules

The app is mobile-first. Focused changes preserve the existing blue/black/grey/white design, text-only top banner, navigation, ticket CTA hierarchy and profile structure. QA uses fictional data and the fake backend only. Automated tests must not contain the user's listening history or call live providers. Physical installation, installed-PWA cache refresh and final real-device touch/visual review remain device-specific manual checks.

## Active backlog

1. Complete v77 focused workflow implementation, synthetic QA and PR review
2. After v77 rollout, run one authorized production structured research cycle and verify `AUTOMATION_TOKEN`
3. Remove legacy `API_TOKEN` after successful automation verification
4. Listening UI project, including reliable Top Tracks artwork
5. Real ListenBrainz account connection and incremental synchronization
6. Concert Map View
7. Expanded Backup, Restore and Export
8. Native Push Notifications

## Development workflow

Approve scope, use a branch, implement and test, maintain state/decisions/build state, push and review a PR, then merge only after explicit `Merge it`. A version/cache bump is not deployment permission. Production workflows, production data writes, cleanup and provider calls require separate explicit authorization.
