# Data Automation — Listening Build B

## Scope

Build B adds the provider-ordering and conservative response-resolution engine for historical listening enrichment. It remains inert in production: no maintenance secret is configured, no production listening objects are read or written, and no provider is called by this build.

The engine consumes the provider-free inventory from Build A and plans one next step per unique track. Repeated listens never multiply provider work.

## Provider order

For an unresolved track, the planner uses the first safe applicable route:

1. Reuse an existing resolved cross-provider track identity or source MusicBrainz recording identity already present in immutable observations.
2. Reuse a previously stored uppercase ISRC before making another Spotify request, but only when the BANDMARKR band already has the trusted MusicBrainz artist MBID required to verify the result.
3. Otherwise, for an exact trusted Spotify track ID with missing metadata, plan one exact-track Spotify lookup.
4. If Spotify metadata supplies an uppercase ISRC and trusted MusicBrainz artist identity is available, plan a MusicBrainz ISRC lookup.
5. If stronger routes are safely exhausted, use ListenBrainz metadata lookup only when the band already has a trusted MusicBrainz artist MBID and the source artist/recording text is complete and non-conflicting.
6. Ambiguous, conflicting, malformed, stale-owned or identity-mismatched evidence fails closed and is never guessed.

A future maintenance runner will execute these planned steps through the dedicated `DATA_MAINTENANCE_TOKEN` role and UsageTracker. Build B itself performs no network operations.

## Spotify resolution

Spotify enrichment is keyed by the requested trusted Spotify track ID. Returned artist IDs, album identity, artwork URL and `external_ids.isrc` may be retained as provider-owned derived metadata. If Spotify returns a different relinked track ID, the requested track ID remains the storage key and the provider-returned ID is separate audit metadata only.

When a BANDMARKR band already has a trusted Spotify artist ID, a response or reused metadata record that explicitly names other artists but not that trusted artist fails closed instead of being accepted automatically.

Spotify metadata merging is additive. A later incomplete response does not erase an existing valid ISRC, album identity, album URL, artwork or Spotify artist IDs. A changed ISRC is rejected. Artwork is not carried across when Spotify returns a different album identity without replacement artwork. Malformed album IDs, non-HTTPS artwork and inconsistent relink audit fields are rejected before persistence.

Spotify's current Web API documentation continues to expose track `external_ids.isrc`; the March 2026 changelog explicitly reverted its earlier planned removal. Track relinking may return a different playable track in market-aware requests, so requested identity is preserved separately from the provider-returned ID.

## MusicBrainz ISRC resolution

MusicBrainz supports `/ws/2/isrc/<isrc>` lookups that can return multiple recordings. The future runner must request `artist-credits` so Build B can verify provider recording identity against the band's already-trusted MusicBrainz artist MBID. An ISRC alone is never enough to schedule this route without that trusted artist anchor.

Build B accepts a recording automatically only when exactly one returned recording belongs to the trusted artist. Zero trusted-artist recordings is `no_match`; more than one is `needs_review`. An already-resolved recording identity cannot be replaced by a different later provider resolution, and conflicting compatible recording-ID fields block rather than choosing one.

This keeps ISRC useful as recording evidence without assuming that every database ISRC maps uniquely in practice.

## ListenBrainz fallback

ListenBrainz `GET /1/metadata/lookup/` is the final text fallback and currently requires a user token. Build B supplies artist and recording names only after stronger routes are exhausted. It accepts a mapping automatically only when normalized artist text and recording text match the request and returned `artist_mbids` include the already-trusted MusicBrainz artist MBID. A returned recording MBID with mismatched evidence is `needs_review`.

If several source observations collapse to the same exact work key but disagree on artist/recording lookup text, automatic ListenBrainz fallback is disabled for that work item. No release or release-group value from this fallback is treated as exact edition evidence.

## Resumability and state

`listening/track-identities.json` remains the derived cross-provider state document. Provider observations may be stored additively under a `providers` object with status, reason and checked time. Existing unknown fields are preserved.

Retries are explicit rather than implicit. A provider may be attempted again only when its saved provider status is `retry`, exactly one provider owns that retry, and a valid `nextEligibleCheckAt` exists. A future date blocks work; once that date has passed, that same provider becomes eligible again. A retry without a date, terminal top-level `error`, `needs_review` or `no_match`, or an inconsistent resolved state never triggers a hidden provider call.

Stored work-key, band, Spotify-track, ISRC and trusted-provider-artist conflicts block rather than silently migrating ownership or selecting one side. Provider-specific outcome states are also enforced before persistence: Spotify metadata is metadata, while MusicBrainz/ListenBrainz recording resolutions must include recording identity.

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
