# Data Automation — Listening C4 Catalogue-First Historical Activation

## Scope

Build C4 connects the merged C2 resolver and C3 catalogue acquisition/cache to a new catalogue-first historical production orchestrator. The code is production-capable but production-inert: merging C4 does not authorize a production read, provider call, Worker deployment, R2 write, schedule, workflow or historical backfill.

C4 replaces the historical execution strategy, not the underlying evidence contracts. It keeps the immutable listening source archive unchanged, preserves all user-reviewed and unknown future fields, and does not reopen existing durable root/provider `needs_review`, `retry`, `error`, or `no_match` states.

`APP_VERSION` and `CACHE_NAME_LITERAL` remain synchronized at v112 because C4 changes Node maintenance orchestration only. No PWA shell, Worker route, storage schema or service-worker behavior changes.

## Catalogue-first architecture

The C4 historical path is:

1. Load bands, immutable Spotify/ListenBrainz source observations, existing derived track identities and existing Spotify metadata used only as already-stored inventory evidence.
2. Build the C2 catalogue evidence tiers unchanged.
3. Group eligible tier B/C work by trusted MusicBrainz artist MBID.
4. Reuse a fresh authoritative C3 catalogue when present; otherwise resume or refresh that artist through the independent `release_artist` and `release_track_artist` checkpoints.
5. Persist every safe MusicBrainz catalogue page before another page request.
6. Run the C2 local catalogue resolver against authoritative dual-scope catalogue state.
7. Persist deterministic local recording resolutions through the existing additive `listening/track-identities.json` identity merge contract.
8. Recompute current evidence after durable identity writes.
9. Only for current tier B/C items whose authoritative catalogue route is exhausted with `catalogue_no_match` or `catalogue_release_mismatch`, plan the next ListenBrainz metadata lookup through the C2 bridge planner.
10. Execute exactly one widened work item per ListenBrainz provider operation. The returned row belongs to that sole originating request by construction; C4 never uses response order or returned display text to decide which work item the row belongs to.
11. Pass that single returned row through the existing `listenbrainzOutcome()` trusted-artist and exact normalized artist/recording validator before any durable identity update. Provider text differences, trusted-artist mismatches or other identity conflicts remain conservative `needs_review`/error outcomes rather than guessed resolutions.
12. Persist accepted derived identity outcomes conditionally, recompute and continue.

Spotify is not a C4 core recording-identity provider. C4 makes zero Spotify provider calls for historical recording resolution. Existing exact Spotify IDs/metadata may remain stored evidence or presentation metadata, and the C2 zero-call URL helper remains unrelated to recording authority.

## Resumability

C4 does not maintain a giant track cursor. Durable truth is reconstructed from:

- the immutable listening source manifest and objects;
- C3 artist catalogue checkpoints in `listening/musicbrainz-catalogue.json`;
- completed/held track states in `listening/track-identities.json`;
- persisted UsageTracker state and aggregate maintenance diagnostics.

A process interruption after a MusicBrainz page write resumes from the persisted scope offset. A process interruption after an identity write recomputes and skips that completed work. Rerunning is therefore idempotent with respect to already-durable catalogue pages and resolved/held identities.

## Operational modes

The only C4 production entrypoint is `scripts/listening-catalogue-backfill-production.js`.

### `--plan-only`

Read-only production planning requires only the existing explicit private-listening-read authorization plus `--execute`. It refuses `--write`, does not construct provider adapters, does not read the C3 catalogue object, and emits aggregate source/inventory/evidence counts only. Provider calls and production writes are both zero.

The plan reports tier A/B/C/E counts, eligible track count, distinct trusted MusicBrainz artist count, durable-hold count, artist-untrusted count and zero Spotify core calls. It deliberately does not claim a final tier-D workload because ListenBrainz eligibility exists only after authoritative catalogue exhaustion.

### `--proof`

The later small live infrastructure proof requires separate exact provider, write and proof authorizations plus `--execute --write`. It is fixed to one eligible artist and at most two MusicBrainz release-page requests.

The proof:

- reads the C3 catalogue route first, proving the maintenance permission/route exists;
- selects one eligible artist without logging its identity;
- performs at most one C3 page acquisition;
- rereads the catalogue from the Worker;
- performs at most one further C3 page acquisition from the persisted checkpoint;
- rereads again and runs the C2 local resolver;
- writes no track identity, calls no ListenBrainz endpoint and calls no Spotify endpoint.

A partial two-page result is valid proof output and remains non-authoritative for identity, demonstrating safe checkpoint/resume behavior rather than attempting to prove the whole historical dataset.

### `--full`

The later full run requires separate exact provider, derived-write and full-backfill authorizations plus `--execute --write`. One invocation keeps processing safe work without a manual 5/25/100/500/1000 ladder.

The run repeatedly reconstructs C2 evidence, applies deterministic local results, refreshes the next required artist catalogue, and uses one-item ListenBrainz lookups only after authoritative catalogue exhaustion. It stops when eligible work is exhausted, only deferred-provider work remains, a global safety condition occurs, or the 50,000-provider-operation emergency ceiling is reached.

The 50,000 limit is a runaway guard, not an operator batching model. Each ListenBrainz lookup now consumes one provider operation and one UsageTracker reservation; no provider or UsageTracker limit is increased by this correction.

## ListenBrainz single-item acceptance

The C3 adapter remains capable of the provider's bounded metadata POST shape, but C4 production execution deliberately supplies exactly one planned work item per provider call. This removes the multi-request correlation problem discovered during the first live historical backfill: ListenBrainz does not guarantee that returned display text echoes submitted text exactly, and C4 does not rely on response-array position.

For a C4 production lookup:

- exactly one request item must be planned;
- exactly one response row must be returned;
- a missing, extra, malformed or non-object response row fails closed before any identity persistence;
- the sole row is associated with the sole originating work item by construction, not by response position among multiple requests and not by comparing release text;
- `listenbrainzOutcome()` still independently requires the trusted MusicBrainz artist MBID, valid provider MBIDs, and exact normalized artist/recording identity before a resolved result is accepted;
- returned text that differs from the request does not become a guessed resolution; it remains `needs_review` under the existing identity-validation contract.

The previous multi-item response-correlation helper is therefore no longer part of production execution. Durable holds, item quarantine, unknown-field preservation and fail-closed persistence semantics are unchanged.

## Safety boundaries

Global stops include:

- unconfirmed/failed identity or catalogue persistence;
- same-artist catalogue ETag conflict;
- track-identity concurrency conflict;
- bands changing after inventory load;
- immutable listening manifest changing after source load;
- malformed persisted identity/catalogue state;
- catalogue checkpoint/assembly/integrity conflict;
- missing required configuration or authorization;
- UsageTracker denial or failure to persist usage before a provider call;
- unexpected C4 invariant failure;
- non-transient provider/configuration failures.

MusicBrainz or ListenBrainz 429/503, network failure and timeout are provider-specific transient conditions. The affected provider is deferred for the rest of that invocation; completed durable work remains intact and other provider-independent work may continue. A deferred provider is never called again in the same invocation.

Existing durable `needs_review`, `retry`, `error`, and `no_match` states are never reopened by C4. New ambiguous or mismatching item evidence remains item quarantine and does not stop unrelated safe work.

All diagnostic output is aggregate-only. It may contain counts, provider names, controlled reason codes and retry timing, but never track keys, artist names/MBIDs, recording/release titles, URLs, tokens, raw provider payloads or listening timestamps.

## Retired v111 execution paths

The old Spotify-first production entrypoints `scripts/listening-backfill-production.js` and `scripts/listening-backfill-bulk.js` remain available as importable historical helper modules for regression coverage but refuse direct command-line execution after C4. Historical production execution must use the C4 entrypoint.

The reusable concepts retained from the old bulk path are explicit authorization gates, UsageTracker-before-provider durability, conditional writes, provider deferral, aggregate diagnostics and the 50,000-operation runaway ceiling. Its Spotify-first track-by-track provider planner is not used by C4.

## Production rollout

C4 development and QA use synthetic fixtures/fake Worker state only.

After C4 is merged, production remains stopped. The separately authorized sequence is exactly:

1. **Read-only production plan** — inspect only aggregate backlog/evidence counts; zero provider calls and zero writes.
2. **Required Worker deployment + one small live plumbing proof** — separately authorize deployment of the already-reviewed C3 Worker route if still required, then prove one artist / at most two MusicBrainz pages, catalogue creation/update, ETags, durable reread and resume.
3. **Full resumable historical run** — only after the proof is inspected and separately authorized.

The first live full-run attempts exposed a ListenBrainz multi-item correlation stop without writing the unsafe response. Production backfill remains paused while the focused v112 single-item correction is reviewed. Resuming production after that correction is merged requires a new, separate authorization.

No repeated manual batch ladder is part of the rollout.

## Validation

C4 synthetic QA covers:

- C2 evidence-tier reuse and durable-hold preservation;
- grouping many track keys under one trusted artist catalogue;
- zero Spotify core calls;
- local resolution only from authoritative dual-scope catalogue state;
- bounded ListenBrainz widening only after authoritative exhaustion;
- exactly one ListenBrainz work item per provider operation;
- response association by sole originating request rather than multi-request text/order correlation;
- the production-discovered returned-text mismatch remaining `needs_review` rather than becoming a guessed identity;
- malformed/missing/extra ListenBrainz response rows failing before identity persistence;
- UsageTracker and provider-operation accounting once per one-item ListenBrainz lookup;
- additive identity persistence and unknown-field preservation through the existing merge contract;
- fixed proof scope of one artist / maximum two MusicBrainz page requests;
- read-only mode refusing writes and not constructing provider adapters;
- separate proof/full authorization gates;
- provider-specific transient deferral and global safety-stop semantics;
- one-command processing beyond ordinary historical batch sizes;
- aggregate-only diagnostics;
- retirement of direct old Spotify-first production execution;
- unchanged v112 app/cache synchronization and deterministic build state;
- full repository PR QA with synthetic desktop and mobile Chromium coverage.
