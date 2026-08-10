# Data Automation — Listening C2 Catalogue Resolver Foundation

## Scope

Build C2 implements only the production-inert resolver redesign foundation from the BANDMARKR Data Automation Revised Master Build Plan v1.1.

It does not replace or activate the existing v111 production backfill entrypoints. No provider adapter, Worker route, R2 catalogue cache, production write path, schedule, secret, workflow activation or production command is added by this slice.

## Architecture

The C2 path is additive beside the existing v111 planner:

1. Reuse the current immutable listening inventory and stable track keys.
2. Derive catalogue evidence without changing source events or existing durable identities.
3. Preserve durable routing holds before considering new automatic evidence. Existing root or provider `needs_review`, `retry`, `error`, and `no_match` states remain held as exception work in C2 rather than being silently bypassed by the new resolver.
4. Classify evidence conservatively:
   - **A** — already complete from existing/source recording identity;
   - **B** — trusted MusicBrainz artist + clean recording text + exactly one normalized release text;
   - **C** — trusted MusicBrainz artist + clean recording text with missing or conflicting release evidence;
   - **D** — unresolved B/C work eligible for the future bounded ListenBrainz batch bridge;
   - **E** — blocked, malformed, held durable routing state, artist-untrusted or conflicting lookup evidence.
5. Validate a versioned artist-MBID-keyed MusicBrainz catalogue-cache contract.
6. Match locally using exact deterministic normalized recording text, the already trusted BANDMARKR MusicBrainz artist MBID and, for tier B, exact normalized release text.
7. Resolve only when exactly one compatible recording MBID remains.
8. Keep multiple compatible recording MBIDs ambiguous and out of the automatic batch bridge.
9. Plan only still-unresolved eligible items for a bounded future ListenBrainz batch request.
10. Expose aggregate-only feasibility diagnostics.

## Matching rules

- Trusted BANDMARKR MusicBrainz artist identity is mandatory for automatic catalogue resolution.
- Recording-title matching is exact after the project's deterministic normalization.
- Version qualifiers remain identity-significant because exact normalized text must match; `Song` does not match `Song (Live)`, `Song (Remix)`, and similar variants.
- Tier B additionally requires one exact normalized release-title match.
- Tier C may resolve only when exact recording title plus trusted artist yields one unique recording MBID. Release identity is never inferred from ambiguous or missing release text.
- Multiple compatible recording MBIDs remain ambiguous.
- Existing durable `needs_review`, `retry`, `error`, and `no_match` state is not automatically reopened by C2. A later C3/C4 recovery or migration rule must explicitly define which old states may be reconsidered and how protected review/retry ownership is preserved.
- Invalid catalogue structures fail closed.
- Duplicate recording MBIDs inside one artist catalogue are rejected as invalid cache input rather than silently collapsed.
- Unknown future catalogue fields are tolerated and validation does not mutate input objects.

## Catalogue cache contract

C2 defines the in-memory/synthetic contract only:

- `kind`: `livevault-musicbrainz-catalogue-cache`
- `schemaVersion`: `1`
- `artists`: object keyed by lowercase trusted artist MBID
- each artist stores its own `artistMbid` and a `recordings` array
- each recording stores `recordingMbid`, title, artist MBIDs and optional release rows
- release rows may carry release/release-group MBIDs and title when provider evidence supplies them

C2 intentionally does **not** decide the production R2 object name, object-size ceiling, pagination persistence, ETag write path, freshness/refresh policy or Worker allowlist. Those are C3 concerns and require separate review before production activation.

## ListenBrainz batch bridge planning

The C2 batch planner is pure and makes no request. It accepts only unresolved tier B/C items with trusted artist identity plus clean artist/recording text. It emits a bounded list, hard-limited to at most 100 items per planned batch.

Items already resolved locally are excluded. Catalogue ambiguity is also excluded and remains exception/review work rather than being silently widened into another automatic route. Items carrying a durable routing hold are likewise excluded.

## Production boundary

This build makes zero live provider calls and zero production writes. It does not alter the current Spotify-first v111 production planner or authorize another historical backfill run. The existing production backfill remains stopped unless the user separately authorizes a future revised production proof after C3/C4 review.

## Version

This is pure Node maintenance tooling and documentation. The PWA shell is unchanged, so `APP_VERSION` and `CACHE_NAME_LITERAL` remain synchronized at v111.

## Validation

Synthetic unit coverage includes:

- tier A/B/C classification;
- clean and conflicting release evidence;
- exact artist/recording/release resolution;
- durable root/provider `needs_review`, `retry`, `error`, and `no_match` hold preservation;
- version-qualifier mismatch;
- release mismatch;
- duplicate and ambiguous recording candidates;
- tier C unique-title resolution;
- trusted-artist mismatch;
- bounded tier D planning;
- exclusion of resolved, ambiguous and held items from the bridge;
- malformed and duplicate cache-state failure;
- invalid evidence fail-closed behavior;
- unknown-field non-mutation;
- aggregate-only diagnostics.

Automated repository QA remains synthetic/fake-backend only and must not call production providers or production R2.
