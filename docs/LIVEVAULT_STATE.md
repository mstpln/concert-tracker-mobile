# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The merged baseline is v137 at merge commit `9a6dc20dbee50934f952e935715beae58d43e75d`. PR #144 is merged and completes the Provider & Release Cleanup implementation/audit scope.

An unreleased v138 build is active on `feature/next-concert-ticket-v138`. It changes only the Start-screen Next Concert presentation: the normal state uses the approved perforated ticket silhouette with graphite outline/dashed tear line and the existing live countdown data; the concert-day state keeps the same ticket silhouette but replaces the countdown stub with the approved circular `Open tickets` control while `Get directions` remains on the left. Existing Maps URL construction and OwnedTickets PDF opening remain authoritative behavior paths.

## Provider and release cleanup finalization

v135-v137 retired the active Releases product path while preserving stored historical/provider state. Alerts is concert-only, Band Detail has no Releases tab, scheduled structured release catalogue polling is disabled, and lifecycle release-alert planning is inert.

v137 uses one fail-closed provider-neutral resolver for non-playlist track links. Scheduled research seeds it only from ordinary `bands.json`/`concerts.json` state already authorized for automation, allowing exact existing setlist and predicted-setlist Spotify links and recording identity to satisfy later historical display-link work before another Spotify search. A unique trusted MusicBrainz recording MBID is used directly for URL-relation lookup before the broader artist-MBID plus exact-title catalogue route. Ambiguous/no-match evidence falls through; transient MusicBrainz errors stop that item safely rather than becoming a Spotify guess. MusicBrainz calls remain behind UsageTracker courtesy caps/pacing.

Private listening evidence remains usable by callers that already possess it through the same pure `collectListeningEvidence`/resolver path. Exact retained ListenBrainz Spotify URL relations can therefore satisfy matching links without provider work in those authorized contexts. Ordinary scheduled automation still cannot read raw private listening archives; this completion does not widen credentials or move private listening history into GitHub Actions.

Listening artwork does not treat a bare MusicBrainz release MBID as proof that Cover Art Archive has a front image. CAA presentation artwork suppresses Spotify fallback only when the ListenBrainz observation contains both an exact CAA release MBID and explicit CAA ID evidence. Bare or conflicting release identity remains eligible for the established Spotify album-artwork fallback. CAA fields remain provider-neutral/local and never enter Spotify-owned metadata.

Spotify diagnostics include an explicit aggregate `attempted` outcome counter in addition to lane, endpoint, successful/no-match/skipped/provider-error and circuit information. No IDs, queries, URLs, tokens or payloads are recorded.

For the active v138 branch, `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v138 and the deterministic build state includes the new Next Concert JS/CSS shell files.

## Safety and release boundary

Existing UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation, immutable listening source observations and credential boundaries remain authoritative. Automated browser QA uses only synthetic fixtures and the QA fake backend.

No production provider call, production workflow, production R2 read/write or deployment has been performed for v138. The branch is unreleased and must complete unit/safety plus desktop/mobile synthetic browser validation and review before it can be considered merge-ready. Merge still requires explicit user authorization.
