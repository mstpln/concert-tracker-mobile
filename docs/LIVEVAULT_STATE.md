# LiveVault Current State

This continuity file was compacted on 2026-08-30 for the canonical identity project. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged baseline is **v173** at merge commit `38843164dd4ac5d2f3a0c0f8eb69294d0e1d1220` (PR #189). `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v173` on `main`.

The active unmerged build is **v174 — Canonical Identity Foundation (Build 1 of 3)** on branch `feat/canonical-identity-foundation-v174`. It is intentionally limited to the shared canonical venue/concert/event read model, current-vs-historical venue presentation, event/stat integration and focused synthetic regression/performance QA. Provider ingestion/lifecycle prevention is Build 2. Existing-data audit/research/migration tooling is Build 3. Production migration is a later separately authorized operation.

No merge, deploy, live provider run, production smoke, production workflow or production-data mutation is authorized or has been performed for v174.

## v174 canonical identity foundation

The new shared identity layer extends the existing v158/v166 architecture rather than replacing its safety/performance model.

Canonical venue identity now supports additive current/historical names, location history, namespace-scoped provider venue identities, parent/sub-location mappings and legacy venue IDs. Rooms, halls, stages, theatres, temporary structures and hospitality/loge-style sub-locations resolve to their parent venue when that relationship is explicitly represented. Relocation/rebuild continuity can therefore remain one venue without turning different addresses into a generic merge rule. Separately named venues in one complex and simultaneous brand branches remain distinct.

Historical concert records keep their date-correct venue name/city/address. Current venue metadata and Venue Detail use the latest canonical venue facts. Upcoming concert read views may display the current canonical venue name/location while retaining the stored historical/provider wording as source evidence.

Canonical concert identity is **bandId + canonical venue identity + full calendar date**. Time, provider event/listing ID, room/stage and ticket offer/package type do not create another canonical concert. Build 1 applies this non-destructively at read time and fails closed when duplicate rows contain a genuine contradictory user-owned field. Persistent provider-observation accumulation and write-time prevention are deliberately deferred to Build 2.

Canonical event identity keeps existing valid explicit `eventGroupId` relationships authoritative. Otherwise ordinary events group by **canonical venue + date**. A reliably identified festival edition overrides the ordinary rule and may span multiple dates and multiple canonical venues. Annual editions remain separate and non-festival consecutive-night shows remain separate events.

Event-level spend/travel/night/venue/city behavior continues to use event groups. Festival travel is one event-level distance: verified primary venue when supplied, otherwise the shortest known festival-venue distance. Artist appearances, ratings, setlists, genres and lineup roles remain performance-level.

The v166 navigation architecture remains a hard contract: ordinary Discover/Concerts must not build the complete venue directory; canonical venue metadata is indexed/cached; Venues builds the canonical directory once and reuses it for detail/return navigation. v174 extends the indexed metadata lookup rather than restoring concert × venue full scans.

## Production data baseline carried forward

The validated production `concerts.json` cleanup completed on 2026-08-24 with **3,262** concert records after removal of 334 unsafe legacy Ticketmaster records. All 76 attended concert IDs were preserved and the ticket-cost total remained **31,337**. The verified replacement SHA-256 was `d30c413cfe84a002e2e93361d94eb05854c529588dc20f7ba0b9fabefa8b3bab`.

Production `bands.json` Ticketmaster identity review completed with **370** bands, **334** trusted unique Ticketmaster attraction IDs and **36** unresolved bands. The verified reviewed replacement SHA-256 was `9744a107b22586d3446a1560514378511b262a3ea12c740224a1edab536e0774`.

Production venue cleanup completed with **530** reviewed `venues.json` records after conservative consolidation/removal of placeholders. These production figures are historical continuity only; the future canonical migration must begin from a fresh separately authorized export and exact source hashes.

## Merged architecture carried forward

- v163: Ticketmaster ingestion is identity-first; provider IDs remain namespace-scoped and provider evidence is not user identity.
- v164: venue metadata/canonical overlays introduced conservative alias handling and same-address separation safety.
- v165: reviewed provider decisions and unknown future fields survive root-level identity operations.
- v166: venue navigation uses indexed/cached canonical grouping; ordinary concert dates do not construct the venue directory.
- v167-v169: Start/Next Concert and existing event-level presentation behavior were established.
- v170-v172: Discover/Bands recommendations and geographic-filter presentation were established.
- v173: bottom navigation order is `Music · Bands · Discover · Stats · Alerts` while stable route IDs remain unchanged.

## Active safety and ownership boundaries

- Stable BANDMARKR IDs, user-owned fields, reviewed decisions, provider ownership and unknown future fields must be preserved.
- Existing valid `eventGroupId` relationships remain user-owned/authoritative; system canonical event identity is derived separately.
- Automated browser QA uses only synthetic fixtures and the QA fake backend; live providers and production R2 are forbidden in automated QA.
- Production provider calls, production workflows, deployments, production smoke and production data changes require their specific explicit authorization. `Merge it` authorizes merge only.
- Production smoke is manual-only and read-only.
- Existing JSON writes keep optimistic concurrency/latest-state safeguards.
- v166 indexed/cached venue navigation is a performance contract and regression is a blocker.

## Canonical identity project sequence

1. **Build 1 / v174:** canonical venue, concert and event identity foundation; read-time/stat integration; focused synthetic QA. Active now.
2. **Build 2:** route Ticketmaster and other automatic discovery/write paths through the Build 1 identity resolver; accumulate provider observations; implement cancellation/postponement/reschedule/replacement-ID lifecycle rules; preserve latest-state concurrency and user ownership.
3. **Build 3:** exhaustive local audit, research decision registry, deterministic/hash-guarded dry-run migration planner, legacy ID mappings, rollback artifacts, invariant/stat reports and idempotency validation. No production writes.
4. **Production migration:** only after all three builds are merged and a fresh export/final dry run is separately approved. This is not a fourth code build.

## Backlog hygiene

PR #134 remains intentionally open as unrelated production-inert listening backfill tooling. Cloudflare Worker CORS-origin hardening, patch-layer consolidation and unrelated Ticketmaster label hardening remain outside v174.

## Next operational steps

Finish v174 exact-head validation: focused unit/syntax/version/build-state/safety checks, desktop Chromium, mobile Chromium at approximately 375px and 480px, dark/light coverage, and production-scale synthetic performance at approximately 3,300 concerts / 530 venues. Review the final PR head and correct any failures without changing the v174 version. Do not merge without explicit `Merge it`; do not perform Build 2, Build 3 or any production operation in this PR.
