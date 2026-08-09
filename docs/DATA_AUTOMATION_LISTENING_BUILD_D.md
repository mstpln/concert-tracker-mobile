# Data Automation — Listening Build D

## Scope

Build D is the controlled production backfill phase for historical listening enrichment.

Build C completed the production-readiness path and the authorized aggregate-only production inventory. That inventory read 250,801 private listening events, mapped 72,145 events to current BANDMARKR bands, found 12,123 unique-track work items, and reported 12,026 tracks needing Spotify metadata, 22 tracks eligible for ListenBrainz fallback, 75 tracks already complete from source recording identity, zero blocked tracks, zero unusable events, zero provider calls and zero production writes.

The first Build D code slice does **not** execute that backfill. It adds a production entrypoint around the already-reviewed Build C runner with an intentionally tiny rollout ceiling and separate provider/write authorization gates.

## Initial rollout ceiling

`scripts/listening-backfill-production.js` defaults to one provider step and hard-caps the initial Build D rollout at five provider steps per invocation.

The CLI accepts only:

- `--execute`
- `--write`
- `--max-steps <1..5>`
- `--help`

Any larger batch or unknown mode is rejected before private reads, provider setup or production writes.

This five-step ceiling is a rollout safety limit, not a provider quota. Changing it requires a later reviewed Build D change after controlled production results have been inspected.

## Dual production authorization

A real Build D invocation requires all of the following:

1. `--execute`;
2. `--write`;
3. `LIVEVAULT_LISTENING_BACKFILL_CONFIRM=I_AUTHORIZE_BOUNDED_LISTENING_PROVIDER_ENRICHMENT`;
4. `LIVEVAULT_LISTENING_WRITE_CONFIRM=I_AUTHORIZE_DERIVED_LISTENING_WRITES`.

The maintenance Worker URL and `DATA_MAINTENANCE_TOKEN` are then required for the existing least-privilege Worker client.

The separate exact values distinguish authorization to consume provider quota from authorization to write the derived maintenance state required for safe progress. Provider execution cannot be enabled in a read-only mode because Build C deliberately persists provider usage before the provider request.

## Provider credentials

Spotify exact-track enrichment uses the existing app-only Client Credentials environment contract:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

The access token is acquired lazily only if the bounded planner reaches a Spotify step and is cached only for the process lifetime.

MusicBrainz requires no secret and continues using the reviewed meaningful User-Agent and maintenance pacing.

ListenBrainz fallback remains later in the evidence ladder and resolves `LISTENBRAINZ_USER_TOKEN` lazily only if a bounded run actually reaches a ListenBrainz step.

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

After provider quota has been durably reserved in `apiUsage.json`, Build D rechecks `bands.json` again and reruns the Build C preflight against the exact same planned metadata/identity snapshot. A concurrent change to bands, Spotify metadata or track identities therefore stops before the external provider request. The already-persisted quota reservation may conservatively over-count an aborted attempt, but stale derived data is not written and quota accounting is never erased.

Synthetic regression coverage exercises changes both before quota reservation and after quota persistence. In both cases provider execution and derived persistence remain at zero.

## Safe output

The production entrypoint logs only aggregate source counts, aggregate inventory counts, the selected maximum step count, aggregate attempted/persisted/halt information and the count-only final plan.

It does not log artist names, recording titles, raw timestamps, listening object paths, Worker endpoint, provider tokens or secret values.

## Provider documentation review

Before this Build D slice, the official provider contracts were rechecked. Spotify's Track response continues to expose ISRC under external IDs. MusicBrainz continues to require responsible request pacing and a meaningful User-Agent. ListenBrainz metadata lookup continues to require token authorization and exposes dynamic rate-limit information through response headers.

No provider cap or pacing setting is changed by this slice.

## Version

Build D is a new architectural phase. `APP_VERSION`, `CACHE_NAME_LITERAL` and generated build state move together from v109 to v110 exactly once. Focused corrections to this same unreleased Build D slice remain v110.

## Production boundary

Creating and merging this Build D entrypoint does **not** authorize a real backfill invocation.

This development slice does not:

- call Spotify, MusicBrainz or ListenBrainz;
- write production `apiUsage.json`, Spotify metadata or track identities;
- read the private production vault during automated QA;
- add a scheduled enrichment workflow;
- add production provider secrets to GitHub;
- modify immutable source observations;
- remove or widen existing provider/data safety rules.

The first real Build D invocation remains separately authorized after this code is reviewed and merged. The recommended first live invocation is one provider step, not the five-step maximum.
