# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged baseline is **v152** at merge commit `3a545c91ab30819b23a66247d5e887cfb390cf85` (PR #161). The current branch prepares **v153 / AUB1** as the approved UI, discovery and listening-stat usability build. It preserves the stable internal `myconcerts` identity, stored concert/band schemas, provider boundaries, ticket ownership, chronological concert ordering and all production-data boundaries.

### v149 Start stats cards

The Start Listening and Concert stats cards use one shared visual structure. Each card keeps the 1px blue outline and app surface, uses a title-case blue header (`Listening stats` / `Concert stats`) with the normal divider, and shares the same compact bottom CTA strip height. The existing CTA destinations and wording remain `See your listening stats` and `See your full concert stats`.

Inside the Listening stats card, the three-band preview remains the existing two-week ranking. Its section row reads `YOUR TOP BANDS · 2 WEEKS` at left and `TOPLIST` at right; both are grey and uppercase. Artist photos, ranks, listening duration/count values, row navigation and ranking calculations are unchanged. The Concert stats card keeps the existing four values/units and full-concert-stats destination.

### v149 ranking movement arrows

The shared ranking movement renderer used by Top Bands and Top Tracks uses the approved compact SVG arrow: short and thick, gently rounded arrowhead edges, comparatively square tail and the final 10%-wider rectangular shaft. Up remains blue and down remains grey; `New` ranking text and ranking calculations remain unchanged. Chevrons, Back controls, navigation arrows and unrelated icons are not affected.

### v149 Stats header

The Stats screen uses the existing compound-header typography dynamically. Listening shows `LISTENINGSTATS` with `LISTENING` blue and `STATS` grey; Concerts shows `CONCERTSTATS` with `CONCERT` blue and `STATS` grey. The Listening/Concerts segmented control remains unchanged.

### v150-v151 selected-year genre detail mobile fit

The selected-year Listening by Genre detail keeps the existing wider-layout wording and presentation. Phone-sized layouts up to 479px use a deterministic compact label/value grid so mobile platform text metrics cannot push the final percentage onto a second line. Compact mode removes only the repeated word `listens` from non-Total genre rows; the Total row keeps `listens`. Durations, listen counts, time percentages, listen percentages and genre labels remain unchanged. A small final font-size reduction is used only if a compact value still needs room.

v151 corrects the live integration path discovered after v150 merged. The older selected-year click handler runs in capture phase and stops later click listeners, so v150's formatting listener could be skipped in the installed app even though direct formatter QA passed. v151 observes the Stats detail DOM instead and applies the same compact formatting after v144 finishes rebuilding the selected-year detail. Focused browser coverage proves the real click/render path applies compact mode before any direct formatter invocation.

### v152 Start Music presentation

The Start root keeps its stable internal `myconcerts` tab/screen identity but is visibly presented as `MYMUSIC`, with `MY` using the existing blue brand treatment and `MUSIC` using the existing companion header treatment. The first bottom-navigation label is `Music` and uses the approved five-bar equalizer icon. Selection remains controlled only by the established shared root-tab state: Music is blue/white only while that root is current, and the active treatment moves normally to Dates, Bands, Stats, or Alerts when those pages are viewed.

`NEXT CONCERT` is inserted immediately above the existing Next Concert ticket and uses a distinct v152 class that shares the established `UPCOMING CONCERTS` separator treatment. The ticket itself, Listening stats, Concert stats, upcoming chronological list and ordering remain unchanged in the merged v152 baseline.

### v153 AUB1 UI, discovery and listening-stat usability

AUB1 keeps the v152 Start structure but balances the Next Concert ticket vertically: the Stats-to-`NEXT CONCERT` relationship is untouched, while the separator-to-ticket gap uses the same established 28px rhythm as the ticket-to-`UPCOMING CONCERTS` gap. On normal non-show days, `Next up` is removed, the band moves into that space, and the existing venue/address data can use natural multiple lines instead of the previous one-line ellipsis. The v147/v148 right-side calendar/countdown geometry, ticket quantity treatment and concert-day action path remain authoritative and unchanged.

The `MYMUSIC` header now uses the exact same approved five-bar equalizer identity as the Music bottom-nav item. Stats uses the approved angular rising line with an upper-right arrowhead and no dots or enclosing box in both the Stats nav and Stats header identities.

Listening Stats now states `Most listened genre all time`. Selected-year Listening Hours detail adds `Days active` and `Daily average`, where active days are unique UTC calendar dates under the existing valid-listen contract and daily average is valid listening duration divided by those active dates. The all-time yearly card adds `Active days per year` and `Daily average`; the annual active-day average uses the continuous completed-calendar-year span represented from the first valid linked listen through the year before the current one, so a completed zero-listen year contributes zero and the incomplete current year is excluded. The all-time daily average uses full valid linked history.

Both yearly Listening Hours and Listening by Genre keep their existing focused six-year navigation as the default and add an `Overview` control. Overview retains every underlying yearly point/bar inside the existing card footprint without horizontal scrolling and reduces only year-label density. `Focused` returns to the existing renderer.

Concert Alerts add one compact geographic-relevance tag using the strict priority `Nearby` → `SE` → `EU` → no tag. Grouped tour alerts reconstruct their actual member concerts from the existing band+discovery-run identity so Sweden can be evaluated without changing stored alert/concert data. Release behavior remains untouched.

My Bands adds a transient, case-insensitive band-name search directly below the collection count and above the existing filters. Search composes with Hide inactive, Show muted only and Genre, preserves existing alphabetical order, provides a conditional clear control and `No bands found` state, and clears whenever My Bands is left. No search state is persisted.

### Preserved v148 Next Concert behavior

Merged v148 remains authoritative for the normal-day Next Concert ticket chrome: v147 calendar geometry/internal spacing stays fixed; the detailed timer is regular weight; canonical `ticketQuantity` is centered in the muted-grey outline pill; the outer normal-day contour is the thinner 1.1px grey stroke; and the right inner frame uses the matched non-scaling 3px white SVG stroke treatment. Concert day remains the v140 `Show today` / `Get directions` / `Open tickets` contract.

`APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at **v153** for AUB1. The deterministic shell list includes the focused AUB1 CSS/JS layers. Unit and synthetic browser coverage targets activity calculations, alert priority, approved icon identities, balanced Next Concert spacing, multiline venue/address behavior, both Overview charts, My Bands search/filter composition and transient clearing, dark/light-safe existing tokens, narrow/wide layouts and horizontal-overflow safety. Full desktop/mobile Chromium PR QA remains the merge-readiness gate.

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

v153/AUB1 adds no provider calls, provider schedules/caps/pacing/matching changes, production listening-archive reads in automation, stored JSON schema changes, migrations, stable-ID changes, user-owned-field writes, backend/Worker behavior, credential changes or production-data operations. Alert relevance and My Bands search are view-only. Listening activity metrics derive from the already-authorized in-app listening history using existing validity/identity semantics.

## Safety and release boundary

Automated browser QA uses only synthetic fixtures and the QA fake backend. The v153/AUB1 branch does not authorize or perform a production provider call, production research/data-maintenance workflow, production R2 read/write, production-data migration, Worker deployment, production smoke run or deployment. Merge remains separately authorized by the explicit user command `Merge it`.
