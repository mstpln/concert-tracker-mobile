# LiveVault Decisions

This continuity file was compacted on 2026-08-24. Earlier durable decisions and full rationale remain recoverable in Git history. The active contracts below must be preserved by future work.

## Repository, safety and release control

### GitHub main is authoritative

**Decision:** Treat merged `main`, not chat memory or stale local copies, as the source of truth.

**Consequence:** Before changing anything, read `AGENTS.md`, current state/decisions/build-state, relevant current code, recent PRs and current app/service-worker versions.

### Merge and production actions require explicit authorization

**Decision:** Automated QA uses synthetic data and the fake backend. Merge requires the explicit phrase `Merge it`. Production workflows, provider execution, deployments and production-data writes require explicit authorization for that action.

**Consequence:** A branch, version bump, green CI or mergeability never authorizes merge or production execution. Production smoke remains manual-only and read-only.

### Stable identity, user ownership and unknown fields are preserved

**Decision:** Stable IDs, user-owned fields, user-reviewed decisions and unknown future fields survive enrichment, cleanup and reconciliation.

**Consequence:** Ambiguity fails closed. Additive/provider-owned state is preferred. Existing JSON writes use latest-state optimistic concurrency and bounded reread/reconciliation.

### Credentials remain least-privilege and separated by role

**Decision:** Browser, automation, data-maintenance and smoke credentials remain separate.

**Consequence:** Ordinary automation cannot gain maintenance privileges or raw private-listening access merely because another workflow or trusted-local process has them.

## Listening and provider ownership

### Private R2 is the durable listening-history source of truth

**Decision:** Complete sanitized listening history remains private R2 data with IndexedDB as the device working copy; source observations are immutable.

**Consequence:** Derived identity/artwork layers stay separate and provider failures never invalidate a listen or change listening statistics.

### Listening identity and artwork remain provider-neutral where possible

**Decision:** Reuse deterministic local/catalogue evidence and provider-neutral identity before new Spotify work. Spotify metadata remains Spotify-owned; provider-neutral evidence is not written into Spotify-owned fields.

**Consequence:** Ambiguous identity stays unresolved/reviewed rather than guessed. Missing artist images and album artwork use exact trusted identity only.

### Listening aliases are local attribution only

**Decision:** Optional `listeningAliases` extend local band-name attribution only when one stable BANDMARKR band uniquely owns the normalized alias. Explicit known stable band IDs remain authoritative.

**Consequence:** Aliases do not create or replace Spotify/MusicBrainz identity, rewrite source observations or weaken ambiguity rules.

### Scheduled listening artwork remains trusted-local

**Decision:** Automatic Spotify listening-artwork maintenance stays on the trusted local host rather than moving private listening reads into GitHub Actions.

**Consequence:** Installing/running that scheduler, reading production listening data, calling Spotify and writing production listening metadata/usage remain separately authorized production actions.

### Provider calls remain bounded

**Decision:** UsageTracker caps/pacing, the persisted Spotify circuit and cross-scheduler lease remain authoritative.

**Consequence:** No provider flow may bypass quota, pacing, lease or circuit protections to make a test or maintenance run succeed.

### Active Releases remain retired

**Decision:** Releases is not an active feed/alert surface; Alerts is concert-only.

**Consequence:** Reintroducing release alerts or scheduled release discovery requires a new explicit build/decision.

### Update Activity uses safe aggregate reporting

**Decision:** Settings Update Activity uses additive per-flow status/timestamp/result reporting with truthful aggregate counts and normalized safe failure summaries. Device-owned ListenBrainz stores only its latest processed/added/skipped aggregate in browser-local connection state.

**Consequence:** Missing metrics stay missing rather than invented zeroes, and raw provider bodies, stacks, secrets, private URLs, ticket data and listening-event details are never displayed.

## Ticketmaster identity and performance ownership

### Ticketmaster concert admission requires trusted provider identity

**Decision:** Automatic Ticketmaster concert fetching may only use a `confirmed` or `manual_confirmed` Ticketmaster attraction ID for the followed BANDMARKR artist. Keyword/name containment may discover an identity candidate but has no authority to create concert records.

**Consequence:** Bands without trusted Ticketmaster attraction identity skip automatic event admission. Collision-prone identity searches fail to review rather than guessing. Existing manual confirmations remain authoritative.

### Ticketmaster ticket offers are not physical-performance identity

**Decision:** A Ticketmaster event/listing ID identifies a provider offer, not necessarily a unique real-world concert. Standard and VIP/package/premium/lounge/sound-check listings for the same followed artist, date, physical venue and compatible start time represent one BANDMARKR physical performance when evidence is strong.

**Consequence:** Preserve one canonical provider event plus alternate offer IDs/URLs. Automatic consolidation requires direct evidence from every alternate to exactly one standard listing; transitive bridges do not collapse. Materially different same-day start times remain separate. Missing material evidence, multiple matches and uncertain listings hold for review. Provider calls remain counted, capped and paced.

### Ticketmaster venue and lifecycle evidence fails closed

**Decision:** Preserve Ticketmaster venue ID, event title, provider source and lifecycle status. Missing embedded venue names may use one bounded/cached provider-venue lookup. Canceled, postponed and rescheduled candidates are not admitted as ordinary new upcoming concerts.

**Consequence:** Unresolved venue identity is held instead of manufacturing `Unknown venue`; offsale alone is not destructive evidence; lifecycle changes do not authorize deleting user-owned concert history.

### Ticketmaster cleanup is audit-first and separately authorized

**Decision:** Existing Ticketmaster cleanup starts with a local read-only audit using the same identity/performance rules. Production mutation is a distinct action requiring explicit user authorization after exact dry-run review.

**Consequence:** Automatic cleanup requires current trusted identity, one safe canonical, direct same-performance proof for every removal, complete alternate provenance, valid stable IDs/roles, safe lifecycle state and no protected/unknown data loss. Ambiguity stays manual.

### Ticketmaster venue quality is monotonic

**Decision:** A provider placeholder venue may never overwrite a genuine venue already stored for the same canonical concert, while valid provider-owned fields may still refresh.

**Consequence:** Venue application remains field-aware and must be re-evaluated against the latest reread record before persistence.

## Concert/event ownership and statistics

### `lineupRole` is a user-owned performance field

**Decision:** A concert may store only `headliner` or `support`. Missing legacy values are interpreted as headliner without a production-wide migration.

**Consequence:** Provider refreshes may not replace a stored role. Performance-role statistics count each attended performance exactly once.

### Shared events are conservative and non-destructive

**Decision:** Existing valid `eventGroupId` relationships remain authoritative. Read-time effective shared events may be inferred only from conservative same-date, venue and non-empty city context. Automatic grouping writes nothing.

**Consequence:** Uncertain context never establishes persistent event identity. Unrelated records keep independent stable IDs.

### Ticket price is a performance contribution inside grouped events

**Decision:** For a valid effective event, every non-negative numeric performance `ticketPrice` contributes to event unit price and spend. Different performance prices are not reduced to a minimum.

**Consequence:** Intentionally split contributions remain additive. Ticket-quantity and travel-distance conflicts retain conservative handling.

### Event-level and performance-level statistics remain separate

**Decision:** Concert nights, spend, travel, venue/city visits, event milestones and ticket extremes are event-level. Artist appearances, ratings, setlists, genres and lineup roles are performance-level.

**Consequence:** Future changes must preserve that distinction unless explicitly redesigned.

## Venue metadata ownership and research

### Venue facts belong to reusable `venues.json` records

**Decision:** Capacity, full address, official HTTPS website, short factual description and internal provenance belong to venue-level records, not copied concert fields.

**Consequence:** Concert attendance, notes, tickets, ratings, roles, stable IDs and unknown fields are never rewritten by venue metadata work. Missing metadata renders nothing rather than a guessed placeholder.

### Venue research evidence remains internal and conservative

**Decision:** `maxCapacity` means the highest reliably documented maximum across normal concert/event configurations. Official venue URLs must be genuine venue/operator sites; obvious ticket sellers, social profiles, tourism pages, directories, aggregators and event listings are rejected.

**Consequence:** Research sources/timestamps are not rendered in normal UI. Failed/evidence-less research does not create a successful `researchedAt` timestamp.

### Scheduled venue enrichment is bounded, attended-only and fill-only

**Decision:** Reuse the twice-monthly focused Tavily/Groq schedule for attended venues within BANDMARKR's Europe scope, capped at 10 unique venues per run. Unknown/out-of-scope country values fail closed.

**Consequence:** Existing display facts are not silently replaced. Conflicts preserve stored facts and move/keep records at `review_needed`. `concerts.json` is read-only for this lane; `venues.json` writes require the data-maintenance credential and conditional ETag behavior.

### Venue identity cleanup must fail closed

**Decision:** Safe country/city aliases may canonicalize identity, but different physical venues must never be merged merely because they share an address, city or complex. Different-name consolidation requires pair-specific review evidence that identifies the counterpart venue; negated/uncertain/relocation language never authorizes consolidation.

**Reason:** AFAS Dome and Lotto Arena Antwerpen are distinct arenas sharing an address.

**Consequence:** Known address/country conflicts and conflicting shared unknown future fields block automatic consolidation. Confirmed aliases preserve one stable primary venue ID plus legacy IDs/identity aliases.

### Venue directory and venue statistics use canonical physical identity

**Decision:** The Venues directory, Venue Detail histories and venue-related statistics interpret concert venue references through the canonical `venues.json` identity at read time. Raw spelling, diacritic, safe city/country aliases and reviewed identity aliases must not create duplicate venue cards or split one physical venue's visit counts.

**Reason:** Production showed duplicate cards such as Royal Arena (`Copenhagen` / `København S`) and Pumpehuset (`Copenhagen` / `København V`), plus many additional normalized duplicates. Raw `concert.venue + concert.city` is presentation/source data, not sufficient physical-venue identity.

**Consequence:** A known canonical `venueId` is the grouping key. Records without canonical metadata may use conservative normalized fallback identity, but conflicting known physical evidence must stay separate. The interpretation is read-only and does not rewrite concert IDs, venue strings, `eventGroupId` or user-owned/unknown fields.

### Placeholder venues never become directory entities

**Decision:** `Unknown venue`, Unknown, TBA, TBD and equivalent placeholder names do not render as venue cards. A placeholder concert may be attributed to a real venue only when existing stored venue metadata plus location/address evidence identifies exactly one canonical physical venue.

**Consequence:** Exact/strong address evidence can recover previously researched placeholders such as Nordichallen, but a tie between multiple legitimate venues fails closed and the placeholder remains omitted rather than guessed. Shared-address complexes therefore cannot be collapsed through placeholder recovery.

### Production venue cleanup baseline

**Decision:** The 2026-08-24 production cleanup replaced the previous 1,208-record venue dataset with the audited 530-record candidate after explicit authorization.

**Consequence:** The cleaned baseline has no duplicate `venueId` values, placeholder venue records, blocked/non-official display URLs, unresolved/no-evidence research timestamps or structural validation failures in the audited candidate. Production upload confirmation remains the operational source of truth.

## Active UI contracts

### Next Concert ticket contract

**Decision:** Preserve the established v147/v148 normal-day ticket geometry/chrome and v140 concert-day `Get directions` / `Open tickets` behavior. v162 adds only corrected capacity treatment and responsive spacing.

**Consequence:** Unrelated work must not move ticket geometry, countdown/date layout, ticket ownership or concert-day action paths without explicit redesign.

### Start/Stats navigation identities

**Decision:** The Start root is visibly `MYMUSIC`; the first bottom-navigation item is Music with the approved five-bar equalizer. Stats uses the approved angular rising-line glyph.

**Consequence:** Internal stable routes/IDs remain unchanged unless explicitly migrated.

### Sweden filter is exact and view-only

**Decision:** ConcertDates and Band Detail use Nearby -> SE -> EU; SE means canonical country exactly Sweden.

**Consequence:** SE never infers country from venue/city/address/coordinates/distance and never writes concert data.

### Listening genre/overview and My Bands search remain presentation-only

**Decision:** Selected-year genre detail uses stored BANDMARKR genre attribution; yearly Overview changes density only and keeps all underlying points/bars. My Bands search is transient and composes with existing filters.

**Consequence:** These UI features do not change stored listening/concert identity or persistence semantics.

## Deferred maintenance

PR #134 remains intentionally open as production-inert NB2 tooling. Cloudflare Worker CORS-origin hardening and versioned CSS/JS patch-layer consolidation remain deferred maintenance. Ticketmaster offer-label hardening remains separate from v164.
