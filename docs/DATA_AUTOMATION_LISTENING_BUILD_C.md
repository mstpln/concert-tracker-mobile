# Data Automation — Listening Build C

## Scope

Build C starts the activation plumbing for historical listening enrichment without activating production enrichment.

This first v109 slice adds a bounded maintenance runner around the merged Build A inventory and Build B enrichment engine. The runner accepts provider adapters, an explicit usage gate, persistence preflight/callbacks and resumable checkpoint state. Automated validation uses fictional fixtures only.

## Execution contract

The runner:

1. asks the Build B planner whether safe provider work exists;
2. requires a persistence preflight to succeed before any provider usage reservation or provider adapter call;
3. asks the Build B planner for one safe next step;
4. requires the usage gate to reserve that provider call before invoking any adapter;
5. executes exactly that planned operation through an injected provider adapter;
6. validates the provider response through the Build B resolver;
7. merges only derived track identity and Spotify metadata state;
8. requires persistence of the resulting state before another provider call may start;
9. replans from the newly persisted logical state rather than assuming a fixed queue.

A batch defaults to 25 provider steps and has a hard code-level ceiling of 100. Invalid batch sizes fail before provider work.

## Checkpoint and resume behavior

The checkpoint records the logical run start/update time, completed operation keys and halt reason. Known checkpoint fields are bounded and type/date validated. It is audit/resume state, not an authority that can suppress an explicit Build B retry.

The provider state in `listening/track-identities.json` remains authoritative for retry eligibility. A `retry` result must carry a valid `nextEligibleCheckAt`; the batch persists that state and stops. A later invocation may retry the same provider only after Build B says the retry is due.

Persistence preflight failure aborts before provider quota is reserved. A persistence failure after a provider result aborts the batch before another provider adapter is invoked. The caller must treat the failed in-memory snapshot as uncommitted and reload durable state before resuming.

## Usage boundary

Every provider operation requires an injected usage gate. The runner cannot call a provider adapter without that gate approving the call.

This slice intentionally does not add live provider adapters or modify the shared `UsageTracker`/`apiUsage.json` contract. That avoids changing existing scheduled production research behavior before the dedicated maintenance usage/accounting design is separately reviewed. The future live adapter layer must route Spotify, MusicBrainz and ListenBrainz attempts through reviewed quota/pacing accounting before production activation.

Current provider documentation was rechecked during this build. MusicBrainz requires applications to stay at or below one request per second and use a meaningful User-Agent. ListenBrainz publishes dynamic rate-limit response headers and requires a user token for metadata lookup; a future client must respect those returned limits rather than inventing a provider quota.

## Synthetic workflow

`.github/workflows/listening-maintenance-dry-run.yml` is manual-only, main-only and defaults to disabled. It has read-only repository permissions and receives no repository secrets. Its only action is running `scripts/listening-maintenance-dry-run.js`, which uses fictional bands, tracks, provider IDs and fake provider responses.

The workflow cannot read the production Worker, production R2, Spotify, MusicBrainz or ListenBrainz.

## Version

Build C is an architectural build. `APP_VERSION`, `CACHE_NAME_LITERAL` and `LIVEVAULT_BUILD_STATE.json` are synchronized at v109. Focused corrections to this unreleased Build C branch keep v109.

## Production boundary

This slice does not:

- configure or read `DATA_MAINTENANCE_TOKEN`;
- change the shared Worker client or Worker allowlists;
- create a production maintenance checkpoint;
- read or write production R2;
- read the private production listening archive;
- call Spotify, MusicBrainz or ListenBrainz;
- modify `apiUsage.json`;
- add a scheduled maintenance workflow;
- activate a backfill or recurring enrichment run.

Live provider adapters, maintenance-specific UsageTracker integration, Worker persistence wiring and the first aggregate production inventory/dry run remain later Build C rollout steps and require separate review. Production data/provider execution remains separately authorized even after code is merged.
