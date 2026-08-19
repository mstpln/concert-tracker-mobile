# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged baseline is **v147** at merge commit `0ad014faf349dfbbc28770fc6bdeae30734f0370` (PR #156). The current branch prepares **v148** as a tightly scoped normal-day Next Concert visual polish build. It changes only the approved ticket presentation details plus focused regression coverage; it does not redesign the rest of Start, change concert-day actions, change stored data, call providers, change provider schedules/caps/pacing/matching, migrate production data, or widen credential/provider ownership boundaries.

Merged v147 owns the normal-day calendar fit and internal spacing. Its calendar surface remains at the established proportional geometry (`left: 64.0854%`, `top: 10.9071%`, `width: 28.9024%`, `height: 78.1857%`, proportional corner radius), with the primary countdown at `top: 1%`, `DAYS LEFT` at `59%`, and the detailed timer at `75%`. v148 deliberately does not alter those positions, the white date header, the large day number, the `DAYS LEFT` label, formatted date placement, or any right-stub padding/spacing.

v148 changes only four normal-day ticket details. First, the detailed `Xd HHh MMm SSs` timer uses regular font weight while keeping its existing v147 position. Second, canonical user-owned `ticketQuantity` is centered in the established left quantity lane inside a compact rounded outline pill; both the pill text and outline use the muted countdown grey (`#C9C9CE`), and the former upper/lower quantity rules are hidden. Third, the normal-day softer grey outer ticket contour keeps its existing color but uses a slightly thinner 1.1px stroke. Fourth, the visually masked right inner-frame stroke is replaced with a presentation-only overlay using the exact same x/y/width/height/radius and non-scaling 3px white SVG stroke contract as the existing left inner frame. This corrects perceived frame-weight mismatch without moving or resizing the v147 calendar surface.

The normal-day ticket otherwise keeps the approved 820x463 silhouette, tear at x=468, shallow center top/bottom notches, side-perforation count/rhythm/depth, left information layout, band/venue/address typography, calendar content and countdown behavior. `ticketQuantity` remains sourced only from canonical `concert.ticketQuantity` with the established singular/plural/missing rules.

Concert-day presentation remains the v140 contract unchanged: `Show today`, `Get directions`, and the `#5ED8FF` `Open tickets` control continue to use the established Maps and OwnedTickets behavior, including URL, single-PDF and multiple-PDF handling. No v148 normal-day pill/frame/contour/timer-weight treatment is applied to concert day.

The Start Concert Stats teaser remains the merged v147 treatment: one 1px blue outline with no extra inset shadow and regular-weight `See your full concert stats` text. v148 does not change stats values, navigation, click behavior or styling.

`APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at **v148**. `nextConcertV148.css` and `nextConcertV148.js` are part of the app shell, synthetic QA shell and deterministic build state. Focused synthetic Playwright coverage at 375px and 480px locks the merged v147 right-stub geometry and internal countdown positions while verifying the regular timer weight, grey centered ticket pill with hidden separator lines, matching 3px left/right inner-frame stroke contract, thinner 1.1px normal-day outer contour, and unchanged concert-day path. Full desktop/mobile Chromium PR QA remains the merge-readiness gate.

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

Private listening evidence remains usable by callers that already possess it through the same pure `collectListeningEvidence`/resolver path. Exact retained ListenBrainz Spotify URL relations can therefore satisfy matching links without provider work in those authorized contexts. Ordinary scheduled automation still cannot read raw private listening archives; v148 does not widen credentials or move private listening history into GitHub Actions or `apiUsage.json`.

Listening artwork does not treat a bare MusicBrainz release MBID as proof that Cover Art Archive has a front image. CAA presentation artwork suppresses Spotify fallback only when the ListenBrainz observation contains both an exact CAA release MBID and explicit CAA ID evidence. Bare or conflicting release identity remains eligible for the established Spotify album-artwork fallback. CAA fields remain provider-neutral/local and never enter Spotify-owned metadata.

Spotify diagnostics include an explicit aggregate `attempted` outcome counter in addition to lane, endpoint, successful/no-match/skipped/provider-error and circuit information. No IDs, queries, URLs, tokens or payloads are recorded.

## Safety and release boundary

Existing UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation, immutable listening source observations and credential boundaries remain authoritative. Automated browser QA uses only synthetic fixtures and the QA fake backend.

The v148 branch does not authorize or perform a production provider call, production research/data-maintenance workflow, production R2 read/write, production-data migration, Worker deployment or production smoke run. Future production/provider operations remain separately authorized.
