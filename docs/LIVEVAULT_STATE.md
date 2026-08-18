# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The merged baseline is v140 at merge commit `88a0bb96c6e7717b295fe7d2b925d4251b8f05b6`. PR #148 is merged and contains the approved taller black/white Next Concert ticket with the silver normal-day countdown and neon show-day ticket action.

An unreleased v141 visual refinement build is active on `fix/next-concert-mobile-spacing-v141`. It changes only the Start-screen Next Concert normal-day typography and spacing. The 820x463 ticket geometry, black/white contour treatment, countdown behavior, Maps URL construction and OwnedTickets behavior remain unchanged. The normal-day left inner panel uses smaller fixed mobile-first typography and tighter padding so artist, venue and address text fit cleanly. The ticket-quantity text and concert-date text share the exact same vertical coordinate and line-height; the two grey quantity separators remain identical 1px strokes with equal compact spacing around the quantity label. The visible date is independently positioned while a hidden layout spacer preserves the original v140 countdown ring/time footprint in the right stub. At <=390px the normal-day left typography steps down again to preserve fit. Concert-day typography, spacing, directions and ticket-action layout remain the approved v140 presentation.

## Provider and release cleanup finalization

v135-v137 retired the active Releases product path while preserving stored historical/provider state. Alerts is concert-only, Band Detail has no Releases tab, scheduled structured release catalogue polling is disabled, and lifecycle release-alert planning is inert.

v137 uses one fail-closed provider-neutral resolver for non-playlist track links. Scheduled research seeds it only from ordinary `bands.json`/`concerts.json` state already authorized for automation, allowing exact existing setlist and predicted-setlist Spotify links and recording identity to satisfy later historical display-link work before another Spotify search. A unique trusted MusicBrainz recording MBID is used directly for URL-relation lookup before the broader artist-MBID plus exact-title catalogue route. Ambiguous/no-match evidence falls through; transient MusicBrainz errors stop that item safely rather than becoming a Spotify guess. MusicBrainz calls remain behind UsageTracker courtesy caps/pacing.

Private listening evidence remains usable by callers that already possess it through the same pure `collectListeningEvidence`/resolver path. Exact retained ListenBrainz Spotify URL relations can therefore satisfy matching links without provider work in those authorized contexts. Ordinary scheduled automation still cannot read raw private listening archives; this completion does not widen credentials or move private listening history into GitHub Actions.

Listening artwork does not treat a bare MusicBrainz release MBID as proof that Cover Art Archive has a front image. CAA presentation artwork suppresses Spotify fallback only when the ListenBrainz observation contains both an exact CAA release MBID and explicit CAA ID evidence. Bare or conflicting release identity remains eligible for the established Spotify album-artwork fallback. CAA fields remain provider-neutral/local and never enter Spotify-owned metadata.

Spotify diagnostics include an explicit aggregate `attempted` outcome counter in addition to lane, endpoint, successful/no-match/skipped/provider-error and circuit information. No IDs, queries, URLs, tokens or payloads are recorded.

For the active v141 branch, `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v141. The deterministic build state and synthetic QA packaging continue to use the existing v140 Next Concert JS/CSS shell assets; no new runtime asset or data shape is introduced.

## Safety and release boundary

Existing UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation, immutable listening source observations and credential boundaries remain authoritative. Automated browser QA uses only synthetic fixtures and the QA fake backend.

No production provider call, production workflow, production R2 read/write or deployment has been performed for v141. The build remains unreleased until the exact PR head is green for unit/safety plus desktop/mobile synthetic Chromium QA and receives final review. Merge still requires explicit user authorization.
