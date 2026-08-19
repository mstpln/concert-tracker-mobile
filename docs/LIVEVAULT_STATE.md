# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged baseline is **v145** at merge commit `287dd671d09f4872a3a602754b49a969ef8dced7` (PR #154). The current branch prepares **v146** as a focused Start-screen Next Concert visual refinement. It changes only the normal-day ticket presentation and its focused regression coverage; it does not redesign the rest of Start, change concert-day actions, change stored data, call providers, change provider schedules/caps/pacing/matching, migrate production data, or widen credential/provider ownership boundaries.

v146 replaces the normal-day right-stub circular countdown presentation with the approved full-frame calendar treatment while preserving the established countdown behavior and IDs. The existing right inner frame remains at the v140 geometry (`x=525`, `y=50`, `width=238`, `height=363`, `rx=17`) and is filled edge-to-edge by a white `DATE` header with the formatted concert date plus a black body with the larger dynamic days-left value, `DAYS LEFT`, and the existing detailed live `Xd HHh MMm SSs` countdown. The calendar inherits the existing app font family. The old countdown-ring DOM remains present so the existing one-second ticker in `app.js` remains authoritative rather than being forked.

The normal-day ticket keeps the approved 820x463 silhouette, tear at x=468, inner frames and shallow center top/bottom notches. Its outer contour becomes the approved softer light grey (`#B5B7BC`), while the inner frames and dashed tear remain white. Only the transitions into and out of the repeated side perforations are subtly rounded; their count, rhythm and overall ticket proportions remain unchanged. The two grey rules around the canonical user-owned `ticketQuantity` label use the approved optical spacing adjustment without changing ticket-quantity ownership or singular/plural/missing behavior.

Concert-day presentation remains the v140 contract unchanged: `Show today`, `Get directions`, and the `#5ED8FF` `Open tickets` control continue to use the established Maps and OwnedTickets behavior, including URL, single-PDF and multiple-PDF handling. No v146 calendar/grey-contour treatment is applied to concert day.

`APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at **v146**. `nextConcertV146.css` and `nextConcertV146.js` are part of the app shell and deterministic build state. Focused synthetic Playwright coverage verifies the 375px calendar treatment and screenshot, the soft-grey/rounded normal contour, flush calendar-header fit, app-font inheritance, optical quantity-rule treatment, live countdown-ID compatibility, 375/480 containment, and unchanged concert-day behavior. Full desktop/mobile Chromium PR QA remains the merge-readiness gate.

The merged v145 Settings data-correctness and automation-reporting behavior remains intact. Album artwork coverage reads the durable Spotify listening metadata authority where applicable while preserving provider-neutral presentation artwork, and Update activity uses the additive safe per-flow reporting contract across Concerts, Web concert search, Artist information, Artist artwork, Setlists and browser-local ListenBrainz aggregate reporting. The merged v144 genre/My Bands behavior, v143 UI alignment and Sweden filters, v142 Ticketmaster venue-quality protection, v135-v137 provider/release cleanup, and existing listening identity/artwork ownership rules remain authoritative.

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

Private listening evidence remains usable by callers that already possess it through the same pure `collectListeningEvidence`/resolver path. Exact retained ListenBrainz Spotify URL relations can therefore satisfy matching links without provider work in those authorized contexts. Ordinary scheduled automation still cannot read raw private listening archives; v146 does not widen credentials or move private listening history into GitHub Actions or `apiUsage.json`.

Listening artwork does not treat a bare MusicBrainz release MBID as proof that Cover Art Archive has a front image. CAA presentation artwork suppresses Spotify fallback only when the ListenBrainz observation contains both an exact CAA release MBID and explicit CAA ID evidence. Bare or conflicting release identity remains eligible for the established Spotify album-artwork fallback. CAA fields remain provider-neutral/local and never enter Spotify-owned metadata.

Spotify diagnostics include an explicit aggregate `attempted` outcome counter in addition to lane, endpoint, successful/no-match/skipped/provider-error and circuit information. No IDs, queries, URLs, tokens or payloads are recorded.

## Safety and release boundary

Existing UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation, immutable listening source observations and credential boundaries remain authoritative. Automated browser QA uses only synthetic fixtures and the QA fake backend.

The v146 branch does not authorize or perform a production provider call, production research/data-maintenance workflow, production R2 read/write, production-data migration, Worker deployment or production smoke run. Future production/provider operations remain separately authorized.
