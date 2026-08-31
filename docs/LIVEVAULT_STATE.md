# LiveVault Current State

This continuity file was compacted on 2026-08-30 for the canonical identity project. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged baseline is **v174 — Canonical Identity Foundation (Build 1 of 3)** at merge commit `4857f486990c6799efaf371512a8bc142fde1444` (PR #190). `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v174` on merged `main`.

The active unmerged build is **v175 — Canonical Ingestion & Lifecycle (Build 2 of 3)** on branch `feat/canonical-identity-ingestion-lifecycle-v175`. It routes automatic concert observations through the v174 identity model at write time, accumulates provider observations, applies concert lifecycle rules and preserves latest-state concurrency/user ownership. Existing-data audit/research/migration tooling remains Build 3.

No deploy, live provider run, production smoke, production workflow, production-data mutation or production migration is authorized or has been performed for v175.

## v174 canonical identity foundation — merged

The shared identity layer extends the existing v158/v166 architecture rather than replacing its safety/performance model. Canonical venue identity supports additive current/historical names, location history, namespace-scoped provider venue identities, parent/sub-location mappings and legacy venue IDs. Rooms, halls, stages, theatres, temporary structures and hospitality/loge-style sub-locations resolve to their parent venue when explicitly represented. Separately named venues in one complex and simultaneous brand branches remain distinct; address conflicts fail closed.

Historical concert records keep their date-correct venue name/city/address. Current venue metadata and Venue Detail use the latest canonical venue facts. Upcoming concert read views may display current canonical venue facts while retaining stored/provider wording as source evidence.

Canonical concert identity is **bandId + canonical venue identity + full calendar date**. Time, provider event/listing ID, room/stage and ticket offer/package type do not create another canonical concert. Canonical event identity keeps valid explicit `eventGroupId` relationships authoritative; otherwise ordinary events group by **canonical venue + date**, with evidence-backed festival-edition overrides.

The v166 navigation architecture remains a hard contract: ordinary Discover/Concerts must not build the complete venue directory; canonical venue metadata is indexed/cached; Venues builds the canonical directory once and reuses it for detail/return navigation.

## v175 canonical ingestion and lifecycle — active

Build 2 routes automatic Ticketmaster and Tavily/Groq concert observations through one shared canonical write-time reconciliation layer instead of directly appending provider rows.

The reconciliation layer preserves a stable BANDMARKR concert ID when an incoming provider observation belongs to an existing canonical concert, including manually-added records. Provider event/listing/venue/attraction IDs, titles, URLs, times, statuses, offer classifications, source details and related-event evidence accumulate as namespace-scoped provider observations. Replaying the same observation is designed to be idempotent.

Ticketmaster standard/VIP/package pre-collapse now retains the full provider evidence for every collapsed listing before canonical persistence. When provider-owned presentation fields disagree, stronger verified provider evidence may replace weaker top-level provider presentation while the displaced provider values remain preserved as observations. Proven lifecycle continuity may also move an upcoming concert to a different resolved canonical venue without changing its stable BANDMARKR concert ID; ambiguous venue continuity still fails closed.

Lifecycle handling follows the locked Build 2 decisions:
- cancellation keeps the concert and user history rather than deleting it;
- a confirmed upcoming reschedule keeps the same BANDMARKR ID, updates the active replacement date and retains the former date in lifecycle history;
- a postponed concert without a verified replacement date becomes `POSTPONED · DATE TBD` and does not retain the old date as an active upcoming date;
- replacement provider listing IDs attach only through proven continuity;
- attended historical concert dates are immutable to later provider lifecycle evidence;
- ambiguous provider identity, venue continuity or conflicting existing canonical records fail closed rather than guessing.

The research pipeline now reads the canonical venue document once, builds the v174 venue index once, and applies v175 reconciliation to automatic observations. Final `concerts.json` persistence uses latest-state ETag reconciliation: on a precondition conflict the latest document is reread and canonical reconciliation is rerun, preventing a stale provider run from wiping newer user edits.

The visible lifecycle adjustment is deliberately small: postponed records without a date render `POSTPONED · DATE TBD`, cancelled records show an explicit cancelled label, missing-date postponed records sort safely, and invalid calendar actions are suppressed.

Focused synthetic coverage exists for stable manual IDs, alternate provider listings/offers/rooms, full collapsed-offer evidence retention, provider namespace/idempotency, strongest verified provider presentation, user-owned and unknown-field preservation, user conflicts, cancellation, same-venue and moved-venue reschedule/replacement IDs, postponed DATE TBD, attended-history immutability, ambiguous continuity, batch replay, ETag retry, Ticketmaster lifecycle conversion and lifecycle UI behavior.

## Production data baseline carried forward

The validated production `concerts.json` cleanup completed on 2026-08-24 with **3,262** concert records after removal of 334 unsafe legacy Ticketmaster records. All 76 attended concert IDs were preserved and the ticket-cost total remained **31,337**. The verified replacement SHA-256 was `d30c413cfe84a002e2e93361d94eb05854c529588dc20f7ba0b9fabefa8b3bab`.

Production `bands.json` Ticketmaster identity review completed with **370** bands, **334** trusted unique Ticketmaster attraction IDs and **36** unresolved bands. The verified reviewed replacement SHA-256 was `9744a107b22586d3446a1560514378511b262a3ea12c740224a1edab536e0774`.

Production venue cleanup completed with **530** reviewed `venues.json` records after conservative consolidation/removal of placeholders. These figures are historical continuity only; the future canonical migration must begin from a fresh separately authorized export and exact source hashes.

## Merged architecture carried forward

- v163: Ticketmaster ingestion is identity-first; provider IDs remain namespace-scoped and provider evidence is not user identity.
- v164: venue metadata/canonical overlays introduced conservative alias handling and same-address separation safety.
- v165: reviewed provider decisions and unknown future fields survive root-level identity operations.
- v166: venue navigation uses indexed/cached canonical grouping; ordinary concert dates do not construct the venue directory.
- v167-v169: Start/Next Concert and existing event-level presentation behavior were established.
- v170-v172: Discover/Bands recommendations and geographic-filter presentation were established.
- v173: bottom navigation order is `Music · Bands · Discover · Stats · Alerts` while stable route IDs remain unchanged.
- v174: canonical venue/concert/event identity foundation, read-time collapse, event/stat integration and collision-safe indexed venue resolution are merged.

## Active safety and ownership boundaries

- Stable BANDMARKR IDs, user-owned fields, reviewed decisions, provider ownership and unknown future fields must be preserved.
- Existing valid `eventGroupId` relationships remain user-owned/authoritative; system canonical event identity is derived separately.
- Automated browser QA uses only synthetic fixtures and the QA fake backend; live providers and production R2 are forbidden in automated QA.
- Production provider calls, production workflows, deployments, production smoke and production data changes require their specific explicit authorization. `Merge it` authorizes merge only.
- Production smoke is manual-only and read-only.
- Existing JSON writes keep optimistic concurrency/latest-state safeguards.
- v166 indexed/cached venue navigation is a performance contract and regression is a blocker.

## Canonical identity project sequence

1. **Build 1 / v174:** canonical venue, concert and event identity foundation; read-time/stat integration; focused synthetic QA. **Merged and complete.**
2. **Build 2 / v175:** automatic discovery/write paths use canonical identity; provider observations accumulate; cancellation/postponement/reschedule/replacement-ID lifecycle rules and latest-state reconciliation are implemented. **Active and unmerged.**
3. **Build 3:** exhaustive local audit, research decision registry, deterministic/hash-guarded dry-run migration planner, legacy ID mappings, rollback artifacts, invariant/stat reports and idempotency validation. No production writes.
4. **Production migration:** only after all three builds are merged and a fresh export/final dry run is separately approved. This is not a fourth code build.

## Backlog hygiene

PR #134 remains intentionally open as unrelated production-inert listening backfill tooling. Cloudflare Worker CORS-origin hardening, patch-layer consolidation and unrelated Ticketmaster label hardening remain outside v175.

## Next operational steps

Run exact-head PR QA after the final review corrections, confirm the complete Build 2 diff remains scoped and data-safe, and keep PR #191 unmerged until explicit authorization. Do not deploy, run production providers/smoke, begin Build 3, or perform any production migration from this PR.
