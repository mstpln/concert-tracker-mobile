# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The prior merged baseline is **v144** at merge commit `66acf00f9e1617921cbb3f4fb3ae6f07ba71ff98` (PR #153). The current branch prepares **v145** as a focused Settings data-correctness and automation-reporting build. It does not redesign Settings, change provider schedules/caps/pacing/matching, migrate production data, widen private-listening access, or change provider ownership boundaries.

v145 makes the existing Settings → Data → Album artwork coverage read artwork from the durable Spotify listening metadata authority when a source listening event has a trusted Spotify track ID, while still accepting valid provider-neutral presentation artwork already present on the event. Album grouping remains one stable BANDMARKR band plus normalized release title, so repeated listens and multiple tracks from the same album do not inflate coverage and identical release titles owned by different bands remain separate. The calculation is read-only, does not call providers, does not rewrite immutable listening source observations, and refreshes after Spotify metadata restoration so canonical/history hydration order does not collapse the count.

v145 also standardizes Update activity reporting. Structured research persists additive per-flow reports for Concerts, Artist artwork and Setlists; the focused Tavily concert workflow reports Web concert search; the provider-identity workflow reports Artist information; and browser-owned ListenBrainz synchronization retains only the latest aggregate processed/added/skipped counts in the existing private local connection record. The shared automation report carries lane status/timestamps, truthful work and result counters, and an optional bounded safe failure code/reason. Existing `apiUsage.json` top-level fields, provider quota state, unknown future automation reports and legacy last-run fields remain preserved and readable.

The six Update activity result lines now use one information principle without adding a new UI component: artists checked/concerts added, listens processed/listens added, artists checked/artists updated, artists checked/images added, and shows checked/setlists updated. Legitimate zeroes are shown as zero; absent legacy metrics remain "No recent result reported" rather than becoming false zeroes. Artist artwork uses the existing Monday/Wednesday/Friday structured-research schedule for its next check and is no longer hardcoded as "Not reported" when a real lane report exists.

Setlist provider failures remain retryable and do not become false no-match outcomes or advance `setlistCheckedAt`. The Setlists row consumes the lane-specific safe failure report when available. A parent structured run can therefore remain healthy while Setlists or Artist artwork independently reports a failure/attention state. Safe Settings reasons are category-level summaries such as provider unavailability, rate limiting, invalid response, timeout, network failure or unsafe identity match; raw provider bodies, stack traces, authorization data, URLs, tokens and arbitrary logs are not exposed through Settings.

`APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at **v145**. `settingsAutomationReportingV145.js` and `listenbrainzReportingV145.js` are part of the app shell, and the deterministic build-state generator tracks them. Synthetic browser QA exercises the existing Settings layout in desktop/mobile Chromium and light/dark appearance with separate synthetic artwork metadata and automation-run fixtures.

The merged v144 behavior remains intact: selected-year Listening by Genre drill-down uses stored BANDMARKR band genre attribution; My Bands restores its viewport when returning from Band Detail; and favorite/muted status indicators remain status-only before the existing chevron. The v143 UI-alignment, v142 Ticketmaster venue-quality protection, v135-v137 provider/release cleanup, and existing listening identity/artwork ownership rules remain authoritative.

## Backlog hygiene

The historical GitHub backlog has been reconciled against merged `main` so completed/superseded work is not mistaken for current product debt.

- Issue #70 is completed by merged GAU5 / PR #123, which made listening preparation chunked, persisted and resumable across interruption/reload while keeping activation separate.
- Issue #71 is completed across the merged Listening Build 3.3 work: identity coverage, Toplist, Stats Top Bands/Top Tracks presentation, trusted Spotify links/artwork and selected-year genre detail are present on `main`.
- Issue #72 is completed across GAU1-GAU5 and later follow-up fixes. The general Settings, concert-relative listening windows, manual enrichment, venue recovery and resumable preparation work are implemented; no separate Start-page rename is required by the current product state.
- PR #132 is superseded by merged PR #133, which shipped the NB1 concert-card countdown/image-border scope.
- PR #89 is superseded by the later v105/v106 MusicBrainz pacing/defer corrections, including merged PRs #90 and #91.
- PR #92 is superseded by the subsequently merged listening-maintenance contracts/foundation and the later Data Automation stack.
- PR #41 is an obsolete pre-current-architecture review-only bulk artist-enrichment proposal and is superseded by the later identity/enrichment/maintenance flows.
- PR #134 remains intentionally open as production-inert NB2 band-profile backfill tooling. It is not treated as merged/current application behavior and should be refreshed against current `main` before any future use.
- Cloudflare Worker CORS-origin hardening remains deferred backlog work. Bearer/role authentication remains the security boundary; any future CORS tightening must preserve authorized no-Origin/server tooling and treat Worker deployment as a separate production action.
- Versioned CSS/JS patch-layer consolidation remains deferred maintenance debt. It should be behavior-preserving, isolated from feature work, and piloted on a small visual area rather than Listening/Stats.

## Provider and release cleanup finalization

v135-v137 retired the active Releases product path while preserving stored historical/provider state. Alerts is concert-only, Band Detail has no Releases tab, scheduled structured release catalogue polling is disabled, and lifecycle release-alert planning is inert.

v137 uses one fail-closed provider-neutral resolver for non-playlist track links. Scheduled research seeds it only from ordinary `bands.json`/`concerts.json` state already authorized for automation, allowing exact existing setlist and predicted-setlist Spotify links and recording identity to satisfy later historical display-link work before another Spotify search. A unique trusted MusicBrainz recording MBID is used directly for URL-relation lookup before the broader artist-MBID plus exact-title catalogue route. Ambiguous/no-match evidence falls through; transient MusicBrainz errors stop that item safely rather than becoming a Spotify guess. MusicBrainz calls remain behind UsageTracker courtesy caps/pacing.

Private listening evidence remains usable by callers that already possess it through the same pure `collectListeningEvidence`/resolver path. Exact retained ListenBrainz Spotify URL relations can therefore satisfy matching links without provider work in those authorized contexts. Ordinary scheduled automation still cannot read raw private listening archives; v145 does not widen credentials or move private listening history into GitHub Actions or `apiUsage.json`.

Listening artwork does not treat a bare MusicBrainz release MBID as proof that Cover Art Archive has a front image. CAA presentation artwork suppresses Spotify fallback only when the ListenBrainz observation contains both an exact CAA release MBID and explicit CAA ID evidence. Bare or conflicting release identity remains eligible for the established Spotify album-artwork fallback. CAA fields remain provider-neutral/local and never enter Spotify-owned metadata.

Spotify diagnostics include an explicit aggregate `attempted` outcome counter in addition to lane, endpoint, successful/no-match/skipped/provider-error and circuit information. No IDs, queries, URLs, tokens or payloads are recorded.

## Safety and release boundary

Existing UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation, immutable listening source observations and credential boundaries remain authoritative. Automated browser QA uses only synthetic fixtures and the QA fake backend.

The v145 branch does not authorize or perform a production provider call, production research/data-maintenance workflow, production R2 read/write, production-data migration, Worker deployment or production smoke run. Future production/provider operations remain separately authorized.