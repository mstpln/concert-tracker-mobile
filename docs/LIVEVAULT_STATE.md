# LiveVault Current State

This continuity file was refreshed on 2026-09-01 after completion and verification of the canonical identity production migration. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current authoritative `main` is **v176** at merge commit `62d259086e7f23d95cde5ba34c4f252fdcc44346` after PR #199. Build 1 / v174, Build 2 / v175 and Build 3 / v176 are merged and complete, and the later v176 migration-tool stabilization PRs #194-#199 are also merged.

`APP_VERSION` and `CACHE_NAME_LITERAL` remain synchronized at `v176`. No additional version bump was required for the focused unreleased v176 migration-tool corrections or the later production data operation.

## Canonical identity implementation status

### v174 canonical identity foundation

The shared identity layer extends the existing v158/v166 architecture rather than replacing its safety/performance model. Canonical venue identity supports additive current/historical names, location history, namespace-scoped provider venue identities, parent/sub-location mappings and legacy venue IDs. Rooms, halls, stages, theatres, temporary structures and hospitality/loge-style sub-locations resolve to their parent venue when explicitly represented. Separately named venues in one complex and simultaneous brand branches remain distinct; address conflicts fail closed.

Historical concert records keep their date-correct venue name/city/address. Current venue metadata and Venue Detail use the latest canonical venue facts. Upcoming concert read views may display current canonical venue facts while retaining stored/provider wording as source evidence.

Canonical concert identity is **bandId + canonical venue identity + full calendar date**. Time, provider event/listing ID, room/stage and ticket offer/package type do not create another canonical concert. Canonical event identity keeps valid explicit `eventGroupId` relationships authoritative; otherwise ordinary events group by **canonical venue + date**, with evidence-backed festival-edition overrides.

The v166 navigation architecture remains a hard contract: ordinary Discover/Concerts must not build the complete venue directory; canonical venue metadata is indexed/cached; Venues builds the canonical directory once and reuses it for detail/return navigation.

### v175 canonical ingestion and lifecycle

Automatic Ticketmaster and Tavily/Groq concert observations are routed through one shared canonical write-time reconciliation layer instead of directly appending provider rows.

The reconciliation layer preserves a stable BANDMARKR concert ID when an incoming provider observation belongs to an existing canonical concert, including manually-added records. Provider event/listing/venue/attraction IDs, titles, URLs, times, statuses, offer classifications, source details and related-event evidence accumulate as namespace-scoped provider observations. Replay is idempotent.

Lifecycle handling follows the locked decisions: cancellation retains the record and user history; confirmed upcoming reschedules retain the BANDMARKR ID and preserve former-date history; postponed concerts without a verified replacement date become `POSTPONED · DATE TBD`; replacement provider IDs require proven continuity; attended historical dates are immutable; ambiguous identity or venue continuity fails closed.

The research pipeline uses the canonical venue index and latest-state ETag reconciliation so a stale provider run cannot wipe newer user edits. Minimal lifecycle UI renders cancelled and postponed/TBD states safely.

### v176 canonical audit, research closure and migration tooling

Build 3 provides deterministic local audit and dry-run migration tooling around a fresh exported dataset. The tooling does not itself fetch production data or call providers.

The research decision registry supports evidence-backed venue additions, venue merge/separate decisions, field-level venue corrections, concert-to-canonical-venue assignments, explicit concert merge/separate decisions and festival editions. Contradictory, incomplete or malformed decisions block rather than guessing.

The migration planner preserves stable/user-rich BANDMARKR IDs, transitive legacy mappings, provider/source/history evidence, explicit false values, user-owned fields and unknown future fields. Attended historical dates are protected. Provider evidence remains additive and namespace-owned, including article/search evidence without provider IDs and distinct meaningful observation timestamps.

Plan mode requires exact byte-level SHA-256 guards for venue/concert source files and the decision registry when supplied. Outputs are local-only and include untouched source backups, migrated outputs, forward/reverse ID maps, merge manifest, migration report and rollback metadata. A second pass over migrated output with the same decisions must be a no-op.

### v176 stabilization after real-data dry run

Fresh production-shaped dry runs exposed several migration-tool edge cases that were corrected without changing the v176 product semantics:

- PR #194: provider discovery metadata reconciliation (`foundAt` / `isNew`)
- PR #195: deterministic venue corrections and concert venue assignments
- PR #196: evidence-backed missing canonical venue additions
- PR #197: provider observation replay idempotency
- PR #198: preservation of unnamespaced source/article evidence
- PR #199: final source-evidence stabilization for timestamps and observation-scoped metadata

The final consolidated exact-head PR QA for #199 passed before merge. No further safely diagnosable migration-tooling defects remained after the completed adversarial pass.

## Canonical identity production migration — completed and verified

The production migration was performed only after a fresh production export, exact source hashes, research closure, deterministic dry-run generation, independent validation and explicit production-data authorization.

Fresh source baseline used for the migration:

- `bands_old.json`: 379 records, SHA-256 `a15e57d86388d7ff731f89faecd07468b4d71c7bc1323bf272beb55d947b1485`
- `venues_old.json`: 530 records, SHA-256 `a79896aad829e93d5bcd2852adb8075cac3bd71f5682a418840b50fa58aa59d7`
- `concerts_old.json`: 3,331 records, SHA-256 `21eba3162d0811ca9e36ca651b3ba22567dca6367460bde31cb318afa0b84d47`

`bands.json` was reference-only and was not changed by the canonical venue/concert migration.

Final validated decision registry SHA-256:

- `09d22ab577756b0bfceece1da41e5181122c7312c4e9c6c764de0277037e8d3c`

Final approved production outputs:

- `concerts.json`: SHA-256 `d8514d1beaf710867f767be9eda379e8c991e541432c23caa2e6cdf758f231bf`
- `venues.json`: SHA-256 `06308d511deadfccf12b86b55441ae00012c49771d1ac597af6c069ba2cc3918`

Final reconciliation:

- Venues: **530 -> 540** (`+26` researched additions, `-16` duplicate venue records)
- Concerts: **3,331 -> 2,989** (`-342` canonical duplicate records across 273 merge groups)
- Events: **2,909 -> 2,768** (`-141` groups consolidated by canonical event identity)
- Festivals: **0 -> 0**
- Attended concerts: **76 -> 76**, with all historical dates unchanged
- Ticket total: **14,671 -> 14,671**
- Ticket quantity total: **58 -> 58**

All 530 source venue IDs and all 3,331 source concert IDs remain traceable through surviving IDs and legacy/reverse mappings. The independent validation found zero unresolved identities, blockers, orphan references, duplicate stable IDs or unknown-field loss. The second migration pass produced byte-identical venue and concert outputs.

The sole lineup-role reconciliation was `interpol-2026-11-10-k-benhavn-s` -> `interpol-2026-11-10-copenhagen`, `headliner` -> `support`. Independent review confirmed the surviving attended/user-owned record already carried the `support` role and that Bloc Party remained the headliner for the same Royal Arena event.

Provider-evidence preservation checks passed with **3,206** total provider observations, including **919** `provider: "source"` observations, with no malformed observations, hybridization or cross-provider leakage.

### Production R2 verification

After the approved `concerts.json` and `venues.json` were uploaded to production R2, the exact production objects were downloaded again and independently verified.

The re-downloaded R2 objects were byte-for-byte identical to the approved migration package:

- production `concerts.json`: `d8514d1beaf710867f767be9eda379e8c991e541432c23caa2e6cdf758f231bf`
- production `venues.json`: `06308d511deadfccf12b86b55441ae00012c49771d1ac597af6c069ba2cc3918`

Post-write verification also confirmed 2,989 concerts, 540 venues, zero orphan canonical venue references, zero orphan band references, zero duplicate IDs, zero legacy ownership collisions, 76 attended concerts with valid dates, ticket total 14,671, ticket quantity 58, 3,206 provider observations and 919 source observations. No corrective write was required.

## QA and performance status

The canonical identity implementation has synthetic unit/regression coverage for venue aliases, locality variants, historical rename/relocation, parent rooms/stages, independent same-complex venues, provider IDs, time/provider/offer-insensitive concert identity, event/festival grouping, ticket/travel semantics, lifecycle behavior, user-field conflict safety and replay idempotency.

Desktop and mobile Chromium QA are green on the final v176 code head. The production-scale synthetic browser fixture uses approximately 3,300 concerts and 530 venues and preserves the v166 indexed/cache navigation contract: ordinary Concerts does not build the complete venue directory, canonical/venue indexes are built once, and navigation/detail timing gates pass.

The dedicated production smoke workflow remains manual-only and read-only. It has not been required for the data migration verification itself. Future production verification may instead combine normal green workflow QA with a fresh read-back of production `concerts.json` / `venues.json` for exhaustive data QA, as separately requested.

## Active safety and ownership boundaries

- Stable BANDMARKR IDs, user-owned fields, reviewed decisions, provider ownership and unknown future fields must be preserved.
- Existing valid `eventGroupId` relationships remain user-owned/authoritative; system canonical event identity is derived separately.
- Automated browser QA uses only synthetic fixtures and the QA fake backend; live providers and production R2 are forbidden in automated QA.
- Production provider calls, production workflows, deployments, production smoke and production data changes require their specific explicit authorization. `Merge it` authorizes merge only.
- Production smoke is manual-only and read-only.
- Existing JSON writes keep optimistic concurrency/latest-state safeguards.
- v166 indexed/cached venue navigation is a performance contract and regression is a blocker.

## Canonical identity project status

1. **Build 1 / v174:** canonical venue, concert and event identity foundation; read-time/stat integration; focused synthetic QA. **Merged and complete.**
2. **Build 2 / v175:** automatic discovery/write paths use canonical identity; provider observations accumulate; lifecycle rules and latest-state reconciliation are implemented. **Merged and complete.**
3. **Build 3 / v176:** exhaustive local audit, research decision registry, deterministic/hash-guarded dry-run migration planner, legacy/reverse ID mappings, rollback artifacts, invariant/stat reports and idempotency validation. **Merged and complete.**
4. **Production migration:** fresh production data was audited, researched, migrated, independently validated, written to R2 with explicit authorization and verified by exact production read-back hashes. **Complete.**

## Remaining close-out / future verification

No further canonical identity code or data migration work is currently required.

The next normal workflow may be allowed to run as part of subsequent repository work. After that, if a fresh production-data QA is desired, download the then-current production `concerts.json` and `venues.json` from R2 and compare them against the canonical identity invariants. The dedicated production smoke workflow remains separately authorized and optional unless specifically requested.

## Backlog hygiene

PR #134 remains intentionally open as unrelated production-inert listening backfill tooling. Cloudflare Worker CORS-origin hardening, patch-layer consolidation and unrelated Ticketmaster label hardening remain outside the canonical identity project.
