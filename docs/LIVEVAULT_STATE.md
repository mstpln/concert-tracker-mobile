# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by an authenticated Cloudflare Worker and private R2. The current production data files are `bands.json`, `concerts.json`, `news.json`, and `apiUsage.json`; ticket PDF bytes are separate authenticated R2 objects. `APP_VERSION` and the service-worker cache literal are both v68 on `main`. The v68 production app is live, the updated Worker is deployed, and the read-only production smoke check is configured.

## Product purpose and navigation

This is a single-user concert tracker for followed bands, upcoming shows, attended-history, alerts/news, releases, venues, statistics and user-owned concert preparation. Bottom navigation is **Concerts**, **Dates**, **Bands**, and **Alerts**, with MYCONCERTS, CONCERTDATES, MYBANDS and ALERTS headers. Settings, Statistics, band profiles and venue details are secondary screens; back returns to the originating screen.

## Major screens

My Concerts shows summary cards, upcoming/attended shows and preparation. Concert Dates provides concert and venue browsing. My Bands lists followed artists. Alerts has alerts/news subtabs. Settings contains usage, identity coverage and app options. Statistics summarises concert history. Band profiles retain a permanent header and use Concerts, Alerts, News and Data tabs; Concerts is default. Tabs filter by stable `bandId`, support ArrowLeft/ArrowRight/Home/End, and restore focus after rerender.

## Concert preparation and show day

Upcoming attending concerts support a readiness checklist, manual or generated playlist state, weather, predicted setlist, owned tickets and directions. Past cards can show actual setlists, Spotify song links, ratings, notes, photos and live-performance insights. One saved ticket uses the established yellow ticket CTA with an outlined directions CTA beside it; two PDFs use equal Ticket 1/Ticket 2 controls and full-width outlined directions beneath. Show-day behaviour remains limited to implemented countdown/ticket actions.

## Data model and ownership

Bands contain stable IDs, artist identity and follow state. Concerts contain stable IDs, date/venue/source observations and additive preparation/research data. Alerts/news use stable band IDs. User-owned fields include attendance, manual concerts, ticket price/quantity, ticket PDFs/links, playlists, checklist, ratings, notes, photos, favourites, mute state and review decisions. Provider-owned fields are confined to their owned allowlists. Research-owned fields include predictions, observations and insights. Browser-local state includes settings, caches and OAuth state. R2 stores JSON and private ticket bytes; PDF metadata lives with the concert record.

## Identity and research

MusicBrainz MBID is the artist backbone. Ticketmaster attraction and Spotify artist identifiers are nested under the MusicBrainz identity. `confirmed`, `manual_confirmed` and `auto_confirmed` are trusted; `needs_review`, `no_match`, `error` and manual rejection retain retry/candidate metadata. Settings reports coverage, duplicates and review candidates without raw identity editing.

Research uses Ticketmaster, Tavily, Groq, MusicBrainz, Spotify, setlist.fm and geocoding through UsageTracker pacing/caps. Structured release monitoring, predicted setlists and performance insights reuse trusted identity where applicable. Coordinated writes reread latest records. Manual workflows are narrowly scoped and share data-write concurrency.

## Ticketmaster precedence and data safety

Ticketmaster can enrich an existing Tavily/Groq concert in place only for confident matches. Exact event-ID matches also require the same band and date. Fallback matching requires compatible band/date/city/country and venue evidence. Different dates, IDs or ambiguous records remain separate; the app does not interpret cancellation or rescheduling. Stable IDs are never recreated, user fields and unknown future fields survive, and latest remote records are reread before merging.

## Design rules

The app is mobile-first. Focused changes preserve unrelated blue/black/grey/white design, text-only top banner, current headers, bottom navigation, ticket CTA hierarchy and profile tabs. Reuse existing renderers/icons; maintain accessible controls, narrow-width readability and no horizontal overflow. Number visual concepts clearly.

## Completed features

Readiness checklist; playlist builder; concert weather; predicted and actual setlist support; live-performance insights; owned tickets; MusicBrainz/provider identity backbone and backfill; identity-aware research; band-profile tabs; contextual links; Ticketmaster source precedence; updated bottom navigation.

## Active backlog

1. Concert Map View
2. Expanded Backup, Restore and Export
3. Structured Album-Release Tracking
4. Native Push Notifications

## Intentionally excluded

Cancellation/reschedule monitoring, repeated concert freshness verification, freshness/cancellation badges, broad source-conflict UI, a conflict-review queue, social features and multi-user features are excluded until explicitly reconsidered.

## Development workflow and QA

Approve scope, use a branch, implement and test, maintain state/build state, push and review a PR, then merge only after explicit `Merge it`. Pull GitHub Desktop only before later local Codex work. The webview-first foundation is merged and active: deterministic synthetic fixtures, a local fake Worker/storage layer, QA-only build output, desktop/mobile Playwright coverage, a separate manual PWA workflow, isolated offline service-worker validation, PR safety checks, sanitized production-smoke support and continuity documentation are all in place. Cloudflare Pages serves the public synthetic QA preview, the production Worker includes the read-only smoke endpoint, the required secrets are configured, the production smoke workflow passes, and the Full PWA QA workflow passes. Physical installation, file pickers, PDF opening, phone storage/permissions and real-device mobile Chrome behaviour still require device-specific manual verification when those areas change.
