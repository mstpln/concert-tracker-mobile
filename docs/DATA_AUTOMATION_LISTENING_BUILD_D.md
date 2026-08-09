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

The bulk runner executes the existing maintenance runner in internal chunks of at most 100 provider steps. A `batch_limit` after a durable 100-step chunk is the normal internal continuation point.

Bulk maintenance now scopes a provider result to one of three safety boundaries instead of adding one-off exceptions for individual error strings:

- **Item-scoped:** an otherwise successful provider response contains invalid or contradictory data for that item, or the adapter reports invalid input. The derived item is persisted in its existing terminal/quarantined state and unrelated work continues. No invalid provider field is guessed or salvaged.
- **Provider-scoped:** the provider adapter fails, the network/transport/HTTP/auth layer fails, or the provider explicitly reports a provider-wide halt such as quota exhaustion. The current track is left unmodified, that provider is deferred for the remainder of the invocation, and eligible work through other providers may continue. The deferred provider is not called again in the same invocation.
- **Global safety:** missing provider configuration caught before a call, UsageTracker denial, stale/concurrent production state, failed or non-confirmed persistence, or a thrown data-safety check still stops the entire process immediately.

A persisted `needs_review` result remains item-scoped in bulk mode: that individual work item is quarantined in its review-required identity state and excluded from further automatic routing while unrelated work continues. The focused 1–5 step production entrypoint still halts on `needs_review` for diagnostics.

A persisted track-level `retry` retains its provider-owned retry state and `nextEligibleCheckAt`. In bulk mode the retrying provider is then deferred for the rest of that invocation. The focused 1–5 step production entrypoint keeps the original stop-on-retry default.

The deferred-provider set is carried across internal 100-step chunks. If all remaining currently planned work belongs to deferred providers, the invocation stops safely with `provider_deferred:<provider[,provider...]>`. If no provider step is currently eligible but dated retry state remains, the final summary reports `retry_wait`. There is no hidden retry loop and a deferred provider is never probed again during the same invocation.

The bulk process has a separate hard ceiling of 50,000 provider steps per invocation. This is sized above the current 12,000-track inventory because a track can require Spotify, then MusicBrainz, then ListenBrainz. It is a runaway guard, not a promise that providers will allow that many calls.

The Spotify app-only access token is refreshed after at most 45 minutes of reuse so a multi-hour process does not depend on one short-lived token. This refresh changes no track identity and does not weaken the provider gates.

A structured Spotify 429 `QUOTA_EXCEEDED` response is provider-scoped in the full bulk path. Usage has already been durably reserved before that request, but the current work item remains incomplete and unmodified, Spotify is deferred for the remainder of that invocation, and work through other provider families may continue. A later separately authorized invocation can therefore retry the same Spotify track instead of silently losing it.

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

The four persisted steps remain durable and source observations were not changed. The early stop demonstrated that treating every review-required track as a process-wide halt would make a large historical migration unnecessarily interactive, even though the ambiguous track itself had already been safely quarantined.

## Second bulk production invocation and transient MusicBrainz correction

After the review-quarantine correction merged through PR #99, the separately authorized bulk run was resumed from the durable production state. That invocation attempted and persisted 97 provider steps before stopping safely on `musicbrainz:error`.

Aggregate state after the stop was:

- complete tracks: 115;
- Spotify backlog: 11,977;
- no-route/review-required: 9;
- remaining planned work: 11,999;
- blocked tracks: 0;
- retry-wait tracks: 0.

No rollback is required; all 97 persisted steps remain durable and source observations remain unchanged.

Inspection found that the maintenance MusicBrainz adapter treated transient provider/transport failures too strictly. A MusicBrainz `429` or `503` became retryable only when a usable `Retry-After` header was present, while a missing header, network failure or timeout became terminal `error`. Because the enrichment state machine excludes terminal errors from automatic routing, a temporary provider outage could both stop the bulk process and permanently remove that track from automatic retry.

PR #100 corrected MusicBrainz transient-failure classification and narrowly repaired legacy state created by the old policy:

- `404` remains a legitimate no-match and follows the existing fallback path;
- `429` and `503` preserve a usable provider `Retry-After` when present;
- `429` and `503` without a usable `Retry-After` become a dated retry with a conservative 30-minute delay;
- MusicBrainz network and timeout failures become the same conservative dated retry;
- malformed JSON and other non-transient HTTP/data failures remain terminal `error`;
- the retry state is durably persisted before further work;
- a legacy record is eligible for one-time conversion only when it is still validated current inventory work, remains identity-compatible with that work, retains a usable MusicBrainz route (valid ISRC plus trusted MusicBrainz artist), has root status `error`, and has a MusicBrainz provider `error` reason of `http_429`, `http_503`, or `musicbrainz_network_error` with a valid original `checkedAt`; eligible records become `retry` with `nextEligibleCheckAt` set to the original `checkedAt` plus 30 minutes;
- orphaned, blocked, complete, incompatible, non-routable, non-transient or incomplete error records are left unchanged;
- legacy recovery is bulk-only and preserves unrelated/unknown fields and other provider observations;
- any legacy recovery is durably written through a strict identity-only conditional write before provider usage is reserved or a provider request is made. A concurrent identity change aborts the correction and the run before provider execution.

Spotify and ListenBrainz adapter behavior was unchanged by PR #100.

## Third bulk production invocation and retry-provider deferral

After PR #100 merged as `c5396c6449ae18471d66f210b3cf7d3206562c1e`, the user separately authorized another full production backfill attempt.

That invocation attempted and persisted 118 provider steps before stopping safely on `musicbrainz:retry`. Aggregate state after the stop was:

- complete tracks: 164;
- Spotify backlog: 11,922;
- no-route/review-required: 14;
- remaining planned work: 11,944;
- blocked tracks: 0;
- retry-wait tracks: 1.

No rollback is required; all 118 persisted steps remain durable and source observations remain unchanged. The result confirmed that the PR #100 correction worked as intended: the transient MusicBrainz condition became durable retry state instead of a terminal poisoned track.

PR #101 then generalized that retry operation in bulk mode: the retrying item is persisted first, the retrying provider is deferred for the remainder of the invocation, and eligible work for other providers may continue. Deferral is carried across internal chunks and the focused diagnostic entrypoint remains fail-fast.

## Fourth bulk production invocation and generalized outcome policy

After PR #101 merged as `c40e404bcdf968178e76f2600727c80ae523d035`, the user separately authorized another full production attempt.

The invocation attempted and persisted 52 provider steps. MusicBrainz was deferred during the run and the process continued with other provider work, confirming the PR #101 behavior in production. It later stopped on `spotify:error`. Aggregate state after the stop was:

- complete tracks: 164;
- Spotify planned steps: 11,871;
- MusicBrainz planned steps: 50;
- ListenBrainz planned steps: 22;
- total planned steps: 11,943;
- no-route/review-required: 15;
- blocked tracks: 0;
- retry-wait tracks: 1.

All 52 persisted steps remain durable and source observations remain unchanged. No rollback is required.

A separately run read-only derived-state inspection showed that the latest Spotify terminal reason was `malformed_spotify_isrc`, checked at `2026-08-09T16:18:29.192Z`. This was not evidence of a broken Spotify connection: many immediately preceding Spotify requests had succeeded. One otherwise successful track response contained an ISRC that failed the strict validator.

PR #102 replaces further one-off stop exceptions with the generalized item/provider/global policy described above. Under this policy:

- the existing `malformed_spotify_isrc` record remains safely quarantined and need not be rewritten;
- future malformed successful payloads affect only their own item and do not stop unrelated work;
- raw provider failures and explicit provider-wide halts do not mutate the current track into terminal error;
- a provider-scoped failure defers only that provider for the current bulk invocation while other provider families may continue;
- dated retry state remains durable and authoritative;
- missing configuration, UsageTracker denial, stale/concurrent state, persistence failure and data-safety exceptions still stop globally;
- focused 1–5 step diagnostics keep their strict fail-fast defaults.

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

Spotify still uses the existing UsageTracker accounting and pacing, and its provider response remains authoritative. Spotify Development Mode does not publish a stable numeric account quota; rate-limit/quota responses are handled conservatively without guessing an allowance. In bulk mode an explicit provider-wide stop defers Spotify for the remainder of that invocation rather than allowing another Spotify request.

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

The bulk runner additionally emits count-only progress after each durable internal chunk, including the deferred-provider list, so a long local process can be observed without exposing listening details.

Neither entrypoint logs artist names, recording titles, raw timestamps, listening object paths, Worker endpoint, provider tokens or secret values.

## Provider documentation review

Before Build D, the official provider contracts were rechecked. Spotify's Track response continues to expose ISRC under external IDs. MusicBrainz continues to require responsible request pacing and a meaningful User-Agent. ListenBrainz metadata lookup continues to require token authorization and exposes dynamic rate-limit information through response headers.

Before v111 bulk rollout, Spotify's current Development Mode quota documentation was rechecked again. Development Mode uses an unpublished, changeable per-developer-account quota in addition to rolling rate limits. The runner therefore cannot safely infer a numeric Spotify allowance and must continue to stop or defer conservatively based on the reviewed provider result rather than inventing an allowance.

## Version

Build D began at v110. The v111 bulk runner is an architectural extension because it changes the production operating mode from tiny diagnostic invocations to one resumable long-running process. `APP_VERSION`, `CACHE_NAME_LITERAL` and generated build state moved together to v111 exactly once. The review-quarantine, MusicBrainz transient-retry, retry-provider-deferral and generalized outcome-scope changes are focused corrections to the same operational build and therefore keep v111.

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

The three one-step Build D production validations and four separately authorized bulk invocations were production actions. Any resumed bulk invocation remains separately authorized after the focused correction is reviewed and merged.
