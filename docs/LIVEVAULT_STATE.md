# LiveVault Current State

This continuity file was refreshed on 2026-09-01 after profiling the remaining production-shaped navigation regression on merged v177. Earlier detail remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged `main` before this correction is v177 at `84e544ad09d0eee7c150e3ed097f57c8bc35e809` (PR #201). Builds 1-3 of the canonical identity project are merged, the v176 migration-tool stabilization PRs #194-#199 are merged, and the production canonical migration has been completed and independently verified.

The active unreleased correction is **v178 — Global Navigation Performance** on branch `fix/global-navigation-performance-v178`. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v178`. This build does not change production data or canonical identity rules; it removes duplicated legacy full scans, reuses the v166 indexed grouping path for statistics and makes cache rebuilding depend on actual venue-record changes.

## Canonical identity implementation

### v174 foundation

Canonical venue identity supports current/historical names and locations, namespace-scoped provider identities, legacy venue IDs and parent/sub-location semantics. Rooms, halls, stages, theatres, temporary structures and hospitality sub-locations resolve to their parent venue when explicitly represented. Independent venues in one complex and simultaneous brand branches remain distinct. Historical concerts preserve date-correct raw venue facts while current/upcoming presentation can use current canonical venue facts.

Canonical concert identity is `bandId + canonical venue identity + full calendar date`. Time, provider event/listing ID, room/stage and ticket package/offer do not split a concert. Canonical event identity preserves valid explicit `eventGroupId`; otherwise ordinary events group by canonical venue + date, with evidence-backed festival-edition overrides.

The v166 performance contract remains mandatory: ordinary Discover/Concerts must not build the full venue directory; venue identity data is indexed/cached; Venues builds once and Venue Detail reuses that group.

### v175 ingestion and lifecycle

Automatic Ticketmaster and Tavily/Groq observations reconcile through shared canonical identity before persistence. A matching observation preserves the stable BANDMARKR concert ID and user-owned/unknown fields while namespace-scoped provider observations accumulate additively. Latest-state ETag reconciliation protects newer user edits.

Cancellation retains the record and history. Confirmed upcoming reschedules retain stable identity and preserve former-date evidence. Postponed without a verified replacement date becomes `POSTPONED · DATE TBD` with no stale active date. Attended historical dates are immutable. Ambiguous continuity fails closed.

### v176 audit/research/migration tooling

Build 3 provides deterministic local audit and hash-guarded dry-run migration tooling using explicit local inputs. The research registry supports venue additions, venue merge/distinct decisions, exact venue corrections, concert-to-venue assignments, concert merge/distinct decisions and festival editions. Contradictions and incomplete decisions block rather than guess.

The planner preserves stable/user-rich IDs, transitive legacy mappings, provider/source/lifecycle evidence, explicit false values, user-owned fields and unknown future fields. Plan mode requires exact source/decision SHA-256 guards and produces untouched backups, migrated files, forward/reverse mappings, merge/report/rollback artifacts and no-op second-pass validation.

Real-data preparation produced focused stabilization PRs #194-#199 for provider metadata, deterministic research resolution, missing venue additions, provider observation replay and unnamespaced/source evidence preservation. Final exact-head QA passed before each merge.

## Canonical production migration — completed and verified

Fresh source baseline:

- `bands_old.json`: 379 records, SHA-256 `a15e57d86388d7ff731f89faecd07468b4d71c7bc1323bf272beb55d947b1485`
- `venues_old.json`: 530 records, SHA-256 `a79896aad829e93d5bcd2852adb8075cac3bd71f5682a418840b50fa58aa59d7`
- `concerts_old.json`: 3,331 records, SHA-256 `21eba3162d0811ca9e36ca651b3ba22567dca6367460bde31cb318afa0b84d47`
- final decision registry: SHA-256 `09d22ab577756b0bfceece1da41e5181122c7312c4e9c6c764de0277037e8d3c`

`bands.json` was reference-only and was not changed.

Approved production outputs:

- `concerts.json`: SHA-256 `d8514d1beaf710867f767be9eda379e8c991e541432c23caa2e6cdf758f231bf`
- `venues.json`: SHA-256 `06308d511deadfccf12b86b55441ae00012c49771d1ac597af6c069ba2cc3918`

Final reconciliation:

- Venues: 530 -> 540 (`+26` researched additions, `-16` duplicates)
- Concerts: 3,331 -> 2,989 (`-342` duplicate rows across 273 merge groups)
- Events: 2,909 -> 2,768 (`-141` canonical event consolidations)
- Festivals: 0 -> 0
- Attended: 76 -> 76; all historical dates unchanged
- Ticket total: 14,671 -> 14,671
- Ticket quantity: 58 -> 58
- Provider observations: 3,206, including 919 `provider: "source"` observations

All 530 source venue IDs and 3,331 source concert IDs remain traceable. Independent validation found zero blockers, unresolved identities, orphan references, duplicate stable IDs, unknown-field loss, evidence loss or second-pass mutations.

The only lineup-role reconciliation was `interpol-2026-11-10-k-benhavn-s` -> `interpol-2026-11-10-copenhagen`, `headliner` -> `support`; independent review confirmed the surviving attended/user-owned record already carried `support`, while Bloc Party remains the headliner for the Royal Arena event.

After manual R2 upload, the exact production objects were downloaded again and verified byte-for-byte against the approved hashes above. Post-write verification also confirmed 2,989 concerts, 540 venues, zero orphan venue/band references, zero duplicate IDs, zero legacy ownership collisions, 76 attended concerts, ticket total 14,671 and ticket quantity 58.

## v177 production venue-navigation regression and correction

After the migrated production datasets were placed in R2, the live app exposed a severe regression when opening Discover > Venues: loading could stall indefinitely and desktop could become unresponsive.

Diagnosis showed that the v166 venue-directory fast path still attempted to resolve migrated rows primarily from raw venue/city/address evidence. The migration intentionally preserves historical/provider wording, and 1,017 migrated concerts carry authoritative `canonicalVenueId` values; some of those rows can have stale/different raw wording or empty raw locality fields. The indexed metadata lookup did not use `canonicalVenueId`, so those rows could fall through to the richer v174 resolver during a full venue-directory build, recreating expensive work at production scale.

v177 corrects the hot path by indexing current and uniquely owned legacy venue IDs once and resolving `canonicalVenueId` in O(1) before text/evidence fallback. Legacy IDs remain fail-closed if ownership is ambiguous. Existing raw-text, alias, historical, placeholder and richer-v174 fallbacks are retained for records without a canonical stable ID.

A new synthetic Playwright regression uses 2,989 concerts and 540 venues with migration-shaped data, including canonical IDs paired with intentionally different raw provider wording and missing raw city/country values. It verifies direct canonical-ID lookup, Discover > Venues rendering, Venue Detail opening, one-time index/group construction and timing gates on both configured Chromium projects. Production R2 is not used by automated QA.

No production JSON, provider workflow, Worker configuration, secret or migration artifact is changed by v177.

## v178 broad performance diagnosis and correction

Production-shaped profiling used 379 synthetic bands, 540 rich venue records and 2,989 mixed concert rows (1,017 with canonical IDs and 1,972 exercising current-name, alias, historical-name, sub-location, missing-locality and recoverable-placeholder fallbacks). The merged v177 baseline measured approximately 19.8 seconds for the first Venues render, 3.6 seconds for concert statistics, 5.5 seconds for Music and 5.7 seconds for startup.

The wrapper chain was finite, not recursive, but two closure boundaries bypassed later performance layers. v174 fallback first invoked the captured v158 full-record scan before using the rich resolver, and the v158 concert-capacity decorator permanently captured that same scan and ran it for every Music card. Statistics also built canonical venue groups through both the legacy v158 path and v174. Finally, each refresh invalidated every venue index even when `venues.json` was byte-equivalent.

v178 routes rich fallback directly to the v174 indexed resolver after the v166 lookup misses, routes the v158 card decorator through the current indexed metadata API, and delegates canonical statistics grouping to the indexed v166 implementation. Venue records now expose a monotonic revision that changes only when normalized content changes; lookup, canonical and navigation indexes rebuild lazily against that revision. The normal Concerts view remains lazy and does not build venue groups.

The same local profile after correction measured approximately 160 ms for first Venues, 27 ms for concert statistics, 147 ms for Music and 259 ms for startup. Cached Venues, back navigation and Venue Detail remained single-digit milliseconds; byte-equivalent refresh data caused zero index rebuilds. Full-array cache-key serialization and 540-card DOM construction were measured but were not material bottlenecks, so no virtualization was introduced. Service-worker inspection found the shell complete, versions synchronized and old caches removed on activation; no mixed-runtime defect was found.

Focused synthetic browser coverage enforces mixed canonical/fallback resolution, lazy ordinary Concerts behavior, one-time group/index construction, equivalent-data cache reuse, changed-data rebuilding, Venue Detail/back/second-detail reuse, finite rich fallback, historical/alias/sub-location behavior and desktop/mobile timing gates. No production data or service is used.

## Active safety and ownership boundaries

- Stable BANDMARKR IDs, user-owned fields, reviewed decisions, provider ownership/provenance and unknown future fields must be preserved.
- Existing valid `eventGroupId` remains user-owned/authoritative; canonical event identity is derived separately.
- Automated browser QA uses synthetic fixtures and the QA fake backend only; production R2 and live providers are forbidden.
- Production provider calls, production workflows, deployments, production smoke and production-data changes require separate explicit authorization. `Merge it` authorizes merge only.
- Production smoke is manual-only/read-only.
- Existing optimistic-concurrency/latest-state safeguards remain active.
- v166 indexed/cached venue navigation remains a hard performance contract.

## Project sequence and current next step

1. Build 1 / v174 — canonical venue/concert/event foundation: merged.
2. Build 2 / v175 — canonical ingestion/lifecycle: merged.
3. Build 3 / v176 — audit/research/migration tooling: merged.
4. Production migration — independently validated, written to R2 and read-back verified: complete.
5. v177 — production-shaped Venue navigation compatibility/performance correction: merged as PR #201.
6. v178 — global navigation profiling and performance correction: in progress, no production action.

The earlier docs-only closeout PR #200 was opened before the production navigation regression was reported and should not be merged as the final project state. v178 supersedes that closeout state. After v178 exact-head QA is green and the user explicitly authorizes merge, a later fresh production `concerts.json` / `venues.json` read-back can be exhaustively QA-checked if requested. The dedicated production smoke workflow remains separately authorized.

## Backlog hygiene

PR #134 remains intentionally open as unrelated production-inert listening backfill tooling. Cloudflare Worker CORS-origin hardening, patch-layer consolidation and unrelated Ticketmaster label hardening remain outside this correction.
