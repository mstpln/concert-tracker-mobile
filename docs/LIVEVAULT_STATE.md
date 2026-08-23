# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged baseline is **v157 / AUB3 Correction Build**. The current implementation branch `feature/venue-metadata-v158` targets **v158 / Venue Metadata Build** without changing production data. It preserves stable concert IDs, the internal `myconcerts` identity, provider boundaries, ticket ownership and all production-data boundaries while adding a separate reusable venue-information layer.

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

### v154 AUB1 post-merge visual correction

The Stats header and bottom navigation now consume the corrected shared `statsBars` glyph: the approved rising angular line ends in a clean, proportionate upper-right arrowhead with no dots, markers or enclosing box. The Listening Hours Overview card keeps the same All-time activity data and structure while giving its divider, heading, two aligned metrics and bottom edge a deliberate spacing rhythm.

### v155 AUB2 lineup roles and performance stats

Each concert has one additive user-owned `lineupRole`, restricted to `headliner` or `support`. Legacy/malformed records are treated as `headliner` and normalized idempotently in memory, then persisted on their next ordinary safe concert write; no production-wide backfill is required. Marking a concert as attending adds `headliner` only when no valid role already exists. User and unknown fields remain intact, provider refresh/write payloads preserve the latest stored role, and optimistic conflict reconciliation treats an initialization default as lower priority than a valid role concurrently saved by another client.

Attended past and upcoming cards show a compact role badge directly below the band name. Its inline two-choice selector supports native keyboard, touch and pointer input; a successful save collapses it, while a failed save retains the previous value and leaves a local retry message. Concert Stats reports Headliner and Support performance counts and percentages across attended past performances, with every performance contributing exactly once and legacy missing roles counting as headliner.

The v155 baseline contains no same-event relationship and deliberately never infers one from venue/date similarity.

### v156 AUB3 explicit event relationships

AUB3 adds an optional user-owned `eventGroupId` to concert performance records. Concert records and stable IDs remain independent. Link, regroup and unlink actions are explicit, confirmed and reversible; candidates require the same date, normalized venue and city, but similarity alone never groups records. New relationship IDs are collision-checked. Only valid groups may reorder their occupied list positions, placing stable support performances before headliners without moving unrelated cards.

The Start Next Concert ticket presents a valid grouped event as support act(s), headliner, divider, venue and city while preserving the existing silhouette, dimensions, right stub and show-day actions. Ticket quantity, ticket cost and travel distance resolve once per valid event. Equal duplicates count once; conflicting values use a conservative minimum and remain visibly detectable. Groups whose members disagree on required date or venue context fail closed: ambiguous additive totals are excluded and the UI marks the relationship for review.

Concert Stats now distinguishes event metrics from performance metrics. Concert nights, spend, travel, venue/city visits, chronological event milestones and ticket extremes are event-level. Artist appearances, ratings, setlists, genres and lineup roles remain performance-level. Provider and optimistic-concurrency writes preserve `eventGroupId`, `lineupRole`, user-owned values and unknown fields.

### v157 AUB3 correction: automatic shared-event interpretation

v157 keeps the v156 event/performance model and all independent performance records, but changes the normal relationship-establishment path. An ungrouped record is eligible for a derived shared event only when it is `attending: true` and has an exact date, a non-empty venue under the existing conservative normalization, and a non-empty normalized city. Two or more eligible records share an effective event only when all three context values match. Missing or blank city always fails closed; `lineupRole`, same date alone, same venue alone, same city alone and provider similarity never establish event identity.

The automatic relationship is interpreted centrally in `eventModelV156.js` at read time. It does not write a generated `eventGroupId` back into concert records and therefore requires no production backfill or historical record rewrite. Existing valid v156 `eventGroupId` relationships remain authoritative and are preserved by provider/concurrency paths. Their historical compatibility is retained: a missing city alone does not invalidate an established explicit group, while conflicting known cities still fail closed.

Within any valid effective event, Support performance cards occupy the group's existing list slots before Headliner cards with stable same-role ordering; unrelated concerts keep chronological placement. Grouped Next Concert, one-night event statistics, ticket quantity/cost conflict handling and travel deduplication reuse the same central event interpretation. Normal cards no longer expose the permanent `Link same event` control.

The manual form is visibly `ADD A CONCERT` with CTA `Add a concert`. It continues to create both historical and upcoming attended records through the existing path, keeps the existing `manuallyAdded` lifecycle unchanged, and exposes exactly the current calendar year plus one future year above the historical range to 1960.

### v158 Venue Metadata Build

The v158 branch adds a separate durable `venues.json` metadata document rather than copying venue facts onto concert records. Venue records carry a stable `venueId`, canonical name/city/country context, optional full address, positive-integer `maxCapacity`, official HTTPS URL, short factual description, research status/timestamp and internal source evidence. Unknown future venue fields are preserved by ordinary object normalization. Matching is conservative: normalized venue name + city are required, known countries may not conflict, and ambiguous same-name/same-city candidates require an exact available address match or fail closed.

The UI reads venue metadata once during ordinary app loading and reuses it across surfaces. Past and upcoming attended cards show exact `Max Capacity: X XXX` wording under the address and above distance. The Next Concert left information area shows the same capacity without changing the v147/v148 ticket shell or right-side calendar/countdown geometry. Dates > Venues keeps the existing left hierarchy and upper-right chevron while placing capacity in the lower-right corner. Venue Detail now surfaces the fullest available address, capacity when known, a clickable official website and a short factual About description above the existing show history. Missing capacity produces no placeholder, and research source URLs/timestamps are never rendered.

The primary `worker.js` now owns `venues.json` through its existing explicit file allowlist and protected JSON write path. Venue metadata reads remain authenticated, while `PUT /venues.json` is restricted to the data-maintenance role and retains the established conditional ETag creation/update semantics, size/content-type checks and root document validation. `wrangler.jsonc` continues to point directly to `worker.js`; no wrapper Worker or client-side provider secret path is introduced. Scheduled automation is intentionally not granted venue-write access in this build. The local `scripts/venueMetadataBackfillDryRun.js` planner can derive conservative unique research targets from supplied JSON files without network/provider/R2 access; it defaults to attended venues and supports an explicitly requested wider local target set.

The v158 core build does **not** run the manual backfill, call Tavily/Groq, create production `venues.json`, enable scheduled venue enrichment or deploy the Worker. Those are later, separately authorized production/data phases after code and synthetic QA are accepted.

### Preserved v148 Next Concert behavior

Merged v148 remains authoritative for the normal-day Next Concert ticket chrome: v147 calendar geometry/internal spacing stays fixed; the detailed timer is regular weight; canonical `ticketQuantity` is centered in the muted-grey outline pill; the outer normal-day contour is the thinner 1.1px grey stroke; and the right inner frame uses the matched non-scaling 3px white SVG stroke treatment. Concert day remains the v140 `Show today` / `Get directions` / `Open tickets` contract.

`APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at **v158** on the Venue Metadata Build branch. The deterministic shell adds the focused venue metadata model/UI/CSS layers while retaining every existing v157 shell owner. Unit and synthetic browser coverage targets conservative venue identity, positive-only capacity formatting, missing-capacity omission, attended past/upcoming card placement, Next Concert geometry preservation, lower-right Venues-card placement, clean Venue Detail metadata, source-hiding, 375px/480px overflow safety, and backfill target deduplication. Full desktop/mobile Chromium PR QA remains the merge-readiness gate.

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

v157 does not change provider ownership, provider matching, schedules, quotas, backend/Worker behavior or production data. Existing stored `eventGroupId`, `lineupRole`, stable IDs, user-owned values and unknown fields remain preserved by the established main/focused concert write and optimistic-concurrency paths. Automatic grouping is a derived read-time interpretation only; it performs no backfill and writes no relationship field.

v158 adds a venue-research ownership boundary without changing concert ownership: max capacity, official venue URL, description and internal research provenance belong to `venues.json`; concert attendance, notes, tickets, ratings, roles, stable IDs and unknown fields remain in their existing records and are never rewritten by venue metadata work. Future Tavily/Groq automation remains disabled until a later explicitly reviewed build.

## Safety and release boundary

Automated browser QA uses only synthetic fixtures and the QA fake backend. The v158 branch has not authorized or performed a production provider call, production research/data-maintenance workflow, production R2 read/write, production-data migration, Worker deployment, production smoke run or deployment. The manual venue backfill and any future scheduled venue enrichment remain separate production actions requiring explicit authorization.