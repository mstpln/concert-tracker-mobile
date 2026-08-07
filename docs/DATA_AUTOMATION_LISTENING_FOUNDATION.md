# Data Automation — Listening inventory foundation

This is the first implementation slice of the BANDMARKR Data Automation & Enrichment project. It is intentionally provider-free and production-free.

## Purpose

Inventory the historical listening archive for bands that currently exist in BANDMARKR before any enrichment request is made. The provider-work unit is a unique track, not an individual listen.

## Reused repository foundations

- The private immutable Spotify archive and ListenBrainz incrementals remain the source observations.
- `scripts/spotify-artwork-backfill-source.js` remains the verified reader for the private manifest and content-addressed listening objects when a production inventory is separately authorized.
- Existing BANDMARKR provider identity rules in `providerIdentityState.js` decide whether a stored artist identity is trusted.
- Existing exact Spotify track IDs are always preferred over text-derived work keys.
- Existing MusicBrainz recording IDs on ListenBrainz source events are reused as complete identity evidence with no provider call.
- Existing `listening/spotify-metadata.json` is reused before planning another Spotify request.

## Inventory rules

1. Map an event to a current BANDMARKR band by an existing stable `bandId`/`localBandId` first.
2. If no stable band ID exists, exact normalized artist-name fallback is allowed only when that name belongs to one current band.
3. A stale explicit band ID never falls back to text. Ambiguous duplicate names remain unmapped.
4. Use `spotify:<spotifyTrackId>` as the unique work key when an exact Spotify ID exists.
5. Otherwise use the provider-neutral `text:<sha256>` work key derived from stable BANDMARKR band identity plus the exact normalized recording title.
6. Reuse an existing cross-provider recording identity first, including the v107 `musicbrainzRecordingId` field while retaining compatibility with earlier local derived-field names.
7. Reuse one unambiguous source MusicBrainz recording MBID next.
8. Reuse existing Spotify metadata next. If that record already contains an ISRC, the track is ready for later ISRC→MusicBrainz work without another Spotify request.
9. Only unresolved exact Spotify IDs are marked as future Spotify work.
10. Text fallback is eligible only when the BANDMARKR band already has trusted MusicBrainz artist identity. Conflicts are blocked, never guessed.

## Privacy and logging

The inventory module returns internal work items to its caller, but `safeInventorySummary()` exposes aggregate counts only. Production workflow logs must use only this aggregate form. Artist names, track names, provider IDs, listen IDs and timestamps must never be logged.

## Spotify export review

The supplied Spotify Extended Streaming History archive was reviewed as a read-only input during this build. Its audio records contain the exact `spotify_track_uri` already preserved by BANDMARKR as `spotifyTrackId`. The additional export fields are playback/session facts such as platform, country, start/end reason, shuffle, skipped, offline state/timestamp and incognito mode. The export does not contain Spotify artist IDs, Spotify album IDs, ISRCs, artwork URLs or MusicBrainz identities. Those extra session fields are therefore not added to BANDMARKR for this project: they do not reduce the planned identity/enrichment provider work, and some are more privacy-sensitive than the sanitized source archive.

## Production boundary

This slice does not read production R2, write production R2, call Spotify, MusicBrainz or ListenBrainz, add a scheduled workflow, change Worker permissions, modify secrets, or alter the PWA. A later reviewed slice will connect the pure inventory engine to the dedicated maintenance role and private derived identity storage. Production inventory itself still requires explicit authorization and must remain zero-provider-call/zero-write.
