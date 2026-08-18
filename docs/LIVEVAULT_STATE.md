# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The merged baseline is **v143** at merge commit `a94005016751f2d35796792488012180d4002f1f`. PR #151 is merged. The v143 UI-alignment scope is now part of `main`: My Concerts `UPCOMING CONCERTS` uses the same centered two-line separator treatment as `PAST CONCERTS`; the Alerts root header is `CONCERTALERTS` with `CONCERT` in the established blue brand treatment; the Stats Listening/Concerts segmented control uses the current ConcertDates segmented-control height; and an `SE` Sweden-only geographic filter sits between Nearby and EU on ConcertDates and Band Detail → Concerts.

Nearby, SE and EU are mutually exclusive. The root ConcertDates SE choice persists with the existing root geographic settings, while the Band Detail SE choice is transient and resets when a band page is opened. The Sweden filter is view-only and matches canonical `country` exactly and case-insensitively to `Sweden`; it does not infer Sweden from city, venue, distance or address and never writes `concerts.json` or other stored concert fields. Existing ConcertDates representative-show semantics remain authoritative.

The v142 Ticketmaster venue-quality protection remains in force under v143: exact-event refreshes may improve an unknown venue or replace one genuine venue with another genuine venue, but placeholder, blank or malformed provider venue names cannot downgrade a real canonical venue. The existing GAU4 trusted unknown-to-known recovery remains intact.

`APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v143. `alignedUiV143.css`, `alignedUiV143.js` and `geoFilterPreloadV143.js` are part of the app shell and deterministic build state. No new runtime dependency, production data file, secret, provider capability, workflow schedule or stored-data schema was introduced by v143.

## Backlog hygiene after v143

The historical GitHub backlog has been reconciled against merged `main` so completed/superseded work is not mistaken for current product debt.

- Issue #70 is completed by merged GAU5 / PR #123, which made listening preparation chunked, persisted and resumable across interruption/reload while keeping activation separate.
- Issue #71 is completed across the merged Listening Build 3.3 work: identity coverage, Toplist, Stats Top Bands/Top Tracks presentation, trusted Spotify links/artwork and selected-year genre detail are present on `main`.
- Issue #72 is completed across GAU1-GAU5 and later follow-up fixes. The general Settings, concert-relative listening windows, manual enrichment, venue recovery and resumable preparation work are implemented; no separate Start-page rename is required by the current product state.
- PR #132 is superseded by merged PR #133, which shipped the NB1 concert-card countdown/image-border scope.
- PR #89 is superseded by the later v105/v106 MusicBrainz pacing/defer corrections, including merged PRs #90 and #91.
- PR #92 is superseded by the subsequently merged listening-maintenance contracts/foundation and the later Data Automation stack.
- PR #41 is an obsolete pre-current-architecture review-only bulk artist-enrichment proposal and is superseded by the later identity/enrichment/maintenance flows.
- PR #134 remains intentionally open as production-inert NB2 band-profile backfill tooling. It is not treated as merged/current application behavior and should be refreshed against current `main` before any future use.

## Provider and release cleanup finalization

v135-v137 retired the active Releases product path while preserving stored historical/provider state. Alerts is concert-only, Band Detail has no Releases tab, scheduled structured release catalogue polling is disabled, and lifecycle release-alert planning is inert.

v137 uses one fail-closed provider-neutral resolver for non-playlist track links. Scheduled research seeds it only from ordinary `bands.json`/`concerts.json` state already authorized for automation, allowing exact existing setlist and predicted-setlist Spotify links and recording identity to satisfy later historical display-link work before another Spotify search. A unique trusted MusicBrainz recording MBID is used directly for URL-relation lookup before the broader artist-MBID plus exact-title catalogue route. Ambiguous/no-match evidence falls through; transient MusicBrainz errors stop that item safely rather than becoming a Spotify guess. MusicBrainz calls remain behind UsageTracker courtesy caps/pacing.

Private listening evidence remains usable by callers that already possess it through the same pure `collectListeningEvidence`/resolver path. Exact retained ListenBrainz Spotify URL relations can therefore satisfy matching links without provider work in those authorized contexts. Ordinary scheduled automation still cannot read raw private listening archives; this completion does not widen credentials or move private listening history into GitHub Actions.

Listening artwork does not treat a bare MusicBrainz release MBID as proof that Cover Art Archive has a front image. CAA presentation artwork suppresses Spotify fallback only when the ListenBrainz observation contains both an exact CAA release MBID and explicit CAA ID evidence. Bare or conflicting release identity remains eligible for the established Spotify album-artwork fallback. CAA fields remain provider-neutral/local and never enter Spotify-owned metadata.

Spotify diagnostics include an explicit aggregate `attempted` outcome counter in addition to lane, endpoint, successful/no-match/skipped/provider-error and circuit information. No IDs, queries, URLs, tokens or payloads are recorded.

## Safety and release boundary

Existing UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation, immutable listening source observations and credential boundaries remain authoritative. Automated browser QA uses only synthetic fixtures and the QA fake backend.

The v143 merge did not authorize or perform a production provider call, production research/data-maintenance workflow, production R2 write, production-data migration or production smoke run. Future production/provider operations remain separately authorized.
