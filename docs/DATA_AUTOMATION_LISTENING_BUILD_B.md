# Data Automation — Listening Build B

## Scope

Build B adds the provider-ordering and conservative response-resolution engine for historical listening enrichment. It remains inert in production: no maintenance secret is configured, no production listening objects are read or written, and no provider is called by this build.

The engine consumes the provider-free inventory from Build A and plans one next step per unique track. Repeated listens never multiply provider work.

## Provider order

For an unresolved track, the planner uses the first safe applicable route:

1. Reuse an existing resolved cross-provider track identity.
2. Reuse source MusicBrainz recording identity already present in immutable observations.
3. For an exact trusted Spotify track ID with missing metadata, plan one exact-track Spotify lookup.
4. If Spotify metadata supplies an uppercase ISRC, plan a MusicBrainz ISRC lookup.
5. If exact-ID routes are exhausted, use ListenBrainz metadata lookup only when the BANDMARKR band already has a trusted MusicBrainz artist MBID and exact lookup text is available.
6. Ambiguous, conflicting, malformed or identity-mismatched results fail closed and are never guessed.

A future maintenance runner will execute these planned steps through the dedicated `DATA_MAINTENANCE_TOKEN` role and UsageTracker. Build B itself performs no network operations.

## Spotify resolution

Spotify enrichment is keyed by the requested trusted Spotify track ID. Returned artist IDs, album identity, artwork URL and `external_ids.isrc` may be retained as provider-owned derived metadata. If Spotify returns a different relinked track ID, the requested track ID remains the storage key and the provider-returned ID is audit metadata only.

When a BANDMARKR band already has a trusted Spotify artist ID, a response that does not include that artist fails to `needs_review` instead of being accepted automatically.

Spotify's current Web API documentation continues to expose track `external_ids.isrc`; the March 2026 changelog explicitly reverted its earlier planned removal. Track relinking may return a different playable track in market-aware requests, so requested identity is preserved separately from the provider-returned ID.

## MusicBrainz ISRC resolution

MusicBrainz supports `/ws/2/isrc/<isrc>` lookups that can return multiple recordings. The future runner must request `artist-credits` so Build B can verify provider recording identity against the band's already-trusted MusicBrainz artist MBID. Build B accepts a recording automatically only when exactly one returned recording belongs to that trusted artist. Zero trusted-artist recordings is `no_match`; more than one is `needs_review`.

This keeps ISRC useful as recording evidence without assuming that every database ISRC maps uniquely in practice.

## ListenBrainz fallback

ListenBrainz `GET /1/metadata/lookup/` is the final text fallback and currently requires a user token. Build B supplies artist and recording names only after exact-ID routes are exhausted. It accepts a mapping automatically only when normalized artist text and recording text match the request and returned `artist_mbids` include the already-trusted MusicBrainz artist MBID. A returned recording MBID with mismatched evidence is `needs_review`.

No release or release-group value from this fallback is treated as exact edition evidence.

## Resumability and state

`listening/track-identities.json` remains the derived cross-provider state document. Provider observations may be stored additively under a `providers` object with status, reason and checked time. Existing unknown fields are preserved.

Retries are explicit rather than implicit. A provider may be attempted again only when its saved status is `retry` and a valid `nextEligibleCheckAt` exists. A future date blocks work; once that date has passed, that same provider becomes eligible again. A `retry` without a date, an `error`, or a `needs_review` state never triggers a hidden provider call. Resolved recording identity is never downgraded by a later non-resolving observation.

The engine does not mutate inventory, source observations, existing identity records or Spotify metadata inputs. Safe summaries expose counts only and exclude names, titles, provider IDs and timestamps.

## Production boundary

This build does not:

- configure `DATA_MAINTENANCE_TOKEN`;
- create `listening/track-identities.json` in production;
- read or write production R2;
- call Spotify, MusicBrainz or ListenBrainz;
- add or run a production workflow;
- activate a schedule or backfill.

Those actions remain separately gated in Build C and later rollout work.
