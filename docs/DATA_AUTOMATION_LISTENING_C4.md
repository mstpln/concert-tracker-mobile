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
9. Only for current tier B/C items whose authoritative catalogue route is exhausted with `catalogue_no_match` or `catalogue_release_mismatch`, plan a bounded ListenBrainz metadata batch through the C2 bridge planner.
10. Accept ListenBrainz rows only when they map uniquely to a planned artist/recording request (using release text only to disambiguate duplicate artist/title requests) and then pass the row through the existing trusted-artist/exact-text ListenBrainz outcome validator.
11. Persist accepted derived identity outcomes conditionally, recompute and continue.

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

The run repeatedly reconstructs C2 evidence, applies deterministic local results, refreshes the next required artist catalogue, and uses bounded ListenBrainz batches only after authoritative catalogue exhaustion. It stops when eligible work is exhausted, only deferred-provider work remains, a global safety condition occurs, or the 50,000-provider-operation emergency ceiling is reached.

The 50,000 limit is a runaway guard, not an operator batching model.

## ListenBrainz batch acceptance

The C3 adapter permits at most 100 planned requests in one authenticated POST. C4 does not rely on response-array position as identity. Each returned row must uniquely correspond to one planned normalized artist/recording request. If several planned requests share artist/title, exact normalized release text may disambiguate when the returned row also contains release text. Otherwise the row is left unmapped rather than guessed.

A mapped row is still not authority by itself: it must pass the existing `listenbrainzOutcome()` trusted MusicBrainz artist and exact normalized artist/recording checks. Missing/unmapped rows become conservative no-match outcomes for those explicitly widened requests. Mismatches remain review/quarantine work and malformed evidence remains fail-closed.

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

No repeated manual batch ladder is part of the rollout.

## Validation

C4 synthetic QA covers:

- C2 evidence-tier reuse and durable-hold preservation;
- grouping many track keys under one trusted artist catalogue;
- zero Spotify core calls;
- local resolution only from authoritative dual-scope catalogue state;
- bounded ListenBrainz widening only after authoritative exhaustion;
- conservative non-positional ListenBrainz response mapping;
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
