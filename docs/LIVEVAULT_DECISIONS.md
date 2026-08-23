# LiveVault Decisions

This continuity file was compacted again on 2026-08-20. Earlier durable decisions and their full rationale remain recoverable in Git history. The active contracts below must be preserved by future work.

## Repository, safety and data ownership

### GitHub main is authoritative

**Decision:** Treat merged `main`, not chat memory or stale local copies, as product source of truth.

**Consequence:** Before work, read `AGENTS.md`, current state/decisions/build-state, relevant current code, recent PRs and current versions.

### Synthetic QA and explicit release authorization

**Decision:** Automated QA uses fictional data and the fake backend. Merge requires the explicit phrase `Merge it`; production workflows/data/provider execution require separate authorization when applicable.

**Consequence:** Branch/PR creation, a version bump, green CI or mergeability never authorizes merge, deployment, provider calls or production-data writes.

### Stable identity and user ownership are preserved

**Decision:** Stable IDs, user-owned fields, user-reviewed decisions and unknown future fields survive enrichment and reconciliation.

**Consequence:** Use additive/provider-owned state and latest-record conditional merges. Ambiguity fails closed.

### Existing JSON writes use optimistic concurrency

**Decision:** Writes to existing production JSON documents are conditional on the corresponding latest ETag, with only the established bounded reread/reconciliation behavior.

**Consequence:** Stale automation must not overwrite newer user/provider decisions or concurrent additions.

### Credentials remain least-privilege and separated by role

**Decision:** Browser, automation, maintenance and smoke credentials remain separate. Ordinary automation may access only its allowed JSON/derived routes; private listening archives/manifests are not ordinary automation inputs. Production smoke is read-only and sanitized.

**Consequence:** Raw private listening history stays in already-authorized private/browser/trusted-local contexts unless a new explicit security design is approved.

## Listening ownership and provider safety

### Private R2 is the durable listening-history source of truth

**Decision:** Complete sanitized listening history is private R2 data with IndexedDB as the device working copy. Source observations remain immutable.

**Consequence:** Derived identity/artwork layers stay separate; provider failures never invalidate a listen or alter listening statistics.

### Listening artwork metadata remains separate from source events

**Decision:** Provider-specific artwork metadata lives in its provider-owned derived layer; source listens are not rewritten as provider metadata.

**Consequence:** Spotify metadata remains Spotify-owned. Provider-neutral MusicBrainz/ListenBrainz/Cover Art Archive evidence must not be written into Spotify metadata.

### Historical listening identity is catalogue-first and provider-neutral

**Decision:** Reuse existing recording/provider identity and deterministic local catalogue evidence before new provider calls. Spotify is presentation/metadata, not the core historical recording-identity provider.

**Consequence:** Ambiguous or held identity stays unresolved/reviewed rather than guessed.

### Listening artwork is album-oriented and cumulative

**Decision:** Safe album groups use conservative local-band/release grouping. Existing reusable artwork is excluded before provider work; unresolved work is bounded and prioritizes recent/important listening. Spotify uses exact trusted track seeds rather than title search.

**Consequence:** Missing release titles, ambiguous ownership, cross-group conflicts and conflicting album identity fail closed.

### Spotify safety uses one persisted circuit and one cross-scheduler lease

**Decision:** Scheduled Node research and trusted-local Spotify maintenance share the persisted Spotify circuit and scheduler lease. UsageTracker caps/pacing remain authoritative.

**Consequence:** Provider work never bypasses UsageTracker, pacing, lease or circuit gates.

### Scheduled listening artwork remains trusted-local

**Decision:** Automatic Spotify listening-artwork maintenance stays on the trusted local host rather than moving private listening reads into GitHub Actions.

**Consequence:** Installing/running that scheduler, reading production listening data, calling Spotify and writing production metadata/usage remain separately authorized production actions.

### Listening aliases are local attribution only

**Decision:** Optional `listeningAliases` extend local band-name attribution only when one stable BANDMARKR band uniquely owns the normalized name. Explicit known stable band IDs remain authoritative.

**Consequence:** Aliases do not create/replace Spotify or MusicBrainz IDs, rewrite source observations or weaken ambiguity rules.

### Missing artist images use privacy-safe exact identity

**Decision:** Structured research image maintenance may use the validated aggregate `listening/band-activity.json` for priority but may not read raw listening history. Trusted Spotify identity goes to exact artist lookup; search thumbnails are not trusted artwork.

**Consequence:** Manual `photoUrl` is never overwritten and mismatched identity fails closed.

## Provider/release and reporting contracts

### v135 retires active release alerts and scheduled release discovery

**Decision:** Releases is not an active feed/alert surface. Alerts is concert-only. Scheduled structured preload disables release monitoring and lifecycle release-alert planning while preserving stored historical/provider state.

**Consequence:** Reintroducing releases requires a new explicit decision/build.

### v136 reuses provider-neutral evidence before Spotify-specific work

**Decision:** Non-playlist track links and listening artwork consume safe reusable evidence before new Spotify calls. Exact stored Spotify IDs/URLs and exact ListenBrainz/MusicBrainz Spotify URL relations may satisfy non-playlist links; exact trusted release evidence may satisfy Cover Art Archive artwork before Spotify album-artwork enrichment.

**Consequence:** Shared resolvers remain pure/fail-closed; ordinary scheduled automation does not gain raw private listening access; provider-neutral artwork never becomes Spotify-owned metadata.

### Update activity uses one safe per-flow reporting contract

**Decision:** Settings Update activity uses an additive per-flow status/timestamp/result contract with truthful aggregate counts and only normalized safe failure summaries. Device-owned ListenBrainz stores only its latest processed/added/skipped aggregate in browser-local connection state.

**Consequence:** Missing metrics remain missing rather than invented zeroes; raw provider bodies, stacks, secrets, private URLs, ticket data and listening-event details are never displayed.

### Ticketmaster venue quality is monotonic

**Decision:** A provider placeholder venue may never overwrite a genuine venue already stored for the same canonical concert, while valid provider-owned fields may still refresh.

**Consequence:** Venue application remains field-aware and is re-evaluated against the latest reread record before persistence.

## Active UI contracts

### v140 Next Concert uses the taller black/white ticket and neon concert-day action

**Decision:** The Start Next Concert card uses the approved 820x463 true-black ticket silhouette with shallow center notches, repeated side perforations, tear x=468, white inner frames, all-caps artist presentation, normal-day date/countdown and canonical user-owned `ticketQuantity`. On concert day, `Get directions` remains left and `Open tickets` remains right using `#5ED8FF`.

**Consequence:** Maps URL generation and OwnedTickets URL/PDF/multiple-ticket behavior remain authoritative and must not be forked by presentation layers.

### v143 Sweden filter is an exact view-only peer

**Decision:** ConcertDates and Band Detail → Concerts expose Nearby → `SE` → EU. `SE` means canonical `country` exactly `Sweden` after trim/case normalization. The controls are mutually exclusive; root selection persists and profile selection is transient.

**Consequence:** SE filtering never infers country from venue/city/address/coordinates/distance and never writes concert data.

### v144 genre drill-down and My Bands status/navigation are presentation-only

**Decision:** Selected-year Listening by Genre detail uses stored BANDMARKR band-genre attribution and reports separate time/listen percentages. My Bands shows only exceptional favorite/muted status indicators before the chevron and restores viewport/filter state when returning from a band profile.

**Consequence:** Status icons are informational, scroll restoration is transient, and no stored identity/listening ownership changes.

### v146-v148 lock the current normal-day Next Concert calendar/chrome

**Decision:** v146 introduced the full-frame normal-day calendar; v147 fixed its fit/alignment; v148 freezes the v147 calendar geometry/internal spacing while applying only the approved chrome refinements: regular detailed timer weight, centered muted-grey `ticketQuantity` outline pill, thinner 1.1px grey outer contour, and a right inner-frame redraw matching the left frame's exact non-scaling 3px white SVG stroke contract.

**Consequence:** Future unrelated visual work must not move the v147/v148 right-stub geometry, countdown positions, date/header spacing, countdown IDs/ticker behavior, ticketQuantity ownership, left information layout or concert-day Maps/OwnedTickets path unless explicitly redesigned.

### v149 aligns Start stats cards, ranking arrows and contextual Stats headers

**Decision:** The two Start stats cards use one shared visual language without changing their data or destinations. `Listening stats` and `Concert stats` are title-case blue card headers on the existing app surface with the normal divider and 1px blue outline. Both cards use the same compact bottom CTA strip height. The Listening preview keeps `YOUR TOP BANDS · 2 WEEKS` in grey uppercase and places the grey uppercase `TOPLIST` action on that same section row; the previous header-level `View all` wording is removed. Concert metrics remain unchanged.

The shared Top Bands/Top Tracks movement indicator uses the approved compact thick SVG arrow: gently rounded point edges, comparatively square tail, and the final 10%-wider rectangular shaft. Up remains blue, down remains grey, and `New` text/ranking calculations are unchanged. This movement-arrow decision does not apply to chevrons, Back controls, navigation arrows or other icons.

The Stats root header follows the selected sub-tab using the existing compound-header pattern: Listening shows `LISTENINGSTATS` with `LISTENING` blue and `STATS` grey; Concerts shows `CONCERTSTATS` with `CONCERT` blue and `STATS` grey. The segmented Listening/Concerts control remains unchanged.

**Reason:** The Start listening/concert summaries should read as a deliberate matching pair, Toplist navigation should be visually attached to the Top Bands section it controls, ranking movement should use the approved stronger arrow shape consistently, and the Stats page header should communicate the active statistics context using an existing BANDMARKR header pattern.

**Consequence:** v149 is presentation-only. It must not alter listening/concert calculations, Toplist ranking logic, row destinations, concert stats values, Next Concert presentation, stored data, providers, backend/Worker behavior, quotas, credentials, production workflows or unrelated UI.

### v150 keeps selected-year genre detail rows single-line on phone-sized layouts

**Decision:** The selected-year Listening by Genre detail keeps the existing full wording and flex presentation at 480px and wider. Phone-sized layouts up to 479px use the compact agreed form: a per-row label/value grid with a right-aligned no-wrap value column, with the repeated word `listens` removed only from non-Total genre rows. The Total row keeps `listens`; durations, counts and both percentage values stay unchanged.

**Reason:** The full desktop copy is readable at wider widths, but mobile platform text metrics can make the longest genre rows wrap. A deterministic phone-width presentation is safer and simpler than trying to infer wrapping after platform-specific text layout has already occurred.

**Consequence:** v150 uses a 479px maximum compact breakpoint, preserves the existing 480px-and-wider presentation, may use only a small final font-size reduction if compact text still needs room, and must not change genre calculations, selected-year ownership, chart data, navigation, stored data or unrelated Stats UI.

### v151 applies selected-year genre formatting at the DOM render boundary

**Decision:** The v150 compact/full presentation is applied after the selected-year genre detail appears and v144 finishes decorating it, using a Stats-screen DOM observer rather than a later document click listener.

**Reason:** The established selected-year click handler runs in capture phase and calls `stopImmediatePropagation()`. A later click listener can therefore be skipped even though direct formatter tests pass.

**Consequence:** Tests for this presentation must prove the real selected-year click/render path reaches compact/full mode before any direct formatter call. The correction remains presentation-only and does not alter the established click handler, genre calculations, stored data, navigation or provider/backend behavior.

### v152 presents the Start root as MyMusic and separates Next Concert

**Decision:** The Start root keeps the stable internal `myconcerts` tab/screen identity but is visibly named `MYMUSIC`, with `MY` using the existing blue compound-header treatment. The first bottom-navigation item is visibly `Music` and uses the approved five-bar equalizer glyph. Root-tab selection continues to be owned exclusively by the existing shared active-tab mechanism, so Music is blue/white only while that page is current and the selected treatment moves normally to Dates, Bands, Stats or Alerts.

The Start page adds `NEXT CONCERT` immediately above the existing ticket with its own v152 class grouped into the exact same CSS rule set as `UPCOMING CONCERTS`, rather than introducing a different visual treatment.

**Reason:** Listening statistics are now a meaningful part of the Start experience, so `MyMusic` is a broader visible label while the underlying route can remain stable. Sharing the established separator rule set creates a natural boundary between the summary cards, Next Concert ticket and chronological list without redesigning any of those components.

**Consequence:** v152 changes no internal tab IDs/routes, permanent selected-state styling, stats-card content, Next Concert ticket geometry/behavior, chronological upcoming ordering, concert-card data, stored fields, providers, backend/Worker behavior, production workflows or production data.

### v153 AUB1 keeps new discovery/stat controls view-only and uses existing listening-day semantics

**Decision:** AUB1 is a UI/stat-usability build only. The normal-day Next Concert left panel may use multiline venue/address copy and balanced 28px breathing room while the v147/v148 ticket/right-stub geometry and concert-day behavior remain fixed. `MYMUSIC` uses the approved five-bar equalizer in header/nav; Stats uses the approved angular rising line with arrowhead, no dots and no enclosing box.

Listening `Days active` means unique UTC calendar dates containing at least one valid linked listen under the existing listening-stat contract. `Daily average` means valid listening duration divided by those active dates. `Active days per year` is the average active-day count over the continuous completed-calendar-year span represented from the first valid linked listen through the year before the current one; completed years with zero valid listens contribute zero, while the current incomplete year is excluded. Overview mode changes presentation density only and must retain every yearly point/bar.

Concert-alert geographic relevance is view-only and singular with priority `Nearby` → exact `SE` → `EU` → none. My Bands search is transient view state, composes with the existing filters and is cleared whenever My Bands is left.

**Reason:** AUB1 should improve clarity and discoverability without introducing a competing listening-validity model, silently persisting search/filter state, changing concert data semantics or weakening the existing ticket/data ownership boundaries.

**Consequence:** AUB1 writes no new user/provider fields, adds no migration and changes no provider/backend behavior. Future changes to active-day boundaries, alert-priority semantics, Stats icon identity, overview data retention or My Bands search persistence require an explicit new decision.

### v154 corrects the shared Stats arrowhead and All-time activity spacing

**Decision:** The shared Stats glyph keeps the approved rising angular line but uses a clean right-angle upper-right arrowhead with balanced proportions; it remains free of dots, markers and an enclosing box. The Listening Hours Overview All-time activity footer keeps its existing heading, two metrics and values while using deliberate divider spacing, aligned columns and sufficient bottom padding.

**Reason:** The merged v153 arrowhead and footer spacing did not visually match the approved aligned treatment at phone widths.

**Consequence:** v154 is presentation-only. Both Stats icon placements must use the shared glyph source, and no listening calculations, data, chart behavior, navigation, provider/backend behavior or unrelated card styling changes.

### v155 makes lineup role a two-value user-owned performance field

**Decision:** A concert may store only `lineupRole: "headliner"` or `lineupRole: "support"`. The value is user-owned once stored. Legacy missing or malformed values are interpreted as `headliner` and normalized idempotently in memory, then written during the next ordinary safe concert write instead of by a production backfill. Setting attending defaults the field only when a valid role is absent; it never overwrites an existing choice. Provider refreshes start from the latest record and may not replace the stored role.

Attended past and upcoming cards expose the value through one inline two-choice selector beneath the band name. Failed saves retain the prior value and a local retry path. Concert Stats counts attended past records as performances, exactly once each, and reports Headliner/Support counts and percentages under the same logical legacy default.

**Reason:** AUB2 needs an explicit, reviewable distinction between the main artist and a support performance without guessing bill structure or coupling user judgment to provider refreshes.

**Consequence:** `lineupRole` is additive and backward compatible; unknown fields remain preserved. During optimistic reconciliation, an automatic legacy `headliner` default cannot overwrite a valid role concurrently saved by another client, while an explicit role edit retains the established local-change semantics. The current schema has no proven same-event relation, so chronological ordering remains unchanged. Event grouping, within-event ordering, ticket deduplication, event-level statistics and all other AUB3 work require a later explicit build.

### v156 groups performances only through an explicit user-owned relationship

**Decision:** Concerts remain independent performance records with stable IDs. An optional `eventGroupId` links records only after an explicit, confirmed user action among strong same-date/venue/city candidates. Similar records are never auto-grouped. Linking, regrouping and unlinking are reversible, collision-checked and preserve unknown/user-owned fields. A valid group orders support performances before headliners only within the list slots already occupied by that group.

Valid groups resolve ticket quantity, ticket cost and travel once per event. Identical duplicates count once. Conflicts never sum: the conservative minimum is used and marked as a conflict. A group with inconsistent required date or venue context fails closed, is visibly marked for review and contributes no ambiguous additive cost/travel value.

**Reason:** A performance and the concert night containing it are different statistical units, but date/venue resemblance is not a safe durable identity. A direct user relationship supplies the missing identity without merging records or weakening ownership.

**Consequence:** The grouped Next Concert ticket may show multiple supports and one headliner while preserving the established ticket silhouette and actions. Concert-night, spend, travel and visit metrics are event-level; artist appearances, ratings, setlists, genres and lineup roles remain performance-level. `eventGroupId` is additive and backward compatible, requires no migration or provider call, and must be preserved by provider and concurrency write paths.

### v157 derives obvious attended shared events without rewriting records

**Decision:** Keep the v156 optional persisted `eventGroupId` model for existing user-established relationships, but make the normal v157 path a conservative read-time interpretation. Two or more otherwise ungrouped performances form one effective event only when every member is `attending: true`, the date is exactly equal, the venue matches under the existing conservative normalization, and each city is present/non-blank and normalizes to the same value. Missing city is always a non-match. `lineupRole`, date alone, venue alone, city alone, band/provider similarity and incomplete context never establish event identity.

The derived relationship is not persisted to the concert records and does not create a migration/backfill. Existing explicit groups remain authoritative rather than being silently expanded with matching ungrouped records. For backward compatibility, an existing explicit group is not invalidated merely because historical city data is blank or missing; it fails closed only when known city values disagree, while automatic inference still requires every city to be present and matching. Within a valid effective event, Support performances sort before Headliners only in the slots occupied by that event; same-role order remains stable and unrelated chronological positions do not move.

**Reason:** Obvious same-night performances already contain enough context to avoid a permanent manual relationship CTA, while persisting generated relationship IDs across the historical dataset would add unnecessary write/migration risk. Requiring non-empty city for automatic inference fixes the blank-city false-positive path without weakening user-established v156 identity.

**Consequence:** Event-level calculations and grouped Next Concert consume the same central effective-event model, so concert nights, tickets/cost and travel deduplicate consistently while ratings, notes, setlists, band history and lineup roles remain performance-level. Normal concert cards expose no permanent `Link same event` control. Provider/concurrency writes continue preserving stored `eventGroupId`, `lineupRole`, stable IDs, user-owned values and unknown future fields; automatic grouping itself writes nothing.