# LiveVault Current State

This continuity file was refreshed on 2026-09-04 after the full workflow/data-enrichment audit and final pre-merge PR #206 review. Earlier implementation detail remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

Current merged `main` is **v179** at merge commit `845a5bf6a8b16603306a1b427569af74a81936a0` (PR #205). `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v179`. PR #204 introduced the provider identity/lifecycle conflict safeguard; PR #205 completed post-merge ownership hardening so weaker/unrelated provider evidence cannot control top-level lifecycle or leak provider-presentation identity fields.

A workflow/data-enrichment integrity correction is active as PR #206 on branch `fix/workflow-enrichment-integrity-qa`. It does not change the PWA shell or version. Its scope is scheduled-run idempotency, focused Tavily canonical ingestion/reporting, and explicit/latest-state fail-closed safety for the historical legacy release cleanup.

## Canonical identity and ingestion

### v174 foundation

Canonical venue identity supports current/historical names and locations, namespace-scoped provider identities, legacy venue IDs and parent/sub-location semantics. Rooms, halls, stages, theatres, temporary structures and hospitality sub-locations resolve to their parent venue when explicitly represented. Independent venues in one complex and simultaneous branches remain distinct. Historical concerts preserve date-correct raw venue facts while current/upcoming presentation can use current canonical venue facts.

Canonical concert identity is `bandId + canonical venue identity + full calendar date`. Time, provider event/listing ID, room/stage and ticket package/offer do not split a concert. Existing valid explicit `eventGroupId` remains user-owned/authoritative. Ordinary derived event identity is canonical venue + date; evidence-backed festival editions may span dates/venues.

### v175 lifecycle/provider ownership

Automatic concert observations must reconcile through shared canonical identity before persistence. Matching observations preserve the stable BANDMARKR concert ID, user-owned fields and unknown future fields while namespace-scoped provider evidence accumulates additively. Latest-state ETag reconciliation protects newer user edits.

Cancellation retains the record and history. Confirmed upcoming reschedules retain stable identity and former-date evidence. Postponed without a verified replacement date becomes `POSTPONED · DATE TBD`. Attended historical dates are immutable. Ambiguous continuity fails closed.

Ticketmaster automatic admission requires the band's trusted confirmed attraction ID and that exact attraction on the returned event. The trusted band attraction ID is persisted even when a co-bill artist appears first. Active evidence cannot reactivate a cancelled concert without provider-linked replacement continuity to a new date. Cancelled/postponed top-level state belongs to the provider event that owns the selected presentation. Weaker/unrelated provider evidence remains an observation and may set `lifecycleReviewRequired`, but cannot replace stronger top-level presentation fields.

### v176 audit/migration

Deterministic local audit/research/migration tooling is hash-guarded, reversible and fail-closed. It preserves stable/user-rich IDs, transitive legacy mappings, provider/source/lifecycle evidence, explicit false values, unknown future fields and user ownership. Production migration was completed and independently verified.

Verified production migration baseline/output:
- source venues: 530 -> production venues: 540
- source concerts: 3,331 -> production concerts: 2,989
- attended: 76 -> 76; historical dates unchanged
- ticket total: 14,671 -> 14,671
- ticket quantity: 58 -> 58
- all source venue/concert IDs remain traceable
- zero orphan references, duplicate stable IDs, unknown-field loss, evidence loss or second-pass mutation blockers were found

## Performance

v177 and v178 restored production-scale navigation performance after the canonical migration. The v166 contract remains mandatory: ordinary Discover/Concerts does not construct the full canonical venue directory; venue identity is indexed/cached; Venues builds once and Venue Detail reuses the group.

Production-shaped synthetic profiling at 379 bands / 540 venues / 2,989 concerts improved approximately:
- first Venues render: 19.8 s -> 160 ms
- statistics: 3.6 s -> 27 ms
- Music: 5.5 s -> 147 ms
- startup: 5.7 s -> 259 ms

## Workflow and enrichment audit — September 4, 2026

The audit reviewed all repository workflow definitions, enrichment scripts, provider identity logic, canonical write boundaries, recent scheduled/manual run history, CI/synthetic safety, and the September 4 structured research run. No production workflow was manually dispatched and no production data/provider action was initiated by the audit.

### Structured research scheduling

PR #203 changed `Structured concert and release research` to `07:47 UTC` Monday/Wednesday/Friday to avoid top-of-hour congestion. GitHub Actions delivery remains materially delayed and can duplicate a scheduled period:

- September 2 run #25 was created around 05:30 UTC from the earlier nominal schedule and completed successfully.
- September 2 run #26 was then created at 12:17 UTC and executed another full provider cycle rather than no-oping. It made roughly 384 Ticketmaster and 29 setlist.fm calls, added one concert and applied one Ticketmaster upgrade.
- September 4 run #27 was not created until 12:15:50 UTC, about 4 hours 29 minutes after the configured 07:47 UTC target. It completed successfully at about 12:21 UTC.

The shared `live-vault-data-writes` concurrency group plus persisted scheduler lease correctly prevent overlapping provider writers, but before PR #206 they did not prevent a later duplicate schedule event for the same intended period. PR #206 adds persisted per-owner completion markers. Structured research, focused Tavily, and the optional twice-monthly venue-metadata stage each suppress a later duplicate scheduled execution for the same intended period before provider work. Every known scheduled provider stage maps to its most recent nominal schedule occurrence, including cross-midnight and multi-day GitHub delivery delays, so scheduled provider work never runs without a period marker. An unknown/unconfigured scheduled provider owner fails closed before lease acquisition or provider work. Manual `workflow_dispatch` remains unaffected, failed stages do not mark the period complete, unknown usage fields are preserved, and malformed marker state fails closed. This prevents duplicate quota/data work but cannot force GitHub to deliver a delayed or missing schedule event.

### September 4 structured research run #27

Run #27 completed successfully on merged `main` (`845a5bf...`). Key observed behavior:
- bands processed: 379
- new concerts: 10
- Ticketmaster upgrades: 32
- ambiguous Ticketmaster matches: 417, held rather than guessed
- Ticketmaster calls: 384
- Tavily: 0 (month total remained 142/900)
- Groq: 0
- setlist.fm: 29
- Spotify: 0
- setlists checked: 9/9 eligible past shows; 0 new setlists
- predicted setlists: 5 upcoming attending, 0 currently due
- live-performance insights: 2 eligible, 0 processed; 20 setlist.fm requests

The run repeatedly failed closed on `provider_identity_collision`, `lifecycle_venue_unresolved`, `venue_location_conflict` and `provider_band_conflict`. Ticketmaster event lookup was skipped where a trusted attraction identity was missing. Setlist.fm 404/429 responses were treated as provider errors/retry conditions, not persisted as false no-setlist facts.

### Focused Tavily

Historical focused Tavily scheduling is also substantially delayed: the September 1 run nominally scheduled for 02:00 UTC began around 07:32 UTC. That run attempted 142 bands, observed 23 candidates and prepared 21 additions; malformed Groq responses were rejected/logged rather than accepted. Its venue-metadata phase made zero writes.

The audit found a code-path inconsistency: focused Tavily still used the pre-v175 `reconcileConcertCandidate` heuristic and a plain latest read/write instead of shared canonical ingestion. PR #206 corrects this. Focused Tavily observations now pass through the v175 canonical ingestion primitive with the current venue index and `writeJsonReconciled`, preserving stable IDs, user/unknown fields, lifecycle/provider ownership and latest-state concurrency. Run metrics count only actual persisted additions, observation merges and lifecycle continuations as changes; exact idempotent replays are reported separately as unchanged. The optional venue-metadata stage in the same twice-monthly workflow now has its own scheduled completion marker so a duplicate GitHub schedule cannot bypass the first-stage no-op and still spend provider quota in the second stage.

### Provider/data-quality logic reviewed

- **Ticketmaster:** trusted reviewed attraction ID is required for automatic event lookup/admission; the exact trusted ID must appear on the event; multi-attraction/co-bill order cannot replace tracked-band identity; ambiguous identity/venue continuity fails closed.
- **MusicBrainz:** automatic confirmation requires exact artist-name/alias evidence, no impersonator signal, no origin contradiction/unverifiable saved-origin case, threshold clearance and a clear lead. Otherwise candidates remain reviewable.
- **Setlist.fm:** actual setlist persistence requires date + artist identity + venue agreement. Multiple/no matching candidates are not guessed. 404/429/provider errors do not become trusted absence facts.
- **Spotify candidate acquisition / provider identity backfills / approved-identity application:** review/approval ownership boundaries remain in place; no audit finding showed automatic overwrite of user-reviewed provider identity.
- **Venue metadata research:** incomplete/ambiguous research remains fail-closed; the September 1 focused run attempted no venue writes. PR #206 also protects the scheduled venue-metadata stage from later duplicate schedule executions.
- **Legacy release cleanup:** this is manual/destructive historical tooling. PR #206 requires the explicit phrase `CLEAN_LEGACY_RELEASE_FEED`, requires `RELEASE_FEED_BACKUP_PATH`, refuses missing/malformed non-array `news.json`, uses latest-state reconciled mutation, writes the exact rollback snapshot before mutation, and keeps an existing rollback snapshot eligible for artifact upload even when the cleanup step fails after the snapshot was created.
- **PR QA / full PWA QA:** synthetic fixture/fake-backend boundaries remain intact. Unit/syntax/version/cache/workflow/build-state/QA-safety checks and desktop/mobile Chromium are the normal merge gates.
- **Production smoke:** remains manual-only and read-only with separate authorization.

## Active safety boundaries

- Stable BANDMARKR IDs, user-owned fields, reviewed decisions, provider ownership/provenance and unknown future fields must be preserved.
- Existing optimistic-concurrency/latest-state safeguards remain mandatory on enrichment writes.
- Automated browser QA uses synthetic fixtures and the QA fake backend only; production R2 and live providers are forbidden.
- Production provider calls, production workflows, deployments, production smoke and production-data changes require separate explicit authorization. `Merge it` authorizes merge only.
- Production smoke remains manual-only/read-only.
- Provider ambiguity must fail closed rather than invent identity, lifecycle, venue or absence facts.

## Project sequence and next step

1. v174 canonical venue/concert/event foundation — merged.
2. v175 canonical ingestion/lifecycle — merged.
3. v176 audit/research/migration tooling — merged.
4. Production canonical migration — completed and verified.
5. v177 venue navigation performance correction — merged PR #201.
6. v178 global navigation performance correction — merged PR #202.
7. Structured research schedule adjustment — merged PR #203.
8. v179 provider identity/lifecycle safeguard — merged PR #204.
9. v179 post-merge provider/lifecycle ownership QA — merged PR #205 at `845a5bf6a8b16603306a1b427569af74a81936a0`.
10. Workflow/data-enrichment integrity QA corrections — active PR #206; version remains v179; implementation and review corrections are complete with no known code-level blocker. Merge remains separately gated by exact-head validation and explicit user authorization.

PR #134 remains intentionally open as unrelated production-inert listening backfill tooling. Production smoke remains separately authorized. No GitHub Desktop/local action is required for the current webview-first work.
