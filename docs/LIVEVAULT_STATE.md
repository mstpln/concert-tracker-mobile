# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The merged baseline is v141 at merge commit `b775131547068486e901550dea4c2a0b58ac7cd1`. PR #149 is merged and contains the approved v141 Next Concert mobile spacing refinement: normal-day left typography is compacted, the ticket-quantity row is aligned exactly with the concert date, full location text stays clear of the quantity separators, and the v140 countdown/concert-day layout is preserved.

An unreleased v142 provider-safety correction is active on `fix/ticketmaster-venue-downgrade-v142`. Ticketmaster exact-event refreshes may still improve an unknown venue or replace one genuine venue with another genuine venue, but placeholder values such as `Unknown venue`, `TBA`, `TBD`, `Venue TBA`, `Venue TBD`, `To be announced`, and `To be determined` may not overwrite a real venue already stored on the canonical concert. The protection is applied again against the latest reread concert before persistence, while other valid Ticketmaster-owned refresh fields continue to update normally. Existing GAU4 trusted unknown-to-known venue recovery remains unchanged.

## Provider and release cleanup finalization

v135-v137 retired the active Releases product path while preserving stored historical/provider state. Alerts is concert-only, Band Detail has no Releases tab, scheduled structured release catalogue polling is disabled, and lifecycle release-alert planning is inert.

v137 uses one fail-closed provider-neutral resolver for non-playlist track links. Scheduled research seeds it only from ordinary `bands.json`/`concerts.json` state already authorized for automation, allowing exact existing setlist and predicted-setlist Spotify links and recording identity to satisfy later historical display-link work before another Spotify search. A unique trusted MusicBrainz recording MBID is used directly for URL-relation lookup before the broader artist-MBID plus exact-title catalogue route. Ambiguous/no-match evidence falls through; transient MusicBrainz errors stop that item safely rather than becoming a Spotify guess. MusicBrainz calls remain behind UsageTracker courtesy caps/pacing.

Private listening evidence remains usable by callers that already possess it through the same pure `collectListeningEvidence`/resolver path. Exact retained ListenBrainz Spotify URL relations can therefore satisfy matching links without provider work in those authorized contexts. Ordinary scheduled automation still cannot read raw private listening archives; this completion does not widen credentials or move private listening history into GitHub Actions.

Listening artwork does not treat a bare MusicBrainz release MBID as proof that Cover Art Archive has a front image. CAA presentation artwork suppresses Spotify fallback only when the ListenBrainz observation contains both an exact CAA release MBID and explicit CAA ID evidence. Bare or conflicting release identity remains eligible for the established Spotify album-artwork fallback. CAA fields remain provider-neutral/local and never enter Spotify-owned metadata.

Spotify diagnostics include an explicit aggregate `attempted` outcome counter in addition to lane, endpoint, successful/no-match/skipped/provider-error and circuit information. No IDs, queries, URLs, tokens or payloads are recorded.

For the active v142 branch, `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v142. No new runtime shell asset, production data file, secret, provider capability or stored-data schema is introduced.

## Safety and release boundary

Existing UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation, immutable listening source observations and credential boundaries remain authoritative. Automated browser QA uses only synthetic fixtures and the QA fake backend.

No production provider call, production workflow, production R2 read/write or deployment has been performed for v142. The LE SSERAFIM production record has not been modified by this build; correcting that record remains a separately authorized production-data action after the prevention fix is merged. Merge still requires explicit user authorization.
