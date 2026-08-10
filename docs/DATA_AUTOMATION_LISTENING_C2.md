# Data Automation — Listening C2 Catalogue Resolver Foundation

## Scope

Build C2 implements only the production-inert resolver redesign foundation from the BANDMARKR Data Automation Revised Master Build Plan v1.1.

It does not replace or activate the existing v111 production backfill entrypoints. No live provider adapter, Worker route, R2 catalogue cache, production write path, schedule, secret, workflow activation or production command is added by this slice.

## Architecture

The C2 path is additive beside the existing v111 planner:

1. Reuse the current immutable listening inventory and stable track keys.
2. Derive catalogue evidence without changing source events or existing durable identities.
3. Preserve durable routing holds before considering new automatic evidence. Existing root or provider `needs_review`, `retry`, `error`, and `no_match` states remain held as exception work in C2 rather than being silently bypassed by the new resolver. Malformed or unknown provider state is also held rather than interpreted optimistically.
4. Classify evidence conservatively:
   - **A** — already complete from an existing/source recording identity recognized by the current inventory contract;
   - **B** — trusted MusicBrainz artist + clean recording text + one compatible release evidence path, using an explicitly MusicBrainz-owned source release MBID when present and otherwise exactly one normalized release text;
   - **C** — trusted MusicBrainz artist + clean recording text with release evidence missing or text-only conflicting;
   - **D** — locally unresolved B/C work eligible for the future bounded ListenBrainz batch bridge;
   - **E** — blocked, malformed, held durable routing state, conflicting or malformed provider-owned release identity, artist-untrusted or conflicting lookup evidence.
5. Normalize synthetic MusicBrainz **release-browse** catalogue pages through a pure parser with explicit offset/count checkpoints, cumulative release-ID coverage and sequential merge rules.
6. Validate a versioned artist-MBID-keyed MusicBrainz catalogue-cache contract that distinguishes page-stream completion from authoritative whole-artist coverage.
7. Match locally using exact deterministic normalized recording text, the already trusted BANDMARKR MusicBrainz artist MBID and, for tier B, compatible release evidence.
8. Resolve only when the catalogue slice carries complete checkpoint proof **and** explicit coverage for both required MusicBrainz release scopes, with exactly one compatible recording MBID remaining.
9. Keep multiple compatible recording MBIDs ambiguous and out of the automatic batch bridge.
10. Recompute current local catalogue results before future ListenBrainz widening and reject supplied local results that no longer match the current evidence/catalogue state.
11. Plan only items with an explicit exhausted local `unresolved` result from the same current evidence tier for a bounded future ListenBrainz batch request.
12. Derive an exact Spotify track URL directly from an already trusted Spotify track ID without a Spotify request; this is presentation convenience only and never evidence of recording identity.
13. Expose aggregate-only feasibility diagnostics.

## Matching rules

- Trusted BANDMARKR MusicBrainz artist identity is mandatory for automatic catalogue resolution.
- Recording-title matching is exact after the project's deterministic normalization.
- Version qualifiers remain identity-significant because exact normalized text must match; `Song` does not match `Song (Live)`, `Song (Remix)`, and similar variants.
- Tier B additionally requires one compatible release relation. If immutable source evidence already contains one explicitly MusicBrainz-owned release MBID, the catalogue relation must contain that exact release MBID; matching release text cannot override a different trusted edition identity. A generic future `releaseMbid` field is not silently treated as MusicBrainz-owned. Without a trusted MusicBrainz release MBID, tier B requires one exact normalized release-title match.
- A malformed non-null `musicbrainzReleaseId` or `musicbrainzReleaseMbid` is explicit malformed provider-owned evidence and is quarantined as tier E rather than silently discarded in favor of text-only matching.
- Multiple trusted source MusicBrainz release MBIDs for the same work item are a conflict and remain tier E. A single trusted release MBID combined with conflicting release text also fails closed rather than choosing an interpretation.
- Tier C may resolve only when exact recording title plus trusted artist yields one unique recording MBID. Release identity is never inferred from ambiguous or missing release text.
- Multiple compatible recording MBIDs remain ambiguous.
- Existing durable `needs_review`, `retry`, `error`, and `no_match` state is not automatically reopened by C2, even when other source evidence would otherwise make the work item complete. A later C3/C4 recovery or migration rule must explicitly define which old states may be reconsidered and how protected review/retry ownership is preserved.
- Tier A is accepted only for the current inventory's known complete reasons (`existing_track_identity` or `source_recording_mbid`); a forged/unknown complete reason fails closed.
- Malformed known-provider containers/entries, unknown provider statuses and unknown provider namespaces are held rather than reinterpreted as fresh work.
- Invalid catalogue/evidence/result structures fail closed. Evidence and local-result track keys must be canonical non-empty strings without hidden leading/trailing whitespace. Duplicate evidence track keys, local-result keys, catalogue recording rows and per-recording release rows are rejected.
- If the same recording MBID appears again, its normalized artist-MBID membership must agree exactly with the existing row. Contradictory artist membership is a provider-evidence conflict and fails closed rather than being unioned into a broader credit.
- Completing one release-browse stream is **not** enough to claim that the trusted artist's recording catalogue is complete. A slice is authoritative only when it explicitly carries both `release_artist` and `release_track_artist` coverage markers in addition to complete pagination proof.
- A catalogue slice without complete checkpoint proof or without both required coverage markers is not authoritative enough to resolve identity. A later page or a different release scope could introduce another compatible recording, so partial uniqueness is never accepted.
- A future ListenBrainz batch candidate must have a corresponding local catalogue result whose status is explicitly `unresolved`, whose evidence tier still matches the current evidence item, and whose local reason proves the authoritative catalogue route is exhausted (`catalogue_no_match` or `catalogue_release_mismatch`). Missing catalogues, incomplete or partial-coverage catalogues, stale results, exceptions, complete, resolved, ambiguous and unknown unresolved reasons cannot be widened automatically.
- Unknown future fields already present in cache recording/release rows survive compatible page merges. Provider normalization remains allowlisted and does not copy arbitrary provider payload fields into cache rows.

## Pure MusicBrainz catalogue parsing

C2 includes only provider-payload normalization logic; it does not perform a MusicBrainz request.

The parser models the supported MusicBrainz release-browse response rather than assuming that a recording-browse response can contain release linkage. It accepts a trusted artist MBID plus a synthetic release-browse payload shaped around `release-count`, `release-offset` and `releases`. Release rows are expected to contain the media/track recording linkage requested by a future adapter with the supported release includes for recordings, release groups and artist credits.

The parser requires:

- integer `release-count` and `release-offset` values;
- the returned offset to equal the expected sequential offset;
- a non-empty page while the declared total still has unconsumed release rows;
- valid release and optional release-group MBIDs;
- media with complete track arrays and valid recording MBIDs, titles and artist-credit structures;
- only recordings whose recording artist credit contains the requested trusted artist MBID to enter that artist's catalogue slice; valid tracks by other artists are ignored rather than misattributed;
- no duplicate release row in one provider page;
- repeated recording MBIDs across multiple releases to be consolidated into one recording row with multiple release relations only when their recording identity and artist-credit membership agree.

MusicBrainz release paging can return fewer releases than the requested limit when a page contains many tracks. The normalized `nextOffset` therefore advances by the **number of release rows actually returned**, never by a fixed requested limit and never by the number of normalized recordings. Each normalized page also carries the exact release MBIDs represented by those release rows.

A pure cache merge accepts only the next sequential release page, rejects a total-count change mid-pagination, rejects a release MBID repeated across pages, and requires cumulative unique release-MBID coverage to equal the processed release offset. Every normalized recording relation must point to a release counted by that page/cache coverage, and a checkpointed release-browse recording cannot exist without release provenance. Repeated recording identities merge conservatively only when artist-credit membership remains consistent, existing unknown future cache fields survive compatible merges, and the combined cache is validated after every page. This proves the integrity and completion of that **page stream**; it deliberately does not claim whole-artist catalogue authority.

The C2 parser and page merge do not manufacture `coverageScopes`. Future C3 provider logic must explicitly prove and combine the required release scopes before a cache can be authoritative for local uniqueness or no-match conclusions. C2's required authority markers are `release_artist` and `release_track_artist`. C3 still owns the actual browse requests, any deduplication/assembly needed between those scopes, pacing, headers, freshness, restart behavior if the provider catalogue changes during a multi-page fetch, and persisted checkpoints.

## Catalogue cache contract

C2 defines the in-memory/synthetic contract only:

- `kind`: `livevault-musicbrainz-catalogue-cache`
- `schemaVersion`: `1`
- `artists`: object keyed by lowercase trusted artist MBID
- each artist stores its own `artistMbid` and a unique `recordings` array
- each recording stores `recordingMbid`, title, artist MBIDs and release rows when it belongs to a checkpointed release-browse slice
- release rows carry a MusicBrainz release MBID, optional release-group MBID and release title
- a cache slice created through the release-page parser identifies `sourceEntity: "release"`
- a release-browse artist slice carries normalized pagination fields `nextOffset`, `totalCount`, `complete`, plus cumulative unique `releaseMbids`; those fields must be mutually consistent
- optional `coverageScopes` contains only known scope names; the authoritative C2 set is exactly the two required scopes `release_artist` and `release_track_artist`
- pagination offsets count provider **release rows**, so they are intentionally independent of the number of normalized recording rows retained in the cache
- every recording release relation in a covered slice must refer to a release MBID represented by that slice's cumulative release coverage
- a repeated recording MBID must retain the same normalized artist-MBID membership across compatible page merges
- a slice may be used for automatic identity resolution only when `complete` is true, `nextOffset === totalCount`, cumulative release-MBID coverage proves the declared total, and both required coverage scopes are explicitly present
- a structurally valid cache with only one coverage scope remains non-authoritative; unknown scope names fail validation
- checkpoint-less artist snapshots may still be structurally validated for pure tooling compatibility, but they are non-authoritative for automatic resolution and cannot be extended through the sequential page merge API

Validation of a catalogue cache is performed once per multi-item evidence-resolution pass. Direct single-item resolution validates its input cache before matching. This keeps the safety contract while avoiding repeated whole-cache validation for every track in a large historical pass.

C2 intentionally does **not** decide the production R2 object name, object-size ceiling, pagination persistence mechanism, ETag write path, freshness/refresh policy or Worker allowlist. Those are C3 concerns and require separate review before production activation.

## Zero-call Spotify URL derivation

An already trusted Spotify track ID can be converted locally to `https://open.spotify.com/track/<id>` after the existing safe-ID validation. This makes no provider call and does not require Spotify authentication, quota or metadata lookup. It is an optional presentation link only: it cannot create or strengthen MusicBrainz recording/release identity, and malformed IDs yield no URL.

## ListenBrainz batch bridge planning

The C2 batch planner is pure and makes no request. It accepts only tier B/C items that have an explicit locally unresolved catalogue result from the same current evidence tier, trusted artist identity and clean artist/recording text. The local result must represent an exhausted **authoritative** catalogue route (`catalogue_no_match` or `catalogue_release_mismatch`). It emits a bounded list, hard-limited to at most 100 items per planned batch.

Before planning, the bridge recomputes catalogue resolution from the supplied current evidence and current catalogue cache. If a caller supplies previously computed local results, they must still match that recomputed track key, tier, status, reason and resolved MusicBrainz identity. A result produced from an older catalogue snapshot cannot be used to widen work after the current cache has changed.

The requested `maxItems` must be a positive integer. Values above 100 are conservatively capped at 100; zero, negative, non-integer or non-numeric values fail closed rather than silently widening or changing the caller's requested limit.

Items already resolved locally are excluded. Catalogue ambiguity is also excluded and remains exception/review work rather than being silently widened into another automatic route. Missing, checkpoint-less, incomplete or partial-coverage catalogue state is not considered exhausted and cannot widen into ListenBrainz. Items carrying a durable routing hold are likewise excluded. Missing, malformed, stale or unknown unresolved local-result documents fail closed rather than treating local resolution as skipped.

## Production boundary

This build makes zero live provider calls and zero production writes. It does not alter the current Spotify-first v111 production planner or authorize another historical backfill run. The existing production backfill remains stopped unless the user separately authorizes a future revised production proof after C3/C4 review.

## Version

This is pure Node maintenance tooling and documentation. The PWA shell is unchanged, so `APP_VERSION` and `CACHE_NAME_LITERAL` remain synchronized at v111.

## Validation

Synthetic unit coverage includes:

- tier A/B/C classification and tier-A complete-reason validation;
- clean, missing and conflicting release text evidence;
- explicitly MusicBrainz-owned source release-MBID matching, malformed owned-field quarantine, generic-field ownership protection and conflict quarantine;
- exact artist/recording/release resolution;
- durable root/provider `needs_review`, `retry`, `error`, `no_match`, malformed-provider, unknown-provider and complete-item hold preservation;
- version-qualifier mismatch;
- release mismatch and malformed tier-B evidence;
- duplicate and ambiguous recording/release candidates;
- repeated-recording artist-credit conflict rejection;
- tier C unique-title resolution;
- trusted-artist mismatch;
- supported MusicBrainz release-page normalization, variable release paging, sequential checkpoints, cumulative release-ID coverage, cross-page duplicate rejection, artist-credit boundaries, repeated-recording consolidation and total-count drift;
- rejection of uncounted release relations and checkpointed recordings without release provenance;
- incomplete, checkpoint-less and single-scope catalogue resolution blocking;
- validation of known coverage scopes and rejection of unknown coverage markers;
- canonical non-empty evidence/local-result track-key validation;
- cache-row unknown-field preservation across compatible merges;
- zero-call Spotify track URL derivation from an exact trusted ID;
- positive-integer batch-size validation and hard capping at 100;
- bounded tier D planning;
- requirement for explicit exhausted locally unresolved same-tier results before batch widening;
- recomputation/rejection of stale catalogue results before batch widening;
- exclusion of resolved, ambiguous, stale, incomplete-catalogue, partial-coverage, missing-catalogue, unknown-unresolved and held items from the bridge;
- malformed and duplicate cache/evidence/result-state failure;
- aggregate-only diagnostics.

Automated repository QA remains synthetic/fake-backend only and must not call production providers or production R2.
