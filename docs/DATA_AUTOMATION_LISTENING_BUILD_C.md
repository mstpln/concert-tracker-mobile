# Data Automation — Listening Build C

## Scope

Build C starts the activation plumbing for historical listening enrichment without activating production enrichment.

The v109 branch now contains the bounded maintenance runner plus inert provider, usage and persistence adapters around the merged Build A inventory and Build B enrichment engine. It also contains a gated inventory-only production entrypoint that can later reconstruct aggregate diagnostics from the verified private listening vault, but no production inventory has been run. Automated validation uses fictional fixtures and fake Worker/provider responses only.

## Execution contract

For each provider step, the runner:

1. asks the Build B planner for one safe next step;
2. requires that step's persistence preflight to return explicit approval before any provider usage reservation or provider adapter call;
3. requires the usage gate to return explicit approval for that provider call;
4. executes exactly that planned operation through an injected provider adapter;
5. validates the provider response through the Build B resolver;
6. merges only derived track identity and Spotify metadata state;
7. requires the persistence callback to explicitly confirm the resulting state is durable before another provider step may start;
8. replans from the newly persisted logical state rather than assuming a fixed queue.

A batch defaults to 25 provider steps and has a hard code-level ceiling of 100. Invalid batch sizes fail before provider work. Finishing all planned work exactly on the final allowed step is treated as completion, not as a batch-limit halt.

## Checkpoint and resume behavior

The checkpoint records the logical run start/update time, completed operation keys and halt reason. Known checkpoint fields are bounded and type/date validated. It is audit/resume state, not an authority that can suppress an explicit Build B retry.

The provider state in `listening/track-identities.json` remains authoritative for retry eligibility. A `retry` result must carry a valid `nextEligibleCheckAt`; the batch persists that state and stops. The terminal halt reason is included in the persisted checkpoint. A later invocation may retry the same provider only after Build B says the retry is due.

Persistence preflight failure aborts before provider quota is reserved. A thrown persistence error or a persistence callback that does not explicitly confirm success aborts the batch before another provider adapter is invoked. The caller must treat the failed in-memory snapshot as uncommitted and reload durable state before resuming.

## Maintenance Worker client

`scripts/lib/workerClient.js` now exposes a configurable client factory while preserving the existing research client as the default export. Existing research workflows therefore keep the same `CF_WORKER_TOKEN` behavior.

`scripts/lib/listeningMaintenanceClient.js` creates a separate client that uses `DATA_MAINTENANCE_TOKEN`. Merely importing or merging the module does not read the secret or contact the Worker; environment validation occurs only if a future maintenance invocation actually uses the client.

The v107 Worker allowlist remains unchanged. The maintenance credential can only use the already-reviewed listening/api-usage routes and cannot mutate bands/concerts, access tickets/news, rewrite the listening manifest/archive, or use browser-only routes.

## Usage accounting

`scripts/lib/listeningMaintenanceUsage.js` wraps the existing `UsageTracker` enforcement rather than creating a parallel Spotify or MusicBrainz allowance.

- Spotify reservations use the existing `canCallSpotify()` / `recordSpotifyCall()` cap and pacing counters.
- MusicBrainz reservations use the existing `canCallMusicbrainz()` / `recordMusicbrainzAttempt()` cap and pacing counters. The maintenance wrapper also honors the persisted previous MusicBrainz attempt time before the first request in a new process.
- ListenBrainz has no invented daily/monthly provider allowance. Build C keeps only a maintenance-local per-run safety ceiling and courtesy spacing, including a persisted last-call timestamp so immediate successive invocations cannot bypass pacing.
- Additive aggregate diagnostics are stored under `apiUsage.json.listeningMaintenance`; unrelated existing and unknown fields are preserved.

The maintenance context resets only per-run counters needed for its own invocation. Existing persisted daily Spotify usage remains shared, so maintenance cannot pretend earlier production Spotify calls did not happen.

## Provider adapters

`scripts/lib/listeningMaintenanceProviders.js` implements injectable HTTP contracts for the approved Build B evidence ladder. The module has no automatic invocation.

- Spotify exact-track lookup sends only the exact stored Spotify track ID. Successful Track payloads are passed to Build B, which validates artist identity, relinking and ISRC ownership.
- MusicBrainz looks up the exact ISRC with `inc=artist-credits`, sends the reviewed meaningful User-Agent, and leaves ambiguity handling to Build B.
- ListenBrainz sends only the source artist/recording text required by the fallback and uses `Authorization: Token …`. It does not add release text or guess an edition.
- There is no hidden HTTP retry loop. A 429/503 becomes explicit retry state only when the provider supplied a usable `Retry-After`; otherwise the step becomes a normal fail-closed error.

Current provider documentation was rechecked during this build. Spotify Track responses still expose `external_ids.isrc`; MusicBrainz still documents the web-service rate discipline and meaningful User-Agent requirement; ListenBrainz metadata lookup still requires token authentication and publishes rate-limit information dynamically.

## Conditional persistence

`scripts/lib/listeningMaintenancePersistence.js` loads `apiUsage.json`, `listening/spotify-metadata.json` and `listening/track-identities.json` through the maintenance client and exposes the runner's preflight/persist callbacks.

Before every provider step, it rereads the three writable documents and rejects any concurrent change rather than merging stale maintenance state.

After a provider attempt, persistence is deliberately ordered:

1. `apiUsage.json` first, including the provider call counters and maintenance checkpoint;
2. Spotify metadata only when that provider-owned document actually changed;
3. track identities last.

All writes are strict conditional writes. If a later derived write conflicts, the real provider call remains counted. That can conservatively over-count and require a reload/retry, but it cannot erase quota usage or silently overwrite concurrent data. Source listening observations are never written.

## Gated aggregate production inventory

`scripts/listening-maintenance-production.js` is a read-only inventory entrypoint. It deliberately has no provider-call mode and no production-write mode.

Before it can read any private data, all three conditions must be true:

1. `--inventory-only` is present;
2. `--execute` is present;
3. `LIVEVAULT_LISTENING_MAINTENANCE_CONFIRM` exactly equals `I_AUTHORIZE_PRIVATE_LISTENING_READS_FOR_AGGREGATE_INVENTORY`.

Only then does it require `CF_WORKER_ENDPOINT` and `DATA_MAINTENANCE_TOKEN` and construct the maintenance client. It reuses the already-reviewed `spotify-artwork-backfill-source.js` reader for the immutable Spotify archive and ListenBrainz incrementals, including manifest validation, gzip decoding, SHA-256 verification, schema checks and event-count checks. It also reads bands, existing Spotify metadata and track identities and passes those inputs to the provider-free inventory planner.

Output is restricted to the existing `safeInventorySummary()` numeric counts plus aggregate source-object/event counts, `providerCalls: 0`, and `productionWrites: 0`. Artist names, recording titles, timestamps, object paths, tokens and Worker endpoint are not logged by this entrypoint. Unknown CLI options such as write/provider flags are rejected.

The entrypoint has been tested only with synthetic injected source/client data. It has not been invoked against the private production vault.

## Synthetic workflow

`.github/workflows/listening-maintenance-dry-run.yml` remains manual-only, main-only and defaults to disabled. It has read-only repository permissions and receives no repository secrets. Its only action is running `scripts/listening-maintenance-dry-run.js`, which uses fictional bands, tracks, provider IDs and fake provider responses.

The workflow cannot read the production Worker, production R2, Spotify, MusicBrainz or ListenBrainz. The maintenance client/provider/persistence and gated production-inventory modules are exercised only through unit/integration tests with fake transports.

## Version

Build C is one architectural build. `APP_VERSION`, `CACHE_NAME_LITERAL` and `LIVEVAULT_BUILD_STATE.json` remain synchronized at v109. These focused continuation commits do not bump the version again.

## Production boundary

This branch does not:

- create or configure `DATA_MAINTENANCE_TOKEN` anywhere;
- add repository secrets to a workflow;
- dispatch the synthetic workflow;
- execute the gated production inventory;
- read or write production R2 during development/QA;
- call Spotify, MusicBrainz or ListenBrainz;
- write production `apiUsage.json`, Spotify metadata or track identities;
- add a scheduled maintenance workflow;
- activate a backfill or recurring enrichment run.

The next rollout action is separately gated: after this code is reviewed/merged, the aggregate-only production inventory may be run only with explicit private-read authorization. Its counts should be reviewed before adding or activating any bounded provider-enrichment production mode. Secret creation, real provider calls and production R2 writes each remain separate authorizations even after this code is merged.
