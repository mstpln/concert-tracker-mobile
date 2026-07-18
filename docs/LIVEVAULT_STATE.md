# LiveVault Current State

## Repository and current build

`mstpln/concert-tracker-mobile`; `main` is authoritative. Current app/cache version is v68. Production is a static GitHub Pages PWA. Browser data uses an authenticated Cloudflare Worker with private R2 JSON and ticket-PDF objects. The latest significant merged build is Ticketmaster source precedence: confident Ticketmaster data enriches a matching concert in place.

## Product purpose and navigation

LiveVault is a single-user PWA for followed bands, future and attended concerts, alerts/news, and user-owned concert details. Bottom navigation is **Concerts**, **Dates**, **Bands**, **Alerts**; corresponding headers include MYCONCERTS, CONCERTDATES, MYBANDS, and ALERTS.

## Screens and interaction model

My Concerts shows future/attended cards, stats, preparation and show-day actions. Concert Dates supports concert and venue views. My Bands lists followed artists and opens profiles. Alerts contains alerts/news. Settings contains research usage, data/identity coverage and app settings. Back returns from details to the originating screen.

Band profiles have a permanent header and **Concerts · Alerts · News · Data** tabs; Concerts is default. Alerts/News filter by stable `bandId`; Data shows provider identity state and retry timing. Tabs support ArrowLeft/ArrowRight/Home/End keyboard navigation.

## Concert preparation and data ownership

Upcoming attending concerts support readiness checklist, manual/generated playlists, weather, predicted setlists, owned tickets and directions. Past concerts can contain actual setlists, Spotify links and live-performance insights. Tickets can be one link/PDF or multiple PDFs; PDF bytes remain private. User-owned fields include attendance, tickets, playlists, checklist, notes, ratings, photos and manual links. Provider/research enrichments are additive and must preserve unknown future fields.

## Identity and research

MusicBrainz MBID underpins artist identity; Ticketmaster attraction and Spotify artist IDs are nested provider identities. Confirmed/manual-confirmed identities are reused; unresolved states retain candidates/retry metadata and Settings reports coverage/duplicates without raw editing. Research uses Ticketmaster, supplemental Tavily/Groq, MusicBrainz, Spotify and setlist.fm through usage caps/pacing, with coordinated production writes.

Ticketmaster may enrich a Tavily/Groq concert only in place, using its provider allowlist. Exact event matching requires same event ID, band ID and date. Fallback requires same band/date/city, compatible country and sufficiently similar venue. Different dates/bands/event IDs and ambiguous records remain separate; cancellation/reschedule handling is excluded.

## Data-safety and design invariants

Stable IDs never change. Latest records are reread before coordinated writes. User-owned and unknown fields survive. Ticket PDFs are private. QA uses synthetic data only and never calls providers or production workflows. Focused UI work preserves unrelated design, keeps mobile-first conventions and existing renderers/navigation.

## Completed features

Readiness checklist; playlist builder; weather; predicted setlists; live-performance rarity insights; owned tickets; provider identity backbone; identity-aware research; band-profile tabs; contextual links; Ticketmaster precedence; bottom-navigation update.

## Active backlog

1. Concert Map View — visual map of concert locations.
2. Expanded Backup, Restore and Export — user-controlled portable data tools.
3. Structured Album-Release Tracking — deeper release monitoring.
4. Native Push Notifications — device notification delivery.

## Excluded directions

Cancellation/reschedule monitoring, recurring freshness verification, cancellation/freshness badges, broad source-conflict UI, standalone disagreement queue, and social/multi-user features are excluded until explicitly reconsidered.

## Development and QA

Approve scope, branch, test, update state/build state, create PR and inspect synthetic QA preview/artifacts. Only explicit `merge it` authorizes merge. QA has unit/static checks, desktop/mobile Chromium, full PWA workflow, synthetic preview and sanitized read-only production smoke. Physical install, picker/PDF behaviour, permissions, phone Chrome and Worker deployment still require device/manual confirmation.
