# Listening album artwork strategy — v113

## Status

This document records the approved album-oriented artwork architecture implemented on `feature/listening-album-artwork-v113`.

The historical C4 MusicBrainz catalogue backfill remains paused. MusicBrainz and ListenBrainz are not required for listening artwork enrichment.

## Goal

Artwork enrichment should minimize Spotify provider work while preserving exact source observations and existing trusted metadata.

Historical source listens already carry exact trusted Spotify Track IDs plus artist and release text. They do not carry Spotify Album IDs or artwork URLs.

The approved artwork path is therefore:

1. map a source listen to a trusted local BANDMARKR band;
2. require a non-empty release title;
3. group by trusted local band identity plus normalized release title;
4. choose one exact trusted Spotify Track ID as the representative provider seed for an unresolved safe group;
5. use the exact Spotify track response to obtain Spotify Album ID, album URL and artwork URL;
6. persist that response only on the exact representative Spotify Track ID;
7. reuse that album artwork across the safely matched group in memory;
8. preserve existing track-keyed metadata for backward compatibility.

There is no Spotify title search and no MusicBrainz or ListenBrainz artwork fallback.

## Conservative grouping

A group requires:

- a current trusted local band ID, either already present on the in-memory event or obtained from an exact normalized artist name that maps to exactly one current band;
- a non-empty normalized `releaseTitle`;
- a valid exact `spotifyTrackId`.

Missing band identity, duplicate band-name ownership, stale explicit band IDs, missing release title, or malformed Spotify Track IDs stay outside automatic album enrichment.

If existing track metadata inside one candidate group exposes more than one Spotify Album ID, the group is ambiguous and is not automatically enriched or reused. If the same exact Spotify Track ID appears under more than one album group, all affected groups also fail closed.

Edition qualifiers in the source release title remain identity-significant because normalization only performs Unicode/diacritic normalization, case folding and whitespace normalization. It does not remove words such as deluxe, remaster, anniversary, live, expanded or edition.

## Backward compatibility and provider ownership

`listening/spotify-metadata.json` remains the existing track-keyed schema and path. No new production JSON object is introduced.

Existing per-track records remain authoritative evidence for that exact track and are never deleted. Album reuse is additive:

- in the browser, one known album/artwork record can decorate sibling listens in memory without rewriting immutable source events;
- maintenance persists a new Spotify response only for the exact representative Track ID that was actually requested from Spotify;
- sibling Track IDs do not receive fabricated `spotify_exact_track_id` records merely because they share a conservative album group;
- unknown future metadata fields are preserved on the representative record;
- an existing conflicting Spotify Album ID is never overwritten by group reuse.

This keeps the current Top Tracks, Top Albums, Band Detail and Toplist rendering contracts compatible while preserving provider ownership boundaries.

## Browser behavior

`spotifyListeningAlbumArtworkV113.js` is loaded after the v99 metadata layer and before the v101 request layer.

It replaces only the unresolved-artwork queue and the in-memory application step:

- unresolved work becomes at most one representative exact Spotify Track ID per safe album group;
- a group with already-known compatible album artwork produces zero new provider work;
- a conflicting group produces zero guessed provider work and keeps placeholders;
- after one representative record is fetched, its album artwork is reused across sibling listens in memory.

The existing v101 Spotify request, pacing, checkpoint, authorization and error behavior remains in place.

## Maintenance behavior

`scripts/spotify-album-artwork-production.js` is the album-oriented historical maintenance entrypoint.

It reuses the existing private source reader, exact Spotify track endpoint, UsageTracker accounting, authentication gates and conditional `listening/spotify-metadata.json` writes.

For each unresolved safe album group it makes at most one exact-track metadata lookup. It never sends listening history, artist search text, album search text, MusicBrainz data or ListenBrainz data to Spotify.

Already-known compatible album artwork requires no new provider call and no sibling metadata write. A newly acquired representative record is conditionally persisted before another album group is processed. Current band ownership is rechecked before provider work and persistence so stale grouping stops safely.

Real execution remains a separately authorized production action. This v113 implementation and automated QA do not authorize or perform provider calls or production writes.

## Version

This is an architectural and PWA behavior change. `APP_VERSION` and `CACHE_NAME_LITERAL` move together once from v112 to v113. Focused corrections to this same unreleased build remain v113.
