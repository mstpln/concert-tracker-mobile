# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by an authenticated Cloudflare Worker and private R2.

Security Builds 1-3 are deployed. Browser and automation roles are verified, the legacy `API_TOKEN` has been removed, and browser writes were verified afterward. v77 is merged on `main` at `fd96b41cabf4c3972df3065ca7aab3856c7e953a`. The focused research schedules are active and the one-time release-feed cleanup completed successfully, reducing `news.json` from 42 legacy records to 0 while creating a private rollback artifact.

The current development branch is `feature/listening-vault-foundation`. It prepares **v78 / Listening Build 3.1** and has not been merged, deployed or run against production data.

## Product purpose and navigation

This is a single-user concert tracker for followed bands, upcoming shows, attended history, concert alerts, Spotify releases, listening history, venues, statistics and user-owned concert preparation. Bottom navigation is **Concerts**, **Dates**, **Bands**, **Stats**, and **Alerts**. Settings, band profiles, Full Top Bands and venue details are secondary screens.

## Listening history baseline

The sanitized Spotify archive contains 250,403 eligible unique track listens from 2009-01-16 through 2026-07-29. It excludes Spotify Kids, podcasts, video, audiobooks, plays shorter than 30 seconds and discarded account/device/location fields. Retained source fields are timestamp, artist, track, album, played duration, Spotify track ID, deterministic stable ID and source marker.

All sanitized eligible events are retained, including artists not currently stored in LiveVault. Visible statistics include only events currently mapped to stored LiveVault bands. `localBandId` remains derived so previously unmatched history can contribute automatically when a band is added or identity improves.

Before v78 production rollout, the archive remains browser-local in IndexedDB. No real listening history is committed, included in QA, written to public artifacts or sent to providers in bulk.

## v78 private Listening Vault foundation

The approved architecture changes the durable listening source of truth from one browser to private Cloudflare R2 while retaining IndexedDB as the fast offline working copy.

### Remote structure

- `listening/manifest.json` is a small conditional-write manifest.
- The current sanitized Spotify archive is one compressed immutable object at `listening/spotify-history/<sha256>.json.gz`.
- A new content-addressed object is created before the manifest changes, so an interrupted upload cannot replace the last complete archive.
- The prior archive reference remains in the manifest and prior immutable objects are not deleted automatically.
- Future ListenBrainz events will use separate bounded monthly objects in a later build; ListenBrainz sync is not part of v78.

### Device behavior

- Existing IndexedDB history remains the local working copy and statistics continue to work offline.
- Settings gains **Back up to Cloudflare**, **Restore from Cloudflare**, and **Download backup** controls inside the single Listening history component.
- A device with no local history may restore automatically from the private remote archive after connection.
- Restore verifies SHA-256 and event count before replacing the local copy.
- A failed remote read or write preserves the existing local archive and prior manifest.

### Worker boundary

- The Worker exposes only explicit authenticated listening manifest and content-addressed Spotify-history routes.
- Listening routes are available to the browser role only; automation and read-only smoke credentials cannot access the archive.
- Manifest writes are validated, bounded to 1 MB and conditional through R2 ETags.
- Gzip archives are bounded to 100 MB, signature-checked and create-only by content hash.
- No unrestricted R2 file API, destructive listening endpoint or production migration workflow is added.

### Backup and recovery

- The original local IndexedDB archive remains untouched until a separately authorized production backup/restore verification.
- The app can download a private compressed local backup.
- Remote archives are immutable and content-addressed; manifest replacement occurs only after archive persistence.
- Restore verifies hash, schema and event count before durable local replacement.
- Production upload, Worker deployment and real-device restore testing require separate explicit authorization after merge.

## Listening features deferred after v78

1. Reliable Top Tracks Spotify album artwork and shared artwork metadata.
2. ListenBrainz connection and bounded incremental synchronization using raw listens, independent of ListenBrainz statistics aggregation.
3. Cross-source deduplication and MusicBrainz recording/release identity.
4. Separately approved richer listening UI such as Top Albums or album drill-down.

## Focused research workflows

Structured Ticketmaster/Spotify research runs Monday, Wednesday and Friday at 01:00 UTC. Focused Tavily/Groq concert discovery runs on the 1st and 15th at 02:00 UTC. Both use the shared production-write concurrency group, UsageTracker controls and conditional writes. Tavily searches only for upcoming concerts and festivals.

The visible Releases feed accepts only actual Spotify catalogue releases with a trusted Spotify release ID and album URL. Concert alerts derive only from `concerts.json`; `news.json` remains the compatibility container for future Spotify release items.

## Data ownership and safety

Bands and concerts preserve stable IDs, user-owned fields, provider ownership boundaries and unknown future fields. Listening source events remain distinct from derived LiveVault-band mapping, later identity relationships and optional album metadata.

QA uses fictional listening fixtures and the fake backend only. The public QA build strips the real listening import and private Listening Vault modules. Automated tests may never contain the real archive, call the production Worker or send history to providers.

## Development workflow

Approve scope, create a branch, implement and test with synthetic data, maintain state/decisions/build facts, push and open a PR, then merge only after explicit `Merge it`. A version/cache bump is not deployment permission. Worker deployment, R2 writes, archive migration, real provider calls and real-account tests require separate production authorization.
