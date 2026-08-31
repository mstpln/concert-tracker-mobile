# LiveVault Decisions

This continuity file was compacted on 2026-08-30 for the canonical identity project. Earlier durable decisions and rationale remain recoverable in Git history. The active contracts below supersede older wording where they conflict.

## Repository, safety and release control

### GitHub main is authoritative

**Decision:** Treat merged `main`, not chat memory, stale uploads or old branch copies, as the source of truth.

**Consequence:** Before changes, read `AGENTS.md`, current state/decisions/build-state, relevant current code, recent PRs and current app/service-worker versions.

### Merge and production actions require separate explicit authorization

**Decision:** Automated QA uses synthetic data and the fake backend. Merge requires the explicit phrase `Merge it`. Deployment, production workflows/provider execution, production smoke and production-data writes each require the appropriate separate authorization.

**Consequence:** A branch, green CI, mergeability or a merged code build never authorizes a production migration. Production smoke remains manual-only and read-only.

### Stable identity, user ownership, provider ownership and unknown fields are preserved

**Decision:** Stable BANDMARKR IDs, user-owned fields, user-reviewed decisions, provider-owned state, provenance and unknown future fields survive enrichment, canonicalization and later migration.

**Consequence:** Ambiguity fails closed. Existing writes use latest-state optimistic concurrency. A provider observation cannot overwrite user-owned data merely because it is newer.

## Canonical venue identity — v174 foundation

### Rich v174 identity remains additive over established v164 semantics

**Decision:** Established v164 venue resolution and physical-venue grouping remain the base. Richer v174 identity may add fail-closed fallback resolution or merge established groups when every member resolves unambiguously to the same canonical venue, but it must never split a physical-venue group already established by v164.

**Consequence:** Placeholder and unresolved venues remain fail-closed. Historical names, locations, provider identities and sub-locations can add evidence without replacing mature v164 matching/grouping behavior.

### Venue identity follows meaningful venue continuity, not every room/building/address

**Decision:** A BANDMARKR venue is the meaningful named venue identity a person would say they visited. A rename, relocation, demolition/rebuild or substantial renovation remains one venue when continuity is explicitly established.

**Consequence:** Canonical venue records may carry current name/location plus historical names and location history. Different addresses are not a generic split signal once continuity is proven, but address disagreement is also never a generic merge rule.

### Rooms, stages, halls and temporary/hospitality sub-locations are secondary detail

**Decision:** Internal rooms, halls, stages, theatres, loges, temporary structures and provider hospitality/premium/package locations do not create separate venues when they belong to a parent venue.

**Consequence:** Preserve their name/type as concert secondary-location detail. Venue list, Venue Detail, unique venue count and top-venue stats use the parent canonical venue.

### Independent venues and simultaneous branches stay separate

**Decision:** Separately named independently identifiable venues in one complex remain distinct even when they share an address/campus. Simultaneously operating branches under one brand are distinct; a genuine relocation/continuation is one venue.

**Consequence:** AFAS Dome/Lotto Arena and O2 Academy branch-style cases cannot merge from same address or brand alone.

### Historical venue facts and current canonical facts coexist

**Decision:** Historical/attended concerts preserve the venue name, city and address correct for the concert date. Venue Detail and the canonical venue record use the current/latest venue facts. Upcoming concerts display the current canonical venue name/location even when a provider still supplies an obsolete historical name.

**Consequence:** Canonical grouping must never rewrite historical concert facts. Obsolete provider wording remains source/alias evidence.

### Locality variants are evidence normalization, not independent identity proof

**Decision:** London/Greenwich, Milan/Milano, Newcastle/Newcastle upon Tyne and similar locality variants must not split an otherwise proven venue identity.

**Consequence:** Locality aliases can support a reviewed identity mapping but cannot by themselves merge unrelated venues.

### Festival venue semantics are explicit

**Decision:** A festival hosted at an established venue is event context, not a new venue. Where the festival itself is the meaningful named destination and no better independent venue identity exists, it may also be the canonical venue.

**Consequence:** Bramham Park/Leeds Festival and Wollaton Park/Splendour resolve to the established venue; a Roskilde-style exception may use the festival as venue identity while festival edition remains a separate event concept.

### Provider venue IDs are namespace-scoped observations

**Decision:** Provider venue IDs are evidence, not canonical BANDMARKR venue identity.

**Consequence:** One canonical venue may retain several current/historical/room-level provider venue IDs, always namespaced by provider.

## Canonical concert identity — v174 foundation

### Same band + canonical venue + calendar date is one BANDMARKR concert

**Decision:** Canonical concert identity is `bandId + canonicalVenueId + full calendar date`.

**Consequence:** Time, provider event/listing ID, room/stage, ticket URL, standard/VIP/premium/hotel/hospitality/suite/package classification and conflicting provider times cannot create a second concert when band/date/canonical venue are the same. The earlier time-based physical-performance split rule is superseded; there is no Blue Note double-show exception.

### Different date or genuinely different canonical venue may remain separate

**Decision:** Same band at the same venue on different calendar dates is separate. Same band/date at two genuinely different canonical venues may be separate.

**Consequence:** Multi-day festival appearances by the same artist remain separate concert records per day. A normal two-night residency remains two concerts.

### Provider observations are retained, not used as canonical IDs

**Decision:** Provider listing/event/venue IDs, titles, URLs, times, statuses, attraction IDs and offer classifications are namespace-scoped observations attached to canonical concert identity.

**Consequence:** Build 1 provides the identity primitive/read-time collapse only. Build 2 must make all automatic write paths accumulate these observations rather than append duplicate concerts.

### Duplicate reconciliation preserves one stable BANDMARKR ID and fails closed on user conflicts

**Decision:** Later persistent reconciliation keeps a safe existing concert ID, preserves merged-away IDs as legacy identity, unions provider observations/provenance/unknown fields and never invents a winner for contradictory user-owned fields.

**Consequence:** A genuine user-owned conflict blocks that individual merge. Provider-owned canonical fields may choose the strongest verified observation, not simply newest-wins.

## Canonical event identity and statistics — v174 foundation

### Existing explicit `eventGroupId` remains user-owned and authoritative

**Decision:** Valid explicit event relationships are not silently rewritten by the system-derived canonical event model.

**Consequence:** Canonical event identity is derived separately for read-time behavior/statistics.

### Ordinary event identity is canonical venue + date

**Decision:** In the absence of an explicit relationship or festival override, different bands at the same canonical venue on the same calendar date belong to one event.

**Consequence:** Room/stage wording, locality variants and historical aliases cannot split an ordinary event once they resolve to the same canonical venue. The older raw venue+city automatic grouping rule is superseded.

### One festival edition is one event across dates and venues

**Decision:** A reliably established festival edition may span multiple dates, stages and canonical venues. Each annual edition is separate.

**Consequence:** Festival edition identity overrides ordinary venue+date grouping. Non-festival consecutive-night shows remain separate events. Festival grouping must be evidence-backed, not inferred from vague name similarity.

### Event-level and performance-level metrics remain separate

**Decision:** Concert nights/events, ticket spend, travel, venue/city visits, festival attendance and event milestones are event-level. Artist appearances, ratings, setlists, genres and lineup roles remain performance-level.

**Consequence:** Support/headliner and festival tickets are counted once according to the existing pattern of placing the real cost on one performance and marking the others free. Festival travel is counted once: verified primary festival venue when one exists, otherwise shortest known festival-venue distance; local movement between festival venues is excluded.

## Concert lifecycle — locked for Build 2

### Reschedule keeps identity; attended historical dates are immutable

**Decision:** A confirmed upcoming reschedule keeps the same canonical concert identity and updates to the replacement date while preserving date/provider history. An attended historical concert date cannot be changed later by provider data.

### Cancelled concerts remain stored

**Decision:** Cancellation marks the existing concert cancelled; it does not automatically delete the record or user history.

### Postponed without a replacement date becomes DATE TBD

**Decision:** A postponed concert with no verified replacement date must not keep the old date as if still active. It remains the same concert with `POSTPONED · DATE TBD`, with the old schedule preserved only in lifecycle history.

### Replacement provider IDs attach through proven continuity

**Decision:** A replacement listing/provider ID for a confirmed postponed/rescheduled concert attaches to the existing canonical concert when continuity is proven.

## Migration and research — locked for Build 3/later production operation

### Research current ambiguity to closure before migration

**Decision:** Routine current duplicate/venue ambiguity should be independently researched and encoded as deterministic merge/separate/correct-provider/historical decisions rather than delegated to the user.

**Consequence:** Only genuinely contradictory/unresolvable cases remain blocked. Pair-specific evidence must not become unsafe generic matching rules.

### Research corrections are explicit, evidenced and replay-safe

**Decision:** The hashed research registry may correct fields on one exact venue source record and assign explicit concert records to a researched canonical venue. Venue corrections cannot mutate stable or legacy IDs, record before/after values plus evidence in the manifest, and become no-ops after their exact source ID has merged away. Concert venue assignments change only `canonicalVenueId`; raw provider venue, city, address and observation evidence remain intact.

**Consequence:** Known provider leakage and location ambiguity can be closed deterministically without weakening canonical matching or treating pair-specific research as a generic rule. Missing members/targets, ambiguous aliases and conflicting assignments block the plan. Replaying the same registry over migrated output must remain a no-op.

### Missing canonical venues are added only through researched definitions

**Decision:** When a real concert venue is absent from the venue export, the hashed registry may add one complete, valid stable venue record with an explicit rationale and supporting evidence before venue reconciliation. The addition is local migration output, not a production write or a generic discovery rule.

**Consequence:** Invalid or placeholder records, absent evidence, conflicting definitions and current/legacy ID collisions block. Replaying an unchanged addition against the migrated output is a no-op, and the addition remains visible in the migration manifest and venue-count reconciliation.

### Production migration is deterministic, hash-guarded, reversible and separately authorized

**Decision:** Build 3 produces read-only audit/research/migration tooling and local dry-run outputs only. Production migration starts later from a fresh authorized export with exact counts/SHA-256 hashes.

**Consequence:** Venue reconciliation precedes concert reconciliation, which precedes event/festival reconciliation. Legacy IDs/reverse mappings, untouched backups, merge manifests, before/after metrics, orphan checks and a no-op second run are mandatory before any separately authorized production write.

## Performance and storage contracts

### v166 indexed/cached venue navigation remains authoritative

**Decision:** Ordinary Discover/Concerts must not construct the full canonical venue directory. Venue resolution and Venue navigation remain indexed/cached.

**Consequence:** Any return to repeated concert × venue full scans is a hard regression blocker. Richer v174 identity evidence must be consumed by indexes/caches rather than scans.

### Prefer additive fields in existing JSON documents

**Decision:** Canonical venue/event metadata should be additive/backward-compatible in existing data documents unless a separate storage/API change is explicitly approved.

**Consequence:** Do not introduce a new production JSON file merely for model elegance.

## Other active contracts carried forward

- v173 bottom-navigation order remains `Music · Bands · Discover · Stats · Alerts`; stable `data-tab` route identities remain unchanged.
- Discover remains the visible identity over stable internal `concerts`, with v166 Concerts/Venues rendering and cache contracts preserved.
- Recommendation/listening provider ownership, private listening-history storage and provider caps/pacing/circuits/leases remain unchanged.
- `lineupRole` remains user-owned.
- Active Releases remain retired unless a new explicit build reintroduces them.
- PR #134 remains unrelated production-inert listening backfill tooling.
