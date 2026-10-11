# LiveVault Decisions

This continuity file was compacted on 2026-09-04 after the workflow/data-enrichment integrity audit. Earlier rationale remains recoverable in Git history. The active contracts below supersede older wording where they conflict.

## Repository, safety and release control

### GitHub `main` is authoritative

**Decision:** Merged `main`, not chat memory, stale uploads or old branch copies, is the source of truth.

**Consequence:** Before changes, read `AGENTS.md`, current state/decisions/build-state, relevant current code, recent PRs and current app/service-worker versions.

### Merge and production actions require separate authorization

**Decision:** Automated QA uses synthetic data and the fake backend. Merge requires the explicit phrase `Merge it`. Deployment, production provider/workflow execution, production smoke and production-data writes each require separate authorization.

**Consequence:** A branch, green CI, mergeability or merged code never authorizes production execution. Production smoke is manual-only/read-only.

### Stable/user/provider ownership is preserved

**Decision:** Stable BANDMARKR IDs, user-owned fields, reviewed decisions, provider-owned state/provenance and unknown future fields survive enrichment, canonicalization and migration.

**Consequence:** Ambiguity fails closed. Enrichment writes use latest-state optimistic concurrency. Newer provider evidence cannot overwrite user-owned data merely because it is newer.

### v185 Highlights-only balanced card spacing

**Decision:** Only beneath the unchanged Music Highlights/Concerts 33px selector, Highlights uses 12px to the Listening stats card and 12px between Listening and Concert stats. These replace approximately 20px and 16px respectively and free roughly 12px above the fixed bottom navigation on the approved phone viewport. Do not reduce space **above** the main tabs, alter card internals, bottom nav, scrolling/safe-area rules, Concerts or other screens. The CSS applies only to Music with Highlights selected.

### v184 Visually continuous Listening and Concerts cards

**Decision:** On Band Detail > Listening, keep the existing 42px muted timeframe control and unaltered Your Listening statistics and Listening Over Time chart, but display them within a single outer card border. Remove only the duplicate card borders and inter-card gap. The chart stays full width, Top Tracks/Top Albums stays separate, and all data and interaction logic remains unchanged.

**Decision:** Under Music > Concerts, the existing 42px Upcoming / Past / Cancelled selector visually forms the top of the first native concert card of whichever panel is selected, removing the separate gap and shared-edge double border. Keep the year/show-count heading outside and above this unit, including its v183 event-aware "more shows" count. Subsequent concert cards and later year headings remain in their original standalone positions, and empty panels have a matching continuous bottom frame. Preserve all existing concert card controls and styling.

### v183 Music information hierarchy and neutral nested tabs

**Decision:** Music is split into a 33px/13px Highlights (default) / Concerts primary navigation using the same main segmented control as Stats/Discover. Highlights retains the existing listening and concert stats teasers. Concerts begins with the latest genuinely attended concert: artist and elapsed calendar days aligned on one horizontal line, date below; it appears even with no upcoming concert. The promoted v182 Next Concert banner remains the featured show; correct the 1-2-digit numeral's visual bottom alignment inside the existing banner dimensions.

**Decision:** The Upcoming / Past / Cancelled concert history selector has the exact muted neutral 42px Top Bands/Top Tracks selector treatment, adapted to three buttons. Year and show count keep the existing outside-card text appearance, placed above the lower selector and updated to the selected list; additional years keep their existing headings. The first validated promoted event group remains excluded from the remaining Upcoming rows.

**Decision:** On Band Detail > Listening, keep Concerts/Alerts/Listening/Data blue primary tabs and move only the existing 2 weeks/3 months/1 year/All time selector into the Your Listening summary card with that same muted secondary treatment. Preserve all original concert/listening card designs, handlers, empty states, fields, and user/provider ownership. v182's absolute featured placement invariant belonged to the prior combined Start layout; the new Concerts tab deliberately removes the old invisible spacers, while banner internal height and responsive rules stay stable. No data migration or provider changes.

### v182 Compact Hero Split (#21) and unchanged featured-card top

**Decision:** Replace only the ordinary Next Concert blue banner with the user-approved Version 21. It displays a dominant, responsive day number on the left; `NEXT CONCERT` over stacked `DAYS / LEFT` in the middle; distance over live days/hours/minutes on the right separated by a vertical rule. Use the mockup's subtle blue spotlight gradient, scaled to the true app-card width, without extra icons, new cards or a rearranged concert detail panel.

**Safety constraint:** The featured card **must begin at precisely the same vertical position as v181**. Keep its existing outside geometry and invisible section-label/year spacers unchanged; resizing or redesigning *inside* the banner must not shift its top edge toward the initial viewport/bottom nav. Preserve the cyan concert-day state and ticket actions, current real data and every unrelated screen. This is a v182 user-visible build; APP_VERSION/CACHE_NAME_LITERAL advance together once.

### v181 unified Start tabs and cancellation visibility

**Decision:** Start keeps the Next Concert card in its existing vertical position while replacing the visible separator with the approved 80px option-02 blue banner (small NEXT CONCERT above normal-size DAYS LEFT; distance above live countdown right of a vertical divider). The first verified upcoming event remains promoted only once; all remaining upcoming, actually attended and cancelled shows live under one default-Upcoming, three-column 33px/13px tab strip. Each tab has the same width. The year-left/show-count-right headings have no connecting horizontal rule.

**Consequence:** All main segmented tab sections use 33px total height and 13px normal-case type; Listening timeframe selectors retain their distinct sizing. The Start tab panel's native HTML `hidden` attribute must be toggled directly (not only a class) after click, navigation, and reload, so cancelled concerts never become invisibly trapped. The v167/v169 next-event promotion must run before remaining Upcoming rows are relocated, preserving ticket/event controls and support/headliner grouping. The invisible retired Next separator must preserve its geometry so the card does not peek above the selected blue Music navigation at the original initial screen height.

### v180 user-owned cancellation and restorative history

**Decision:** Manual cancellation/restoration uses optional `personalLifecycleStatus: 'cancelled' | 'active'`, never overwriting provider-owned `lifecycleStatus` or evidence. Absent personal state retains the provider state. A cancelled concert remains saved in its dedicated Start history tab, with unchanged tickets, prices and other user-owned fields, but is excluded from all attended-concert metrics and spending. The matched option-8 green ATTENDED and red CANCELLED statuses are uppercase text with no icon; 28px Cancelled/Restore and trash actions are separate and require confirmation. Restoring a past/TBD concert cannot silently create an attended show or upcoming countdown. Event-group peers with the same verified date are updated together where safe. Optimized venue-directory/detail and Discover render-cache signatures must reflect both provider and personal lifecycle status; otherwise a cancellation can leave stale upcoming rows or incorrect Attended labels.

## Canonical venue identity

### v164 physical grouping remains the base

**Decision:** Rich v174 identity is additive over established v164 physical-venue grouping. It may add fail-closed fallback or merge established groups only when every member resolves unambiguously to one canonical venue; it must not split a physical group already established by v164.

### Venue identity follows meaningful venue continuity

**Decision:** A BANDMARKR venue is the meaningful named venue a person would say they visited. A proven rename/relocation/rebuild/major renovation may remain one venue. Address difference alone is neither a generic split nor merge rule.

### Rooms/stages/hospitality sub-locations are secondary

**Decision:** Internal rooms, halls, stages, theatres, loges, temporary structures and provider hospitality/premium/package locations do not create separate venues when they belong to a parent venue.

**Consequence:** Preserve the sub-location as concert detail; venue list/detail/counts/stats use the parent canonical venue.

### Independent venues and simultaneous branches remain separate

**Decision:** Independently identifiable venues in one complex remain distinct even when sharing an address/campus. Simultaneously operating branches under one brand are distinct; proven relocation/continuation may remain one venue.

### Historical and current venue facts coexist

**Decision:** Historical/attended concerts preserve venue name/city/address correct for the concert date. Canonical venue detail uses current facts. Upcoming presentation may use current canonical facts while retaining obsolete provider wording as evidence.

### Locality variants are normalization evidence only

**Decision:** Locality variants such as London/Greenwich or Milan/Milano can support a reviewed mapping but cannot independently merge unrelated venues.

### Festival venue semantics are explicit

**Decision:** A festival at an established venue is event context, not automatically a new venue. Where the festival itself is the meaningful destination and no better venue exists, it may be the canonical venue.

### Provider venue IDs are namespace-scoped evidence

**Decision:** Provider venue IDs are observations, never canonical BANDMARKR venue identity.

## Canonical concert identity

### Same band + canonical venue + calendar date is one concert

**Decision:** Canonical concert identity is `bandId + canonicalVenueId + full calendar date`.

**Consequence:** Time, provider listing ID, room/stage, URL, package/offer type and conflicting provider times do not split a concert. The earlier time-based split rule is superseded.

### Different date or genuinely different canonical venue may be separate

**Decision:** Same band at the same venue on different dates is separate. Same band/date at genuinely different canonical venues may be separate. Multi-day festival appearances remain separate concert records per day.

### Provider observations are evidence, not canonical IDs

**Decision:** Provider listing/event/venue IDs, titles, URLs, times, statuses, attraction IDs and offer classifications are namespace-scoped observations attached to canonical concert identity.

**Consequence:** Every automatic concert write path must accumulate/reconcile provider observations through shared canonical ingestion rather than append duplicates or use a provider-specific identity heuristic.

### Duplicate reconciliation preserves stable identity and fails closed on user conflicts

**Decision:** Persistent reconciliation keeps a safe existing concert ID, preserves merged-away IDs as legacy identity, unions evidence/unknown fields and never invents a winner for contradictory user-owned fields. Provider-owned presentation may choose the strongest verified observation, not newest-wins.

## Canonical event identity and statistics

### Explicit `eventGroupId` remains user-owned

**Decision:** Valid explicit event relationships are authoritative and are not silently rewritten by derived canonical event identity.

### Ordinary event identity is canonical venue + date

**Decision:** Without an explicit relationship or festival override, different bands at the same canonical venue on the same date belong to one event.

### One proven festival edition can span dates/venues

**Decision:** A reliably established festival edition may span dates, stages and canonical venues; each annual edition is separate. Festival grouping must be evidence-backed. Non-festival consecutive-night shows remain separate events.

### Event- and performance-level metrics remain separate

**Decision:** Concert nights/events, ticket spend, travel, venue/city visits, festival attendance and event milestones are event-level. Artist appearances, ratings, setlists, genres and lineup roles are performance-level.

**Consequence:** Support/headliner and festival ticket cost is counted once using the established pattern of one real cost and free companion performance rows. Festival travel is counted once using the verified primary festival venue or otherwise the shortest known festival-venue distance.

## Concert lifecycle and provider presentation ownership

### Reschedule keeps identity; attended historical dates are immutable

**Decision:** A confirmed upcoming reschedule keeps the stable concert identity, moves to the replacement date and preserves prior schedule/provider history. Attended historical dates cannot be changed by provider data.

### Cancellation remains stored

**Decision:** Cancellation marks the existing concert; it never automatically deletes the record/user history.

### Postponed without replacement becomes DATE TBD

**Decision:** A postponed concert with no verified replacement date becomes `POSTPONED · DATE TBD`; the old date survives only in lifecycle history.

### Replacement provider IDs require proven continuity

**Decision:** A replacement listing/provider ID may attach to a postponed/rescheduled concert only when continuity is proven.

### Conflicting terminal/active provider states require review

**Decision:** A cancelled concert cannot be reactivated/replaced by later active evidence unless provider-linked continuity proves a replacement on a new date. Conflicting evidence is retained and marked review-required.

### Top-level provider fields are ownership-scoped

**Decision:** Cancelled/postponed state and provider-presentation identity fields belong to the provider event that owns the selected top-level presentation. Same-event evidence may fill gaps; a stronger/proven replacement may take over; weaker unrelated evidence remains observation-only.

## Migration and deterministic research

### Current ambiguity is researched explicitly, not guessed

**Decision:** Routine duplicate/venue ambiguity is resolved through explicit researched merge/separate/correction/historical decisions where possible. Genuinely contradictory/unresolvable cases remain blocked. Pair-specific evidence must not become a generic matching rule.

### Research corrections are explicit and replay-safe

**Decision:** The hashed registry may correct exact source records or assign exact concerts to a researched canonical venue. Stable/legacy IDs cannot be mutated by correction. Raw provider venue/city/address/evidence remains intact. Replaying unchanged decisions on migrated output is a no-op.

### Missing venues require researched definitions

**Decision:** A real missing venue may be added only through a complete, evidenced registry definition. Placeholder/incomplete/conflicting additions block.

### Production migration is hash-guarded, reversible and separately authorized

**Decision:** Migration uses fresh authorized exports, exact counts/SHA-256 guards, backups, mappings, manifests, orphan checks and a no-op second pass before any separately authorized production write.

## Scheduled provider workflows

### Structured research remains at 07:47 UTC M/W/F

**Decision:** `Structured concert and release research` remains configured for `07:47 UTC` Monday/Wednesday/Friday rather than `:00`.

**Consequence:** This reduces top-of-hour congestion but does not guarantee timely GitHub Actions delivery. September 2 and September 4, 2026 demonstrated multi-hour schedule latency.

### Scheduled provider periods are idempotent and fail closed

**Decision:** Successful scheduled structured research, focused Tavily, and the optional twice-monthly venue-metadata research stage each record a persisted per-owner completion marker in `apiUsage.json`. Every known scheduled provider stage resolves to its most recent nominal schedule occurrence, even after cross-midnight or multi-day GitHub delivery delay. A later duplicate event for that period exits before provider work. An unknown/unconfigured scheduled provider owner is rejected before lease acquisition or provider execution.

**Consequence:** The shared `live-vault-data-writes` concurrency group and scheduler lease prevent overlapping writers; completion markers separately prevent later duplicate provider cycles and there is no unmarked scheduled-provider path. Only successful scheduled stages mark a period complete. Failed stages remain retryable. Manual `workflow_dispatch` is never suppressed by a scheduled-period marker. Marker state is additive and preserves unknown usage fields. Malformed marker state fails closed.

### Scheduler idempotency does not guarantee delivery

**Decision:** The app does not pretend that code can force GitHub Actions to fire on time.

**Consequence:** Completion markers prevent duplicate work but cannot create a missed/delayed run. Operational monitoring must distinguish “no run delivered” from “duplicate run safely skipped.”

## Enrichment workflow contracts

### All automatic concert enrichment uses shared canonical ingestion

**Decision:** Main structured research and focused Tavily both route persisted concert observations through the v175 canonical ingestion primitives with current canonical venue identity and latest-state reconciled writes.

**Consequence:** Provider-specific discovery may differ, but persistence semantics for identity, lifecycle, provider ownership, stable IDs, user/unknown fields and ambiguity are shared. Focused Tavily run metrics count only actual persisted additions/merges/lifecycle changes as changes; idempotent exact replays are reported separately as unchanged.

### Ticketmaster automatic admission requires trusted attraction identity

**Decision:** Automatic Ticketmaster event lookup/admission requires the band's trusted reviewed attraction ID and that exact attraction on the event. Co-bill ordering cannot substitute another artist's attraction ID.

### MusicBrainz automatic identity is conservative

**Decision:** MusicBrainz may auto-confirm only exact artist-name/alias evidence with no impersonator signal, no origin contradiction/unverifiable saved-origin case, threshold clearance and clear lead. Otherwise it remains reviewable/no-match/error state.

### Setlist absence must be evidenced, not inferred from provider failure

**Decision:** Actual setlist persistence requires date + artist identity + venue agreement. Provider 404/429/transport errors do not become trusted “no setlist” facts. Only validated empty-result/empty-setlist outcomes may advance trusted absence state.

### Manual/destructive maintenance requires explicit intent and latest-state safety

**Decision:** Historical destructive cleanup tooling remains manual and must require an explicit confirmation phrase, a mandatory rollback destination, valid expected document shape, and latest-state reconciled mutation.

**Consequence:** The legacy release-feed cleanup requires `CLEAN_LEGACY_RELEASE_FEED`, requires `RELEASE_FEED_BACKUP_PATH`, refuses missing/malformed non-array `news.json`, operates on latest state and records an exact pre-cleanup snapshot before mutation.

## Performance and storage contracts

### v166 indexed/cached venue navigation remains authoritative

**Decision:** Ordinary Discover/Concerts must not construct the full canonical venue directory. Venue resolution/navigation remains indexed/cached. Repeated concert × venue full scans are a hard regression blocker.

### v178 cache validity follows normalized venue revisions

**Decision:** Runtime venue indexes/grouping use one normalized venue-record revision. Equivalent refresh data retains caches; changed data rebuilds dependent indexes lazily once.

### Prefer additive fields in existing JSON documents

**Decision:** Canonical venue/event/provider metadata should remain additive/backward-compatible in existing production JSON unless a separate storage/API change is explicitly approved.

## Other active contracts

- v173 bottom navigation remains `Music · Bands · Discover · Stats · Alerts`; stable internal tab identities remain unchanged.
- Discover remains the visible identity over stable internal `concerts`.
- Recommendation/listening provider ownership, private listening-history storage, provider caps/pacing/circuits/leases remain unchanged.
- `lineupRole` remains user-owned.
- Active Releases remain retired unless explicitly reintroduced.
- PR #134 remains unrelated production-inert listening backfill tooling.
