# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged baseline is **v149** at merge commit `cd3f473a54dfb058e86cc1644b043ab1299e5ade` (PR #158). The current branch prepares **v150** as a tightly scoped responsive correction for the selected-year Listening by Genre detail. No unrelated Stats content, Start cards, Next Concert presentation, navigation, data calculations, stored fields, providers, backend/Worker behavior, production workflow, or production data is changed.

### v149 Start stats cards

The Start Listening and Concert stats cards use one shared visual structure. Each card keeps the 1px blue outline and app surface, uses a title-case blue header (`Listening stats` / `Concert stats`) with the normal divider, and shares the same compact bottom CTA strip height. The existing CTA destinations and wording remain `See your listening stats` and `See your full concert stats`.

Inside the Listening stats card, the three-band preview remains the existing two-week ranking. Its section row reads `YOUR TOP BANDS · 2 WEEKS` at left and `TOPLIST` at right; both are grey and uppercase. Artist photos, ranks, listening duration/count values, row navigation and ranking calculations are unchanged. The Concert stats card keeps the existing four values/units and full-concert-stats destination.

### v149 ranking movement arrows

The shared ranking movement renderer used by Top Bands and Top Tracks uses the approved compact SVG arrow: short and thick, gently rounded arrowhead edges, comparatively square tail and the final 10%-wider rectangular shaft. Up remains blue and down remains grey; `New` ranking text and ranking calculations remain unchanged. Chevrons, Back controls, navigation arrows and unrelated icons are not affected.

### v149 Stats header

The Stats screen uses the existing compound-header typography dynamically. Listening shows `LISTENINGSTATS` with `LISTENING` blue and `STATS` grey; Concerts shows `CONCERTSTATS` with `CONCERT` blue and `STATS` grey. The Listening/Concerts segmented control remains unchanged.

### v150 selected-year genre detail mobile fit

The selected-year Listening by Genre detail keeps the existing wider-layout wording and presentation. Phone-sized layouts up to 479px use a deterministic compact label/value grid so mobile platform text metrics cannot push the final percentage onto a second line. Compact mode removes only the repeated word `listens` from non-Total genre rows; the Total row keeps `listens`. Durations, listen counts, time percentages, listen percentages and genre labels remain unchanged. A small final font-size reduction is used only if a compact value still needs room.

### Preserved v148 Next Concert behavior

Merged v148 remains authoritative for the normal-day Next Concert ticket: v147 calendar geometry/internal spacing stays fixed; the detailed timer is regular weight; canonical `ticketQuantity` is centered in the muted-grey outline pill; the outer normal-day contour is the thinner 1.1px grey stroke; and the right inner frame uses the matched non-scaling 3px white SVG stroke treatment. Concert day remains the v140 `Show today` / `Get directions` / `Open tickets` contract.

`APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at **v150**. v150 reuses the existing `startStatsV149.js` / `startStatsV149.css` shell assets for the focused Stats responsive correction, so the deterministic shell-file list is unchanged. Focused Playwright coverage verifies compact one-line rows at 375px, 414px, 440px and 479px, preserved full wording at 480px, dark/light presentation and no horizontal overflow. Full desktop/mobile Chromium PR QA remains the merge-readiness gate.

The merged v145 Settings data-correctness and automation-reporting behavior remains intact. The merged v144 genre/My Bands ownership behavior, v143 UI alignment and Sweden filters, v142 Ticketmaster venue-quality protection, v135-v137 provider/release cleanup, and existing listening identity/artwork ownership rules remain authoritative.

## Backlog hygiene

The historical GitHub backlog has been reconciled against merged `main` so completed/superseded work is not mistaken for current product debt.

- Issue #70 is completed by merged GAU5 / PR #123.
- Issue #71 is completed across merged Listening Build 3.3 work.
- Issue #72 is completed across GAU1-GAU5 and later follow-up fixes.
- PR #132 is superseded by merged PR #133.
- PR #89 is superseded by later v105/v106 MusicBrainz pacing/defer corrections.
- PR #92 is superseded by later listening-maintenance contracts/foundation and the Data Automation stack.
- PR #41 is obsolete and superseded by later identity/enrichment/maintenance flows.
- PR #134 remains intentionally open as production-inert NB2 band-profile backfill tooling and is not current application behavior.
- Cloudflare Worker CORS-origin hardening remains deferred backlog work.
- Versioned CSS/JS patch-layer consolidation remains deferred maintenance debt and must remain isolated from feature work.

## Provider and data boundaries

v135-v137 retired active Releases while preserving stored historical/provider state. Existing provider-neutral link resolution, listening artwork ownership, MusicBrainz/Spotify safety, private-listening boundaries, UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation and immutable source observations remain authoritative.

v150 is presentation-only. It does not add provider calls, change provider schedules/caps/pacing/matching, read production listening archives in automation, change stored JSON schemas, migrate data, modify stable IDs or user-owned fields, or change any credential boundary.

## Safety and release boundary

Automated browser QA uses only synthetic fixtures and the QA fake backend. The v150 branch does not authorize or perform a production provider call, production research/data-maintenance workflow, production R2 read/write, production-data migration, Worker deployment, production smoke run or deployment. Merge remains separately authorized by the explicit user command `Merge it`.
