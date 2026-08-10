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
   - **A** — already complete from existing/source recording identity;
   - **B** — trusted MusicBrainz artist + clean recording text + one compatible release evidence path, using an explicitly MusicBrainz-owned source release MBID when present and otherwise exactly one normalized release text;
   - **C** — trusted MusicBrainz artist + clean recording text with release evidence missing or text-only conflicting;
   - **D** — locally unresolved B/C work eligible for the future bounded ListenBrainz batch bridge;
   - **E** — blocked, malformed, held durable routing state, conflicting trusted release identity, artist-untrusted or conflicting lookup evidence.
5. Normalize synthetic MusicBrainz artist-catalogue pages through a pure parser with explicit offset/count checkpoints and sequential merge rules.
6. Validate a versioned artist-MBID-keyed MusicBrainz catalogue-cache contract.
7. Match locally using exact deterministic normalized recording text, the already trusted BANDMARKR MusicBrainz artist MBID and, for tier B, compatible release evidence.
8. Resolve only when exactly one compatible recording MBID remains.
9. Keep multiple compatible recording MBIDs ambiguous and out of the automatic batch bridge.
10. Plan only items with an explicit local `unresolved` result for a bounded future ListenBrainz batch request.
11. Derive an exact Spotify track URL directly from an already trusted Spotify track ID without a Spotify request; this is presentation convenience only and never evidence of recording identity.
12. Expose aggregate-only feasibility diagnostics.

## Matching rules

- Trusted BANDMARKR MusicBrainz artist identity is mandatory for automatic catalogue resolution.
- Recording-title matching is exact after the project's deterministic normalization.
- Version qualifiers remain identity-significant because exact normalized text must match; `Song` does not match `Song (Live)`, `Song (Remix)`, and similar variants.
- Tier B additionally requires one compatible release relation. If immutable source evidence already contains one explicitly MusicBrainz-owned release MBID, the catalogue relation must contain that exact release MBID; matching release text cannot override a different trusted edition identity. A generic future `releaseMbid` field is not silently treated as MusicBrainz-owned. Without a trusted MusicBrainz release MBID, tier B requires one exact normalized release-title match.
- Multiple trusted source MusicBrainz release MBIDs for the same work item are a conflict and remain tier E. A single trusted release MBID combined with conflicting release text also fails closed rather than choosing an interpretation.
- Tier C may resolve only when exact recording title plus trusted artist yields one unique recording MBID. Release identity is never inferred from ambiguous or missing release text.
- Multiple compatible recording MBIDs remain ambiguous.
- Existing durable `needs_review`, `retry`, `error`, and `no_match` state is not automatically reopened by C2. A later C3/C4 recovery or migration rule must explicitly define which old states may be reconsidered and how protected review/retry ownership is preserved.
- Malformed known-provider containers/entries and unknown provider statuses are held rather than reinterpreted as fresh work.
- Invalid catalogue/evidence/result structures fail closed. Duplicate evidence track keys, local-result keys, catalogue recording MBIDs and release MBIDs are rejected.
- A future ListenBrainz batch candidate must have a corresponding local catalogue result whose status is explicitly `unresolved`; missing, exception, complete, resolved or ambiguous local results cannot be widened automatically.
- Unknown future catalogue fields are tolerated and validation does not mutate input objects.

## Pure MusicBrainz catalogue parsing

C2 includes only provider-payload normalization logic; it does not perform a MusicBrainz request.

A page parser accepts a trusted artist MBID plus a synthetic MusicBrainz recording-browse payload and requires:

- integer `recording-count` and `recording-offset` values;
- the returned offset to equal the expected sequential offset;
- a non-empty page while the declared total still has unconsumed rows;
- valid recording MBIDs, titles and artist-credit structures;
- every accepted recording to credit the requested trusted artist MBID;
- valid optional release and release-group MBIDs;
- no duplicate recording MBID on a page and no duplicate release MBID within one recording.

The normalized page carries `nextOffset`, `totalCount` and `complete`. A pure cache merge accepts only the next sequential page, rejects a total-count change mid-pagination and validates the combined cache after merging. This defines the C2 checkpoint contract without deciding where or how a future production checkpoint is persisted.

## Catalogue cache contract

C2 defines the in-memory/synthetic contract only:

- `kind`: `livevault-musicbrainz-catalogue-cache`
- `schemaVersion`: `1`
- `artists`: object keyed by lowercase trusted artist MBID
- each artist stores its own `artistMbid` and a `recordings` array
- each recording stores `recordingMbid`, title, artist MBIDs and optional release rows
- release rows may carry release/release-group MBIDs and title when provider evidence supplies them
- an artist may carry the normalized pagination fields `nextOffset`, `totalCount` and `complete`; if any is present, all must be valid and mutually consistent

C2 intentionally does **not** decide the production R2 object name, object-size ceiling, pagination persistence mechanism, ETag write path, freshness/refresh policy or Worker allowlist. Those are C3 concerns and require separate review before production activation.

## Zero-call Spotify URL derivation

An already trusted Spotify track ID can be converted locally to `https://open.spotify.com/track/<id>` after the existing safe-ID validation. This makes no provider call and does not require Spotify authentication, quota or metadata lookup. It is an optional presentation link only: it cannot create or strengthen MusicBrainz recording/release identity, and malformed IDs yield no URL.

## ListenBrainz batch bridge planning

The C2 batch planner is pure and makes no request. It accepts only tier B/C items that have an explicit locally unresolved catalogue result, trusted artist identity and clean artist/recording text. It emits a bounded list, hard-limited to at most 100 items per planned batch.

Items already resolved locally are excluded. Catalogue ambiguity is also excluded and remains exception/review work rather than being silently widened into another automatic route. Items carrying a durable routing hold are likewise excluded. Missing or malformed local-result documents fail closed rather than treating local resolution as skipped.

## Production boundary

This build makes zero live provider calls and zero production writes. It does not alter the current Spotify-first v111 production planner or authorize another historical backfill run. The existing production backfill remains stopped unless the user separately authorizes a future revised production proof after C3/C4 review.

## Version

This is pure Node maintenance tooling and documentation. The PWA shell is unchanged, so `APP_VERSION` and `CACHE_NAME_LITERAL` remain synchronized at v111.

## Validation

Synthetic unit coverage includes:

- tier A/B/C classification;
- clean, missing and conflicting release text evidence;
- explicitly MusicBrainz-owned source release-MBID matching, generic-field ownership protection and conflict quarantine;
- exact artist/recording/release resolution;
- durable root/provider `needs_review`, `retry`, `error`, `no_match`, malformed-provider and unknown-provider-status hold preservation;
- version-qualifier mismatch;
- release mismatch and malformed tier-B evidence;
- duplicate and ambiguous recording/release candidates;
- tier C unique-title resolution;
- trusted-artist mismatch;
- MusicBrainz page normalization, sequential pagination, checkpoint consistency, artist-credit boundaries and total-count drift;
- zero-call Spotify track URL derivation from an exact trusted ID;
- bounded tier D planning;
- requirement for explicit locally unresolved results before batch widening;
- exclusion of resolved, ambiguous and held items from the bridge;
- malformed and duplicate cache/evidence/result-state failure;
- unknown-field non-mutation;
- aggregate-only diagnostics.

Automated repository QA remains synthetic/fake-backend only and must not call production providers or production R2.
