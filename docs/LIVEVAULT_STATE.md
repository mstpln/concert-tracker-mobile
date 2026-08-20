# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged baseline is **v148** at merge commit `6867d3e913039a0616dac0d4b34c11398b1e520b` (PR #157). The current branch prepares **v149** as a tightly scoped presentation build for the two Start stats cards, shared Top Bands/Top Tracks movement arrows, and the contextual Stats-tab header. No unrelated Start content, Next Concert presentation, bottom navigation, data calculations, stored fields, provider behavior, backend/Worker behavior, production workflow, or production data is changed.

### v149 Start stats cards

The Start Listening and Concert stats cards now use one shared visual structure. Each card keeps the existing 1px blue outline and app surface, gains a simple title-case blue header row (`Listening stats` / `Concert stats`) separated by the normal subtle divider, and uses the same compact bottom CTA strip height. The existing CTA destinations and wording remain `See your listening stats` and `See your full concert stats`.

Inside the Listening stats card, the three-band preview remains the existing two-week ranking. Its section row reads `YOUR TOP BANDS · 2 WEEKS` at left and `TOPLIST` at right; both are grey and uppercase. `TOPLIST` replaces the old `View all` wording but preserves the existing Toplist navigation target. Artist photos, ranks, listening duration/count values, row navigation and ranking calculations are unchanged. The Concert stats card keeps the existing four values and units and the existing full-concert-stats navigation target.

### v149 ranking movement arrows

The shared ranking movement renderer used by Top Bands and Top Tracks replaces the thin text arrow glyphs with the approved compact SVG arrow. The shape is short and thick, has gently rounded arrowhead edges, a comparatively square tail, and the final 10%-wider rectangular shaft. Up movement remains blue and down movement remains grey; `New` ranking text and all ranking calculations remain unchanged. Chevrons, Back controls, navigation arrows and unrelated icons are not affected.

### v149 Stats header

The Stats screen uses the existing compound-header typography and two-tone treatment dynamically. The Listening sub-tab shows `LISTENINGSTATS` with `LISTENING` blue and `STATS` grey; the Concerts sub-tab shows `CONCERTSTATS` with `CONCERT` blue and `STATS` grey. The existing Listening/Concerts segmented control and its behavior remain unchanged.

### Preserved v148 Next Concert behavior

Merged v148 remains authoritative for the normal-day Next Concert ticket: v147 calendar geometry/internal spacing stays fixed; the detailed timer is regular weight; canonical `ticketQuantity` is centered in the muted-grey outline pill; the outer normal-day contour is the thinner 1.1px grey stroke; and the right inner frame uses the matched non-scaling 3px white SVG stroke treatment. Concert day remains the v140 `Show today` / `Get directions` / `Open tickets` contract. v149 does not alter any of this.

`APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at **v149**. `startStatsV149.css` and `startStatsV149.js` are included in the app shell, service-worker cache, synthetic QA build and deterministic build state. Focused Playwright coverage checks the Start card structure at 375px and 480px, equal compact footer heights, approved movement-arrow SVG, Top Bands/Top Tracks shared movement rendering, and dynamic `LISTENINGSTATS` / `CONCERTSTATS` header switching. Full desktop/mobile Chromium PR QA remains the merge-readiness gate.

The merged v145 Settings data-correctness and automation-reporting behavior remains intact. The merged v144 genre/My Bands behavior, v143 UI alignment and Sweden filters, v142 Ticketmaster venue-quality protection, v135-v137 provider/release cleanup, and existing listening identity/artwork ownership rules remain authoritative.

## Backlog hygiene

The historical GitHub backlog has been reconciled against merged `main` so completed/superseded work is not mistaken for current product debt.

- Issue #70 is completed by merged GAU5 / PR #123, which made listening preparation chunked, persisted and resumable across interruption/reload while keeping activation separate.
- Issue #71 is completed across the merged Listening Build 3.3 work: identity coverage, Toplist, Stats Top Bands/Top Tracks presentation, trusted Spotify links/artwork and selected-year genre detail are present on `main`.
- Issue #72 is completed across GAU1-GAU5 and later follow-up fixes.
- PR #132 is superseded by merged PR #133.
- PR #89 is superseded by the later v105/v106 MusicBrainz pacing/defer corrections.
- PR #92 is superseded by the later listening-maintenance contracts/foundation and Data Automation stack.
- PR #41 is obsolete and superseded by later identity/enrichment/maintenance flows.
- PR #134 remains intentionally open as production-inert NB2 band-profile backfill tooling and is not current application behavior.
- Cloudflare Worker CORS-origin hardening remains deferred backlog work.
- Versioned CSS/JS patch-layer consolidation remains deferred maintenance debt and must remain isolated from feature work.

## Provider and data boundaries

v135-v137 retired active Releases while preserving stored historical/provider state. Existing provider-neutral link resolution, listening artwork ownership, MusicBrainz/Spotify safety, private-listening boundaries, UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation and immutable source observations remain authoritative.

v149 is presentation-only. It does not add provider calls, change provider schedules/caps/pacing/matching, read production listening archives in automation, change stored JSON schemas, migrate data, modify stable IDs or user-owned fields, or change any credential boundary.

## Safety and release boundary

Automated browser QA uses only synthetic fixtures and the QA fake backend. The v149 branch does not authorize or perform a production provider call, production research/data-maintenance workflow, production R2 read/write, production-data migration, Worker deployment, production smoke run or deployment. Merge remains separately authorized by the explicit user command `Merge it`.
