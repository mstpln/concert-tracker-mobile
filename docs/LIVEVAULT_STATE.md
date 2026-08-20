# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged baseline is **v151** at merge commit `65f5ddd010fbec5651c463e392bf4a7a9d118cfe` (PR #160). The current branch prepares **v152** as a tightly scoped Start-root presentation change: the root is visibly named `MYMUSIC`, the first bottom-navigation item is `Music` with the approved equalizer icon, and a `NEXT CONCERT` divider is inserted immediately above the existing ticket using the exact established Upcoming divider treatment. The stable internal `myconcerts` identity and shared active-tab behavior remain unchanged. No unrelated Stats content, ticket presentation, chronological concert ordering, stored fields, providers, backend/Worker behavior, production workflow, or production data is changed.

### v149 Start stats cards

The Start Listening and Concert stats cards use one shared visual structure. Each card keeps the 1px blue outline and app surface, uses a title-case blue header (`Listening stats` / `Concert stats`) with the normal divider, and shares the same compact bottom CTA strip height. The existing CTA destinations and wording remain `See your listening stats` and `See your full concert stats`.

Inside the Listening stats card, the three-band preview remains the existing two-week ranking. Its section row reads `YOUR TOP BANDS · 2 WEEKS` at left and `TOPLIST` at right; both are grey and uppercase. Artist photos, ranks, listening duration/count values, row navigation and ranking calculations are unchanged. The Concert stats card keeps the existing four values/units and full-concert-stats destination.

### v149 ranking movement arrows

The shared ranking movement renderer used by Top Bands and Top Tracks uses the approved compact SVG arrow: short and thick, gently rounded arrowhead edges, comparatively square tail and the final 10%-wider rectangular shaft. Up remains blue and down remains grey; `New` ranking text and ranking calculations are unchanged. Chevrons, Back controls, navigation arrows and unrelated icons are not affected.

### v149 Stats header

The Stats screen uses the existing compound-header typography dynamically. Listening shows `LISTENINGSTATS` with `LISTENING` blue and `STATS` grey; Concerts shows `CONCERTSTATS` with `CONCERT` blue and `STATS` grey. The Listening/Concerts segmented control remains unchanged.

### v150-v151 selected-year genre detail mobile fit

The selected-year Listening by Genre detail keeps the existing wider-layout wording and presentation. Phone-sized layouts up to 479px use a deterministic compact label/value grid so mobile platform text metrics cannot push the final percentage onto a second line. Compact mode removes only the repeated word `listens` from non-Total genre rows; the Total row keeps `listens`. Durations, listen counts, time percentages, listen percentages and genre labels remain unchanged. A small final font-size reduction is used only if a compact value still needs room.

v151 corrects the live integration path discovered after v150 merged. The older selected-year click handler runs in capture phase and stops later click listeners, so v150's formatting listener could be skipped in the installed app even though direct formatter QA passed. v151 observes the Stats detail DOM instead and applies the same compact formatting after v144 finishes rebuilding the selected-year detail. Focused browser coverage proves the real click/render path applies compact mode before any direct formatter invocation.

### v152 Start Music presentation

The Start root keeps its stable internal `myconcerts` tab/screen identity but is visibly presented as `MYMUSIC`, with `MY` using the existing blue brand treatment and `MUSIC` using the existing companion header treatment. The first bottom-navigation label is `Music` and uses the approved five-bar equalizer icon. Selection remains controlled only by the established shared root-tab state: Music is blue/white only while that root is current, and the active treatment moves normally to Dates, Bands, Stats, or Alerts when those pages are viewed.

`NEXT CONCERT` is inserted immediately above the existing Next Concert ticket and uses a distinct v152 class that shares the exact same CSS rule set and visual treatment as `UPCOMING CONCERTS`, so line treatment, typography, color, gap, margin, padding and responsive behavior remain identical. The ticket itself, Listening stats, Concert stats, upcoming chronological list and ordering are unchanged.

### Preserved v148 Next Concert behavior

Merged v148 remains authoritative for the normal-day Next Concert ticket: v147 calendar geometry/internal spacing stays fixed; the detailed timer is regular weight; canonical `ticketQuantity` is centered in the muted-grey outline pill; the outer normal-day contour is the thinner 1.1px grey stroke; and the right inner frame uses the matched non-scaling 3px white SVG stroke treatment. Concert day remains the v140 `Show today` / `Get directions` / `Open tickets` contract.

`APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at **v152**. v152 reuses existing runtime shell assets, so the deterministic shell-file list remains unchanged. Focused unit/browser coverage checks the MyMusic presentation, approved equalizer glyph, exact Next/Upcoming divider parity, unchanged internal tab identity, shared active-tab transitions, dark/light rendering, narrow/wide app widths and horizontal-overflow safety. Dedicated exact-head dark-mode v152 screenshots are captured at 375px and 480px for visual review. Full desktop/mobile Chromium PR QA remains the merge-readiness gate.

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

v152 is presentation-only. It does not add provider calls, change provider schedules/caps/pacing/matching, read production listening archives in automation, change stored JSON schemas, migrate data, modify stable IDs or user-owned fields, change chronological concert ordering, or change any credential boundary.

## Safety and release boundary

Automated browser QA uses only synthetic fixtures and the QA fake backend. The v152 branch does not authorize or perform a production provider call, production research/data-maintenance workflow, production R2 read/write, production-data migration, Worker deployment, production smoke run or deployment. Merge remains separately authorized by the explicit user command `Merge it`.
