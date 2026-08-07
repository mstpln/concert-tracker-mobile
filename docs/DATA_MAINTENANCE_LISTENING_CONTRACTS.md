# Data Maintenance Listening Contracts

## Scope

This v107 foundation adds only the least-privilege Worker and storage contracts needed by the later historical listening backfill. It does not schedule maintenance, run providers, create production secrets, read production R2 data, or write production data.

## Maintenance credential

`DATA_MAINTENANCE_TOKEN` is a distinct Worker role. When configured later, it may:

- read `bands.json`, `concerts.json`, and `apiUsage.json`;
- read existing listening manifest, immutable Spotify archive objects, ListenBrainz incremental objects, Spotify listening metadata, and track identities;
- write `apiUsage.json`;
- conditionally write `listening/spotify-metadata.json` and `listening/track-identities.json`.

It may not read or write `news.json`, mutate `bands.json` or `concerts.json`, write listening manifests or immutable archives, access ticket routes, or call the browser-only MusicBrainz release-context route. Existing browser, automation, smoke, and legacy boundaries remain unchanged.

No secret is added or rotated by this build. The role is inert until a production secret is separately authorized and configured.

## Spotify listening metadata additions

`listening/spotify-metadata.json` remains schema version 1 and remains keyed by the requested trusted Spotify track ID. Existing records remain valid. New exact-track enrichment may additionally store:

- `spotifyArtistIds`: bounded Spotify artist IDs from the exact track response;
- `isrc`: uppercase provider ISRC when present and structurally valid.

Unknown future fields remain allowed. These additions never replace the requested Spotify track identity or edit source listening observations.

## Track identities

The new document contract is `listening/track-identities.json`:

- `kind`: `livevault-track-identities`;
- `schemaVersion`: `1`;
- optional document `updatedAt`;
- `records`: object keyed by the inventory work key.

Accepted work keys are `spotify:<trustedTrackId>` or `text:<sha256>`. Each record repeats its exact `workKey` and may add a stable local band ID, Spotify track/artist IDs, ISRC, MusicBrainz recording/artist IDs, status, retry timing, evidence, and unknown future fields. Known IDs and dates are validated. The Worker does not infer or guess identity.

The initial status vocabulary is `unresolved`, `resolved`, `no_match`, `needs_review`, `retry`, and `error`.

## Concurrency and preservation

Both writable listening documents keep the existing conditional-write requirement. Creating a missing document uses `If-None-Match: *`; updating an existing document requires its current ETag. Stale writes fail closed. Validators check known provider invariants while allowing unknown future fields so later enrichment can remain additive.

## Production boundary

Merging this code would change a watched Worker file and may therefore deploy reviewed Worker code automatically. That does not authorize creation of `DATA_MAINTENANCE_TOKEN`, creation of `listening/track-identities.json`, production inventory, provider calls, R2 writes, workflow runs, or backfill activation. Each of those remains separately gated by the Data Automation rollout plan.
