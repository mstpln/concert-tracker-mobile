# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker `concert-tracker-api` and private R2 bucket `concert-tracker-data`.

This continuity file was compacted on 2026-08-17. Detailed v77-v134 build history remains in Git history; the durable decisions remain in `docs/LIVEVAULT_DECISIONS.md`.

## Current merged baseline

`main` is at v135 before PR #142. v135 retired the active Releases product path: Alerts is concert-only, Band Detail no longer exposes Releases, and the scheduled structured preload makes release catalogue discovery and lifecycle release-alert planning inert. Existing stored release/provider data is preserved for compatibility rather than destructively migrated. The PWA/cache markers are synchronized at v135 on merged `main`.

The existing provider-safety architecture remains authoritative: UsageTracker caps/pacing, the persisted Spotify circuit, the cross-scheduler lease, strict conditional JSON writes, reviewed provider-decision preservation, immutable listening source observations, and the private-listening credential boundary. Ordinary GitHub automation may not read raw private listening history. The trusted-local artwork runner remains the approved place for private listening-derived provider work.

The v134 missing-artist-image lane remains the final low-priority lane in structured research. It uses the privacy-safe `listening/band-activity.json` aggregate for ordering when valid, never reads raw listening history, never overwrites manual `photoUrl`, and only trusts exact Spotify artist-image evidence after trusted identity. No production workflow or provider run is authorized merely by this state description.

## v136 remaining provider/release cleanup state

PR #142 on `fix/provider-release-scope-completion-v136` completes the unresolved parts of the reviewed provider/release cleanup scope while preserving v135 release retirement.

Non-playlist Spotify track-link reuse is provider-neutral at the resolver boundary. Existing exact Spotify track IDs/URLs and exact ListenBrainz or MusicBrainz Spotify URL relations can satisfy later display/setlist-link work without another Spotify search. Concert/setlist and predicted-setlist evidence can be collected from the data already visible to scheduled research. Private listening evidence can use the same pure resolver only in callers that already possess that private data; the automation credential is not widened to raw listening archives. Ambiguous evidence fails closed. Playlist matching remains separate and unchanged.

Listening artwork now prefers exact provider-neutral release evidence before Spotify artwork work. A single exact MusicBrainz release MBID, including the exact release MBID already supplied by ListenBrainz CAA evidence, deterministically yields a Cover Art Archive front-image URL in the local working copy. CAA evidence is never written into `listening/spotify-metadata.json` and never represented as Spotify-owned metadata. The album-oriented listening artwork layer treats one unambiguous exact CAA URL as reusable for the safe local album group and excludes that group from unresolved Spotify artwork planning. Conflicting exact CAA evidence remains ambiguous and does not suppress Spotify through a guess.

The trusted-local Spotify artwork production runner now records its exact token/track operations through the shared Spotify diagnostics layer under the album-artwork lane while retaining UsageTracker, circuit, lease, pacing, authorization, conditional-write and source-immutability rules. Diagnostics are aggregate-only and contain no private track/listen identifiers.

`APP_VERSION`, `CACHE_NAME_LITERAL`, and deterministic build state are synchronized at v136. The version is bumped exactly once for this build; focused corrections stay on v136.

## Validation and release boundary

PR #142 exact-head validation must be green after the final corrective commit before merge readiness is declared. Automated browser work uses only synthetic fixtures and the QA fake backend. No live provider call, production workflow, production R2 read/write, deployment, merge, auto-merge, or production-data modification is authorized by PR #142 or this documentation update.

After merge, any production artwork/provider execution remains a separate explicit production action. Physical-device verification may still be useful for visible artwork precedence after release, but it is not a substitute for the synthetic CI safety checks.
