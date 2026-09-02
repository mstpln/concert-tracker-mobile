# LiveVault Current State

This continuity file was refreshed on 2026-09-02 after v179 merged and a post-merge QA found one remaining lifecycle ownership edge case. Earlier detail remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged `main` is **v179 — provider identity/lifecycle conflict safeguard** at merge commit `67d80ff127fde7ec928bc9902ab80258df7e6a13` (PR #204). `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v179`. Builds 1-3 of the canonical identity project are merged, the v176 migration-tool stabilization PRs #194-#199 are merged, the production canonical migration has been completed and independently verified, and the structured-research schedule correction is merged as PR #203.

A focused post-merge QA correction is active on branch `fix/v179-postmerge-lifecycle-qa`. It keeps the same v179 version and tightens terminal lifecycle ownership so a non-owning provider observation cannot control top-level cancelled/postponed state merely because the selected provider event lacks an explicit status. The correction also treats unproven `rescheduled` status as reactivation evidence against an already-cancelled record. No provider limits, dependencies, production data, workflow schedule or deployment behavior are changed.

## Canonical identity implementation

### v174 foundation

Canonical venue identity supports current/historical names and locations, namespace-scoped provider identities, legacy venue IDs and parent/sub-location semantics. Rooms, halls, stages, theatres, temporary structures and hospitality sub-locations resolve to their parent venue when explicitly represented. Independent venues in one complex and simultaneous brand branches remain distinct. Historical concerts preserve date-correct raw venue facts while current/upcoming presentation can use current canonical venue facts.

Canonical concert identity is `bandId + canonical venue identity + full calendar date`. Time, provider event/listing ID, room/stage and ticket package/offer do not split a concert. Canonical event identity preserves valid explicit `eventGroupId`; otherwise ordinary events group by canonical venue + date, with evidence-backed festival-edition overrides.

The v166 performance contract remains mandatory: ordinary Discover/Concerts must not build the full venue directory; venue identity data is indexed/cached; Venues builds once and Venue Detail reuses that group.

### v175 ingestion and lifecycle

Automatic Ticketmaster and Tavily/Groq observations reconcile through shared canonical identity before persistence. A matching observation preserves the stable BANDMARKR concert ID and user-owned/unknown fields while namespace-scoped provider observations accumulate additively. Latest-state ETag reconciliation protects newer user edits.

Cancellation retains the record and history. Confirmed upcoming reschedules retain stable identity and preserve former-date evidence. Postponed without a verified replacement date becomes `POSTPONED · DATE TBD` with no stale active date. Attended historical dates are immutable. Ambiguous continuity fails closed.

The Ticketmaster ingestion path queries by the band's trusted confirmed attraction ID, requires that exact ID in the event attractions and persists that ID even when another co-bill artist is listed first. Active evidence cannot overwrite an already-cancelled top-level provider presentation without proven provider-linked replacement continuity on a new date; conflicting evidence is retained with `lifecycleReviewRequired` and conflict history. Terminal cancelled/postponed state belongs to the provider event that owns the selected top-level presentation; weaker or unrelated terminal observations remain review-only.

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

`bands.json` was reference-only and was not changed by the canonical migration.

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

## v177 and v178 navigation-performance correction

After the migrated production datasets were placed in R2, the live app exposed severe venue/navigation and broader startup regressions. v177 added O(1) canonicalVenueId lookup but did not fully resolve the issue. v178 then removed duplicated captured v158 full scans from rich fallback and Music-card capacity rendering, reused the indexed v166 grouping path for statistics, and made venue index rebuilds depend on actual normalized venue-record changes.

Production-shaped synthetic profiling used 379 bands, 540 venues and 2,989 concerts. The v177 baseline measured approximately 19.8 seconds for first Venues render, 3.6 seconds for statistics, 5.5 seconds for Music and 5.7 seconds for startup. v178 reduced those to approximately 160 ms, 27 ms, 147 ms and 259 ms respectively while preserving canonical identity semantics and lazy ordinary Concerts rendering.

PR #202 merged as `25a8a2385385d86668db2aaffa61e3b3fcd7b530` on 2026-09-02. The live app was then manually observed to be responsive again. No production data was modified by the v178 code build itself.

## Structured research schedule — September 2 operational correction

The scheduled `Structured concert and release research` workflow was still configured at `01:00 UTC` Monday/Wednesday/Friday on Wednesday 2026-09-02. GitHub Actions did eventually create and run that scheduled event, but only at `05:30 UTC` (`07:30 CEST`), roughly 4.5 hours after its nominal trigger. Run #25 completed successfully at about `05:42 UTC` (`07:42 CEST`) on pre-PR-#203 `main`, confirming extreme scheduler delay rather than a missed production research run.

To reduce exposure to GitHub's top-of-hour scheduler congestion, PR #203 moved the recurring trigger to `07:47 UTC` Monday/Wednesday/Friday and merged at `06:15 UTC` (`08:15 CEST`) on September 2. No second scheduled run was created at the new `07:47 UTC` target that same day, so Friday 2026-09-04 is the first clean validation point for the revised cron. The shared `live-vault-data-writes` concurrency group and scheduler lease remain unchanged.

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
6. v178 — global navigation profiling/performance correction: merged as PR #202.
7. Structured research schedule correction — merged as PR #203.
8. v179 — trusted-attraction regression coverage and lifecycle provider-status conflict safeguard: merged as PR #204.
9. v179 post-merge lifecycle ownership QA correction — active branch; version remains v179.

Production smoke remains separately authorized. No workflow run, provider call, deployment or production-data write is authorized by this code correction.

## Backlog hygiene

PR #134 remains intentionally open as unrelated production-inert listening backfill tooling. Cloudflare Worker CORS-origin hardening, patch-layer consolidation and unrelated Ticketmaster label hardening remain outside this correction.
