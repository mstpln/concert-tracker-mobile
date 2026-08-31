# LiveVault Current State

This continuity file was compacted on 2026-08-30 for the canonical identity project. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged baseline is **v175 — Canonical Ingestion & Lifecycle (Build 2 of 3)** at merge commit `3be9c7e662d2c415d45df83180ef32ae7a873138` (PR #191). Build 1 / v174 remains the canonical identity foundation underneath it.

The active unmerged build is **v176 — Canonical Audit, Research Closure & Migration (Build 3 of 3)** on branch `feat/canonical-identity-audit-migration-v176`, draft PR #192. Build 3 provides local/read-only audit and deterministic dry-run migration tooling only. It does not fetch production data, call providers, write Worker/R2 data, deploy, run production smoke, or perform the later production migration.

`APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v176` on the active branch. Production migration remains a separately authorized operation after Build 3 is merged and after a fresh authorized export and final hash-guarded dry run.

## v174 canonical identity foundation — merged

The shared identity layer extends the existing v158/v166 architecture rather than replacing its safety/performance model. Canonical venue identity supports additive current/historical names, location history, namespace-scoped provider venue identities, parent/sub-location mappings and legacy venue IDs. Rooms, halls, stages, theatres, temporary structures and hospitality/loge-style sub-locations resolve to their parent venue when explicitly represented. Separately named venues in one complex and simultaneous brand branches remain distinct; address conflicts fail closed.

Historical concert records keep their date-correct venue name/city/address. Current venue metadata and Venue Detail use the latest canonical venue facts. Upcoming concert read views may display current canonical venue facts while retaining stored/provider wording as source evidence.

Canonical concert identity is **bandId + canonical venue identity + full calendar date**. Time, provider event/listing ID, room/stage and ticket offer/package type do not create another canonical concert. Canonical event identity keeps valid explicit `eventGroupId` relationships authoritative; otherwise ordinary events group by **canonical venue + date**, with evidence-backed festival-edition overrides.

The v166 navigation architecture remains a hard contract: ordinary Discover/Concerts must not build the complete venue directory; canonical venue metadata is indexed/cached; Venues builds the canonical directory once and reuses it for detail/return navigation.

## v175 canonical ingestion and lifecycle — merged

Build 2 routes automatic Ticketmaster and Tavily/Groq concert observations through one shared canonical write-time reconciliation layer instead of directly appending provider rows.

The reconciliation layer preserves a stable BANDMARKR concert ID when an incoming provider observation belongs to an existing canonical concert, including manually-added records. Provider event/listing/venue/attraction IDs, titles, URLs, times, statuses, offer classifications, source details and related-event evidence accumulate as namespace-scoped provider observations. Replay is idempotent.

Lifecycle handling follows the locked decisions: cancellation retains the record and user history; confirmed upcoming reschedules retain the BANDMARKR ID and preserve former-date history; postponed concerts without a verified replacement date become `POSTPONED · DATE TBD`; replacement provider IDs require proven continuity; attended historical dates are immutable; ambiguous identity or venue continuity fails closed.

The research pipeline uses the canonical venue index and latest-state ETag reconciliation so a stale provider run cannot wipe newer user edits. Minimal lifecycle UI renders cancelled and postponed/TBD states safely.

## v176 canonical audit and dry-run migration — active

Build 3 is designed around a **fresh local export**, never repository or QA fixture data treated as production. The audit reports canonical concert collision candidates, venue identity ambiguity candidates, unresolved venue/date identity, invalid event groups, protected-field snapshots and before metrics without mutating its inputs.

A separate research decision registry can encode researched venue merge/separate decisions, explicit concert merge/separate decisions and evidence-backed festival editions. Venue reconciliation runs first, then concert reconciliation, then event/festival validation. A contradictory or incomplete decision blocks rather than guessing.

The migration planner preserves stable/user-rich BANDMARKR IDs, retains merged-away IDs in legacy mappings, unions provider/source/history evidence, preserves user-owned fields including explicit false values, and fails closed on contradictory user-owned or unknown future fields. Attended historical dates are protected through mapping-aware invariants.

Dry-run plan mode requires exact byte-level SHA-256 values for the local venue and concert source files. It emits byte-identical untouched source backups, migrated local outputs, complete forward and reverse ID maps, merge manifests, source/output hashes, before/after metrics, protected-field and orphan invariants, and rollback metadata. A second run over the migrated local output must be a no-op.

Multi-day/multi-venue grouping is permitted only for an explicitly confirmed festival edition. Ordinary concerts on different calendar dates remain separate events. Existing valid user-owned `eventGroupId` relationships remain authoritative.

## Production data baseline carried forward

The validated production `concerts.json` cleanup completed on 2026-08-24 with **3,262** concert records after removal of 334 unsafe legacy Ticketmaster records. All 76 attended concert IDs were preserved and the ticket-cost total remained **31,337**. The verified replacement SHA-256 was `d30c413cfe84a002e2e93361d94eb05854c529588dc20f7ba0b9fabefa8b3bab`.

Production `bands.json` Ticketmaster identity review completed with **370** bands, **334** trusted unique Ticketmaster attraction IDs and **36** unresolved bands. The verified reviewed replacement SHA-256 was `9744a107b22586d3446a1560514378511b262a3ea12c740224a1edab536e0774`.

Production venue cleanup completed with **530** reviewed `venues.json` records after conservative consolidation/removal of placeholders. These values and hashes are historical continuity only. They are **not** authorization or valid source guards for the later canonical production migration, which must start from a fresh separately authorized export.

## Merged architecture carried forward

- v163: Ticketmaster ingestion is identity-first; provider IDs remain namespace-scoped and provider evidence is not user identity.
- v164: venue metadata/canonical overlays introduced conservative alias handling and same-address separation safety.
- v165: reviewed provider decisions and unknown future fields survive root-level identity operations.
- v166: venue navigation uses indexed/cached canonical grouping; ordinary concert dates do not construct the venue directory.
- v167-v169: Start/Next Concert and existing event-level presentation behavior were established.
- v170-v172: Discover/Bands recommendations and geographic-filter presentation were established.
- v173: bottom navigation order is `Music · Bands · Discover · Stats · Alerts` while stable route IDs remain unchanged.
- v174: canonical venue/concert/event identity foundation and read-time/stat integration.
- v175: automatic ingestion, provider-observation accumulation, lifecycle handling and latest-state reconciliation.

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
2. **Build 2 / v175:** automatic discovery/write paths use canonical identity; provider observations accumulate; lifecycle rules and latest-state reconciliation are implemented. **Merged and complete.**
3. **Build 3 / v176:** exhaustive local audit, research decision registry, deterministic/hash-guarded dry-run migration planner, legacy/reverse ID mappings, rollback artifacts, invariant/stat reports and idempotency validation. **Active and unmerged. No production writes.**
4. **Production migration:** only after all three builds are merged and a fresh export/final dry run is separately approved. This is not a fourth code build.

## Backlog hygiene

PR #134 remains intentionally open as unrelated production-inert listening backfill tooling. Cloudflare Worker CORS-origin hardening, patch-layer consolidation and unrelated Ticketmaster label hardening remain outside v176.

## Next operational steps

Complete the v176 fix/review cycle on PR #192, run exact-head unit/safety and desktop/mobile QA, verify production-scale synthetic migration performance and no-op replay, and keep the PR unmerged until explicit `Merge it` authorization. Do not export or mutate production data, run production providers/smoke, deploy, or perform the production migration as part of Build 3.
