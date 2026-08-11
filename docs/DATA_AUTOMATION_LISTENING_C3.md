# Data Automation — Listening C3 Catalogue Acquisition and Durable Cache

## Scope

Build C3 connects the merged C2 catalogue-first resolver foundation to safe provider adapters and a durable, resumable MusicBrainz catalogue cache. It remains production-inert: no live provider call, production R2 write, deployment, production workflow, historical backfill, or six-hour schedule is activated by this build.

The production catalogue object is exactly `listening/musicbrainz-catalogue.json`. It is derived provider data, not user-owned data, and is rebuildable from trusted MusicBrainz artist identities.

## MusicBrainz acquisition

C3 adds a release-browse adapter for the two C2-required coverage scopes:

- `release_artist` -> MusicBrainz release browse by `artist=<trusted artist MBID>`;
- `release_track_artist` -> MusicBrainz release browse by `track_artist=<trusted artist MBID>`.

Requests use JSON, a meaningful BANDMARKR User-Agent, a maximum page size of 100, the release includes required by the C2 parser (`recordings`, `release-groups`, and `artist-credits`), the existing UsageTracker reservation boundary, and a conservative 2-second minimum MusicBrainz gap. There is no hidden generic retry. Network failures, timeouts, HTTP 429, and HTTP 503 return a retry/defer outcome and preserve the last durable safe checkpoint.

Every provider page is normalized by the merged C2 parser. C3 does not introduce a second provider-normalization contract.

## Independent scope checkpoints

Each artist cache row stores independent `scopeCheckpoints` for `release_artist` and `release_track_artist`. Each scope contains its own sequential C2 release-browse slice with:

- `nextOffset`;
- `totalCount`;
- `complete`;
- cumulative unique `releaseMbids`;
- normalized recording rows and release provenance.

A safe provider page is merged into only its matching scope checkpoint and persisted before the next page is attempted. Variable MusicBrainz page sizes therefore resume from the actual number of returned release rows rather than from a fixed requested page size.

The artist-level `recordings` and `releaseMbids` are a deterministic union of the stored scope checkpoints. A release or recording present in both scopes is deduplicated using the C2 recording/release identity rules. Contradictory repeated recording identity or artist-credit membership fails closed.

`coverageScopes` is derived only from completed scope checkpoints. A partial or single-scope artist never carries complete artist-level pagination fields. Only when both scopes are complete does C3 create the flattened C2-compatible authoritative snapshot (`complete`, `nextOffset`, `totalCount`) over the deduplicated union and set both C2 coverage markers.

## Freshness and restart

The approved freshness interval is 30 days and is demand-driven. C3 exposes a freshness decision for one trusted artist; it does not scan or refresh every artist on a timer.

A missing, partial, or expired artist catalogue is eligible for refresh. Starting a refresh clears the old derived scope assembly for that artist before new pages are mixed in. This means a stale snapshot does not remain automatic uniqueness/no-match authority while replacement acquisition is incomplete. Existing already-persisted exact track identities are not changed by C3.

If MusicBrainz changes the declared total during an unfinished scope, C3 fails closed, starts a clean artist refresh state, persists that restart checkpoint, and returns control to the caller rather than silently combining inconsistent provider snapshots.

## Durable persistence and concurrency

The catalogue cache uses the C2 root contract:

- `kind: "livevault-musicbrainz-catalogue-cache"`;
- `schemaVersion: 1`;
- `artists` keyed by lowercase trusted artist MBID.

C3 adds scope-checkpoint and freshness fields additively. Unknown future root/artist/recording/release fields are preserved by compatible C2 merges and by catalogue persistence that replaces only the intended artist row.

The absolute serialized object ceiling is 25 MiB. Additional structural ceilings are intentionally conservative and finite:

- maximum 5,000 artist rows;
- maximum 100,000 release rows per scope checkpoint;
- maximum 50,000 recording rows per artist/scope;
- maximum 1,000 release relations per recording.

Persistence uses the existing conditional Worker client. Creation requires `If-None-Match: *`; replacement requires the current ETag. A stale ETag may be reconciled once only when the same artist row is unchanged and the conflict is therefore an unrelated catalogue update. If the target artist changed concurrently, persistence stops with a catalogue-artist conflict and requires a reread/replan.

There is no destructive migration because no production C3 catalogue object exists yet. Missing object means an empty derived cache. Unsupported or malformed schema fails closed. Rollback is to stop using/rebuild the derived catalogue object; immutable listening source observations and existing durable track-identity decisions are unaffected.

## Worker boundary

The Cloudflare Worker allowlists exactly `listening/musicbrainz-catalogue.json`. The route is available only to the data-maintenance role and only for GET/PUT. Browser, automation, legacy, read-only smoke, ticket, and arbitrary neighboring paths do not gain catalogue access.

PUT requires JSON, the 25 MiB ceiling, strict known-shape validation, and a conditional write. The Worker validates trusted artist keys, supported scope names, independent checkpoint consistency, bounded release/recording structures, derived coverage markers, and complete-state freshness fields. It does not expose a general storage API.

Merging the C3 branch is not deployment approval. The Worker change must not be deployed until separately authorized.

## Dormant ListenBrainz batch adapter

C3 includes the provider half of the C2 batch bridge without activating it. The adapter accepts at most 100 already-planned items, sends one authenticated POST to ListenBrainz metadata lookup, and carries artist/recording plus optional release text from the C2 planner. Missing credentials, malformed batches, network failures, provider throttling, and malformed JSON fail closed.

The adapter is not connected to the v111 historical backfill or to a schedule in C3. Future activation must still apply the C2 trusted-artist/current-result acceptance rules before any returned identity can be persisted.

## Durable holds and ownership

C3 does not reopen, migrate, clear, or reinterpret existing durable root/provider `needs_review`, `retry`, `error`, or `no_match` states. The merged C2 routing-hold rules remain authoritative. User-owned fields, reviewed identity decisions, immutable source observations, unknown future fields, and provider ownership boundaries remain unchanged.

## Diagnostics

C3 diagnostics are aggregate only: artist counts, complete/partial counts, recording counts, release counts, provider outcome/retry reason codes, and call counts. They must not include track keys, artist names, recording titles, release titles, tokens, URLs, raw provider payloads, or listening timestamps.

## Production boundary

C3 contains production-capable code paths but activates none of them. Development and QA use synthetic fixtures, mocked providers, and fake Worker/R2 state only.

C3 does not:

- call live MusicBrainz, ListenBrainz, or Spotify;
- write production R2;
- deploy the Worker;
- enable or create the six-hour maintenance schedule;
- run a production workflow;
- resume, replace, or start the historical production listening backfill.

Build C4 remains the separately authorized production activation/backfill slice.

## Version

C3 adds a reviewed Worker/storage architecture and therefore bumps both `APP_VERSION` and `CACHE_NAME_LITERAL` exactly once to `v112`.

## Validation

C3 validation is synthetic/fake-backend only and includes:

- correct MusicBrainz browse parameters for both required scopes;
- conservative provider failure/defer handling with no hidden retries;
- independent multi-page/multi-scope checkpoints;
- cross-scope release/recording deduplication;
- no authority from missing, partial, or single-scope state;
- 30-day demand freshness and clean refresh restart;
- total-count drift restart;
- strict structural and 25 MiB persistence bounds;
- conditional create/update and one unrelated ETag reconciliation;
- same-artist ETag conflict rejection;
- exact Worker route and data-maintenance-only permissions;
- bounded authenticated ListenBrainz POST adapter;
- aggregate-only diagnostics;
- existing C2 resolver/hardening regression suite;
- full repository unit/safety, syntax, version/cache, workflow, Cloudflare configuration, fixture, deterministic build-state, desktop Chromium, and mobile Chromium QA.
