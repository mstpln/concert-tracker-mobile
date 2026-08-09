# Data Automation — Listening Build D

## Scope

Build D is the controlled production backfill phase for historical listening enrichment.

Build C completed the production-readiness path and the authorized aggregate-only production inventory. That inventory read 250,801 private listening events, mapped 72,145 events to current BANDMARKR bands, found 12,123 unique-track work items, and reported 12,026 tracks needing Spotify metadata, 22 tracks eligible for ListenBrainz fallback, 75 tracks already complete from source recording identity, zero blocked tracks, zero unusable events, zero provider calls and zero production writes.

The initial Build D slice added a production entrypoint around the already-reviewed Build C runner with an intentionally tiny rollout ceiling and separate provider/write authorization gates.

## Initial rollout validation

The initial production entrypoint defaults to one provider step and remains hard-capped at five provider steps per invocation. Three separately authorized one-step production runs validated the full provider sequence without widening that entrypoint:

1. Spotify exact-track metadata persisted successfully, reduced the Spotify backlog from 12,026 to 12,025, and exposed one ISRC-backed MusicBrainz next step.
2. MusicBrainz processed that ISRC conservatively; the immediate MusicBrainz queue returned to zero and the unresolved recording moved to ListenBrainz fallback.
3. ListenBrainz completed that recording identity; the complete-track count increased from 75 to 76 and the ListenBrainz fallback queue returned to 22.

Each invocation attempted exactly one provider step, persisted the result required by that step, and stopped at the requested `batch_limit`. The original five-step rollout command remains available for focused diagnostics and is not converted into the bulk command.

## Bulk backfill entrypoint

v111 adds `scripts/listening-backfill-bulk.js` for a separately authorized historical backfill. It reuses the same inventory, provider adapters, UsageTracker accounting, persistence preflight, concurrency checks and per-step durable writes as the validated Build D path.

The bulk runner executes the existing maintenance runner in internal chunks of at most 100 provider steps. A `batch_limit` after a durable 100-step chunk is the normal internal continuation point. Provider retry, provider error, provider-wide halt, usage denial, stale production state, persistence conflict or any thrown safety error stops the process immediately.

A persisted `needs_review` result is different: in bulk mode only, that individual work item is quarantined in its existing review-required identity state and excluded from further automatic routing, while unrelated work continues. The focused 1–5 step production entrypoint keeps the original default and still halts on `needs_review` for diagnostics. This policy change does not auto-resolve or guess an ambiguous recording.

The bulk process has a separate hard ceiling of 50,000 provider steps per invocation. This is sized above the current 12,000-track inventory because a track can require Spotify, then MusicBrainz, then ListenBrainz. It is a runaway guard, not a promise that providers will allow that many calls.

The Spotify app-only access token is refreshed after at most 45 minutes of reuse so a multi-hour process does not depend on one short-lived token. This refresh changes no track identity and does not weaken the provider gates.

A structured Spotify 429 `QUOTA_EXCEEDED` response is treated as a provider-wide halt rather than a terminal error for the current track. Usage has already been durably reserved before that request, but the work item is deliberately left incomplete and its step key is not marked completed. A later separately authorized invocation can therefore retry the same track instead of silently losing it. Ordinary 429 responses with a valid `Retry-After` remain explicit dated retries.

## First bulk production invocation

After PR #98 merged as `d872ab3d91c144bf27002c13af05f53d52453639`, the user separately authorized the first full bulk invocation and ran it locally from merged v111.

The process attempted four provider steps and persisted all four. It then stopped safely on `musicbrainz:needs_review`. Aggregate state after that stop was:

- complete tracks: 77;
- planned provider steps: 12,045;
- Spotify: 12,023;
- MusicBrainz immediate queue: 0;
- ListenBrainz fallback: 22;
- no-route/review-required: 1;
- blocked: 0;
- retry-wait: 0.

The four persisted steps remain durable and source observations were not changed. The early stop demonstrated that treating every review-required track as a process-wide halt would make a large historical migration unnecessarily interactive, even though the ambiguous track itself had already been safely quarantined. The focused v111 correction therefore changes only the bulk stop policy described above; it does not rerun production or weaken provider, quota, concurrency or persistence stops.

## Bulk authorization

The bulk runner requires the existing provider/write authorization values plus a third exact authorization dedicated to the full historical operation:

- `--execute`
- `--write`
- `LIVEVAULT_LISTENING_BACKFILL_CONFIRM=I_AUTHORIZE_BOUNDED_LISTENING_PROVIDER_ENRICHMENT`
- `LIVEVAULT_LISTENING_WRITE_CONFIRM=I_AUTHORIZE_DERIVED_LISTENING_WRITES`
- `LIVEVAULT_LISTENING_BULK_CONFIRM=I_AUTHORIZE_FULL_LISTENING_BACKFILL`

The maintenance Worker URL and `DATA_MAINTENANCE_TOKEN` remain required. Spotify credentials and the ListenBrainz token continue to be resolved only when their provider is actually planned.

Merging v111 or a focused v111 correction does not itself authorize or start another bulk production invocation.

## Bulk provider ceilings

The ordinary application/research provider caps remain unchanged. Only a context loaded explicitly with `bulk: true` widens the listening-maintenance invocation ceilings. Spotify and MusicBrainz use 15,000-step maintenance ceilings for the bulk process, while ListenBrainz retains a conservative maximum of 100 calls per process with at least one-second pacing.

Spotify still uses the existing UsageTracker accounting and pacing, and its provider response remains authoritative. Spotify Development Mode does not publish a stable numeric account quota; 429/rate-limit or quota responses therefore stop conservatively rather than being guessed around.

MusicBrainz keeps the reviewed meaningful User-Agent and at least 1.1-second pacing. ListenBrainz keeps its separate courtesy ceiling rather than inheriting the larger Spotify/MusicBrainz bulk ceiling. These values are internal invocation guards, not claims about provider allowances.

## Dual production authorization

A real Build D invocation requires all of the following:

1. `--execute`;
2. `--write`;
3. `LIVEVAULT_LISTENING_BACKFILL_CONFIRM=I_AUTHORIZE_BOUNDED_LISTENING_PROVIDER_ENRICHMENT`;
4. `LIVEVAULT_LISTENING_WRITE_CONFIRM=I_AUTHORIZE_DERIVED_LISTENING_WRITES`.

The maintenance Worker URL and `DATA_MAINTENANCE_TOKEN` are then required for the existing least-privilege Worker client.

The separate exact values distinguish authorization to consume provider quota from authorization to write the derived maintenance state required for safe progress. Provider execution cannot be enabled in a read-only mode because Build C deliberately persists provider usage before each request.

## Provider credentials

Spotify exact-track enrichment uses the existing app-only Client Credentials environment contract:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

The access token is acquired lazily only if the planner reaches a Spotify step. The focused five-step entrypoint caches it only for that short process; the v111 bulk entrypoint refreshes it after at most 45 minutes of reuse for long-running operation.

MusicBrainz requires no secret and continues using the reviewed meaningful User-Agent and maintenance pacing.

ListenBrainz fallback remains later in the evidence ladder and resolves `LISTENBRAINZ_USER_TOKEN` lazily only if a run actually reaches a ListenBrainz step.

Before quota reservation, the production preflight verifies that the credential required by the planned provider exists. A missing Spotify client ID/secret or ListenBrainz user token therefore stops the invocation before provider quota is reserved and before a track-level error can be persisted. Credential values are never included in aggregate output.

## Reused Build C safety

Build D does not create a second enrichment engine. It reuses:

- the verified immutable private archive reader;
- Build A inventory and work keys;
- Build B conservative provider ordering/resolvers;
- the Build C one-step-at-a-time runner;
- the dedicated maintenance Worker role;
- shared UsageTracker accounting;
- per-step persistence preflight;
- strict ETag/create-only persistence;
- provider usage persistence before the provider request;
- checkpoint/result durability before another provider step;
- Build B retry state and `nextEligibleCheckAt` ownership.

Source Spotify and ListenBrainz observations remain immutable.

## Per-step ownership and concurrency guard

The inventory is built from one loaded `bands.json` snapshot, but Build D does not trust that snapshot indefinitely. Before every provider quota reservation it rereads `bands.json` and requires the complete loaded band document to remain unchanged. This protects stable band ownership and confirmed Spotify/MusicBrainz identity from concurrent browser changes, deletions or review decisions while the local maintenance process is running.

After provider quota has been durably reserved in `apiUsage.json`, Build D rechecks `bands.json` again and reruns the Build C preflight against the exact same planned metadata/identity snapshot. That second preflight must explicitly return `true`; a false, undefined, thrown, stale or conflicting result stops before the external provider request. The already-persisted quota reservation may conservatively over-count an aborted attempt, but stale derived data is not written and quota accounting is never erased.

After the provider request returns, Build D rechecks the complete `bands.json` snapshot once more immediately before checkpoint or derived-state persistence. A band deletion, ownership change or confirmed provider-identity change that happened while the external request was in flight therefore stops the write instead of persisting a result against stale band ownership. Conditional metadata/identity writes remain the separate protection against concurrent derived-document changes.

Synthetic regression coverage exercises changes and explicit denial before quota reservation, after quota persistence and after provider execution but before derived persistence. In each stale/denied case the next unsafe operation remains blocked; conservative provider-usage over-counting is allowed rather than erasing a reserved attempt.

## Safe output

The production entrypoints log only aggregate source counts, aggregate inventory counts, selected ceilings, aggregate attempted/persisted/halt information and count-only plans.

The bulk runner additionally emits count-only progress after each durable internal chunk so a long local process can be observed without exposing listening details.

Neither entrypoint logs artist names, recording titles, raw timestamps, listening object paths, Worker endpoint, provider tokens or secret values.

## Provider documentation review

Before Build D, the official provider contracts were rechecked. Spotify's Track response continues to expose ISRC under external IDs. MusicBrainz continues to require responsible request pacing and a meaningful User-Agent. ListenBrainz metadata lookup continues to require token authorization and exposes dynamic rate-limit information through response headers.

Before v111 bulk rollout, Spotify's current Development Mode quota documentation was rechecked again. Development Mode uses an unpublished, changeable per-developer-account quota in addition to rolling rate limits. The runner therefore cannot safely infer a numeric Spotify allowance and must continue to stop on provider throttling/quota responses.

## Version

Build D began at v110. The v111 bulk runner is an architectural extension because it changes the production operating mode from tiny diagnostic invocations to one resumable long-running process. `APP_VERSION`, `CACHE_NAME_LITERAL` and generated build state moved together to v111 exactly once. The review-quarantine change is a focused correction to the same unreleased operational build and therefore keeps v111.

## Production boundary

Creating, reviewing or merging Build D code does **not** authorize a real backfill invocation.

Development and QA do not:

- call Spotify, MusicBrainz or ListenBrainz;
- write production `apiUsage.json`, Spotify metadata or track identities;
- read the private production vault during automated QA;
- add a scheduled enrichment workflow;
- add production provider secrets to GitHub;
- modify immutable source observations;
- remove existing provider/data safety rules.

The three one-step Build D production validations and the first four-step bulk invocation were separately authorized production actions. Any resumed bulk invocation remains separately authorized after the focused correction is reviewed and merged.
