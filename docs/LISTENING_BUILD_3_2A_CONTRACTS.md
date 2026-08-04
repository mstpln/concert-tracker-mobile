# BANDMARKR Listening Build 3.2A Contracts

## Status

Build 3.2A is an implementation-foundation branch only. It does not migrate production data, rewrite the private archive, call providers, change visible listening totals, or start Build 3.2B/3.3.

## Reconciled current main

- `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v88.
- IndexedDB uses `livevault-listening-history-v1`, store `listens`, key path `stableListenId`, plus the `meta` store.
- Spotify-import events require a Spotify track ID, a duration of at least 30 seconds and a stable listen ID.
- ListenBrainz events use integer-second provider timestamps, preserve available recording/release/artist MBIDs and may have unknown duration.
- Current merge protection rejects an existing stable ID or an exact same-second normalized artist/title fingerprint. That protection currently discards the incoming overlap rather than preserving both observations as an explicit canonical relationship.
- `localBandId` is derived at read time from normalized artist name. The BANDMARKR band ID remains the application navigation and user-owned-state authority.
- Top Bands ranks by known listening time. Top Tracks and Top Albums rank by listen count with deterministic tie-breakers.
- The durable R2 archive/manifest and local IndexedDB remain separate; this build does not alter either.

## Additive identity contract

Identity data is derived and versioned. Source observations remain unchanged and retain unknown future fields.

- `bandId`: authoritative BANDMARKR application artist ID.
- `artistMbid`, `recordingMbid`, `releaseMbid`, `releaseGroupMbid`: preferred external MusicBrainz identities.
- `spotifyTrackId`, `spotifyAlbumId`: Spotify-owned identifiers only.
- `source`, `sourceEventId`: provider provenance.
- `status`: `unresolved`, `resolved`, `ambiguous`, `unmatched`, or `user_reviewed`.
- `evidence`: deterministic evidence records.
- `version`: identity contract/rule version.
- `reviewedDecision`, `reviewedAt`: user-owned decisions that automation cannot overwrite.

Same-name evidence alone never assigns an identity.

## Canonical-listen relationship contract

- `canonicalListenId`: stable logical listen representative.
- `duplicateOf`: reference to the representative when an observation is suppressed from aggregation.
- `status`: `unique`, `exact_duplicate`, `probable_duplicate`, `ambiguous`, or `user_reviewed`.
- `method`: deterministic evidence class.
- `evidenceTier`: matching hierarchy level, not an invented percentage.
- `version`: dedupe rule version.
- `reviewedDecision`, `reviewedAt`: protected user-owned decision.
- `source`, `sourceEventId`: preserved provider provenance.

Deduplication suppresses duplicate aggregation only. It never deletes source observations.

## Matching and tolerance decision

Current Spotify and ListenBrainz adapters normalize timestamps to ISO values while ListenBrainz starts from integer Unix seconds. Existing overlap protection floors timestamps to the same second. Build 3.2A therefore uses a narrow inclusive **1,000 ms timestamp tolerance** only when trusted stable identity evidence exists.

- Level 1: same provider and exact source event ID — automatic exact duplicate.
- Level 2: exact recording MBID and timestamp distance no greater than 1,000 ms — automatic exact duplicate candidate.
- Level 3: exact Spotify track ID and timestamp distance no greater than 1,000 ms — automatic exact duplicate candidate.
- Level 4: trusted release/recording evidence, compatible timestamp and known durations within 2,000 ms — probable only; no automatic merge in 3.2A.
- Levels 5–6: normalized strings, same-name, cover, tribute or artist/title-only evidence — ambiguous or unmatched; never automatic.

Unknown duration is never fabricated. It does not block Levels 1–3. Two close genuine listens remain protected because later candidate assignment must be one-to-one and cannot use title-only evidence.

## Migration design

The later migration must:

1. preflight safe aggregate counts, source counts, month-bounded date categories and identity coverage;
2. generate candidates from stable-ID indexes and bounded timestamp buckets, never all-pairs comparison;
3. process deterministic chunks with a persisted cursor and rule version;
4. write derived identity/canonical records additively in short IndexedDB transactions;
5. checkpoint source counts, source ranges and reviewed-decision counts after each chunk;
6. resume idempotently after interruption and skip records already processed at the same version;
7. rebuild aggregates from canonical representatives only after integrity checks pass;
8. roll back by disabling/removing the derived version while leaving source events and prior readable schemas intact.

A synthetic archive larger than 250,000 events must validate linear or indexed-window behavior, bounded memory, no spread-argument use and no all-at-once transaction.

## Aggregate contract

All existing screens continue to consume source events until Build 3.2C is separately approved. Later canonical aggregation will count one representative while retaining all provider observations.

- global and period totals count canonical representatives;
- Top Bands remains known-listening-time first;
- Top Tracks and Top Albums remain listen-count first with existing deterministic tie-breakers;
- genre, yearly and rolling two-week charts use canonical representatives;
- first/latest listen calculations use canonical representatives;
- unknown-duration listens count but add no invented time.

Existing results change only for explicitly validated duplicate corrections.

## Safe audit output

Public CI output may include only schema version, source counts, stable-ID coverage, identity coverage, duplicate-candidate counts by evidence tier, ambiguous counts, expected canonical-count delta and month-level date boundaries. It may not include artist names, track names, album names, raw timestamps, tokens, URLs or event payloads.

## Build 3.3 addition: Spotify links

When Build 3.3 consolidates Top Tracks and Top Albums:

- a Top Track title should use the existing past-setlist Spotify-link interaction and open the exact trusted Spotify track;
- a Top Album title should use the same interaction and open the exact trusted Spotify album;
- links are shown only from a trusted stored Spotify ID or URL and are never created from title-only guessing;
- missing or ambiguous Spotify identity leaves the title as normal non-linked text;
- links must retain accessible labels, safe external-link behavior and offline-safe row rendering.
