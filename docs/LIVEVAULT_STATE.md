# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker `concert-tracker-api` and private R2 bucket `concert-tracker-data`.

Security Builds 1-3 are deployed. Browser and automation roles are verified, the legacy `API_TOKEN` has been removed, and browser writes were verified afterward. v77 focused research schedules are active and the one-time release-feed cleanup completed successfully.

Listening Build 3.1 and its focused Settings correction are merged and deployed as v78. The production Worker has the listening routes, the private archive and manifest are stored in R2, and a clean incognito browser successfully restored the complete history.

v79 is merged and deployed. The existing `concert-tracker-api` Worker is connected to GitHub through Cloudflare Workers Builds. The first repository-driven deployment completed successfully from merge commit `8deb2f03e6b7e224ce84e9609508eb0b37016d04` using Cloudflare build `6ac9e5e3` after setting the build variable `NODE_VERSION=22`. The user confirmed that the app loaded normally, Settings showed v79, bands and concerts loaded, and listening statistics remained available.

v80 is being implemented on `feature/v80-listenbrainz-sync`. It adds optional browser-side ListenBrainz synchronization, provider-neutral local listening events, immutable month-scoped R2 chunks and manifest-based recovery. No real ListenBrainz token, live sync or production R2 write has been used during development.

## Product purpose and navigation

This is a single-user concert tracker for followed bands, upcoming shows, attended history, concert alerts, Spotify releases, listening history, venues, statistics and user-owned concert preparation. Bottom navigation is **Concerts**, **Dates**, **Bands**, **Stats**, and **Alerts**.

## Listening Vault production state

The validated sanitized Spotify archive contains 250,403 eligible unique track listens from 2009-01-16 through 2026-07-29. It excludes Spotify Kids, podcasts, video, audiobooks, plays shorter than 30 seconds and discarded account/device/location fields.

Private R2 is now the durable source of truth while IndexedDB remains each device's fast offline working copy.

- Manifest: `listening/manifest.json`
- Archive: `listening/spotify-history/00c5c9987203e406d80ff623cac4139a2c2ac5c9942a501df049ddb5baf0da7d.json.gz`
- Canonical content SHA-256: `00c5c9987203e406d80ff623cac4139a2c2ac5c9942a501df049ddb5baf0da7d`
- Empty-device restore verifies SHA-256, schema and event count before replacing local history.
- Existing local history was preserved during rollout.
- Real listening history is never committed, included in QA, written to public artifacts or sent to providers in bulk.

## v80 ListenBrainz implementation state

The v80 branch currently implements:

- direct browser validation of a private ListenBrainz user token;
- bounded incremental fetching after the latest stored timestamp;
- deterministic overlap deduplication by stable ID and timestamp/artist/track fingerprint;
- preservation of available MusicBrainz recording, release and artist identifiers;
- provider-neutral IndexedDB events without weakening the historical Spotify import rules;
- immutable compressed objects at `listening/listenbrainz/YYYY-MM/<sha256>.json.gz`;
- conditional `listening/manifest.json` updates after each object is durable;
- integrity-checked incremental restore;
- six-hour in-use automatic sync plus a manual **Sync now** action;
- device erasure of the locally stored ListenBrainz token;
- synthetic tests and public-QA exclusion of all private sync modules.

Missing ListenBrainz duration remains unknown and is never fabricated. A real connection and production synchronization remain post-merge manual activation steps because the private token must be entered only on the user's device.

## v79 Cloudflare Git Builds setup

- `wrangler.jsonc` names the existing Worker `concert-tracker-api`.
- Entry point remains `worker.js`.
- R2 binding remains `BUCKET` connected to `concert-tracker-data`.
- Runtime secrets remain stored only in Cloudflare.
- Production builds use `main`, root `/`, no build command, deploy command `npx wrangler@4.114.0 deploy`, and build variable `NODE_VERSION=22`.
- Build watch include paths are limited to `worker.js`, `wrangler.jsonc`, `package.json`, and `package-lock.json`.
- Non-production branch builds remain disabled.

The v80 branch changes `worker.js`; after explicit merge approval, the connected Cloudflare build will deploy that reviewed Worker automatically. Automatic Worker deployment does not authorize R2 data changes, migrations, secret changes, production workflows or provider calls.

## Focused research workflows

Structured Ticketmaster/Spotify research runs Monday, Wednesday and Friday at 01:00 UTC. Focused Tavily/Groq concert discovery runs on the 1st and 15th at 02:00 UTC. Both use the shared production-write concurrency group, UsageTracker controls and conditional writes.

The visible Releases feed accepts only actual Spotify catalogue releases with a trusted Spotify release ID and album URL. Concert alerts derive only from `concerts.json`; `news.json` remains the compatibility container for Spotify release items.

## Data ownership and safety

Bands and concerts preserve stable IDs, user-owned fields, provider ownership boundaries and unknown future fields. Listening source events remain distinct from derived LiveVault-band mapping, later identity relationships and optional album metadata.

QA uses fictional listening fixtures and the fake backend only. Automated tests may never contain the real archive, call the production Worker or send history to providers.

## Development workflow

Approve scope, create a branch, implement and test with synthetic data, maintain state/decisions/build facts, push and open a PR, then merge only after explicit `Merge it`. A merged change to watched Worker deployment files may deploy the reviewed Worker automatically. App-only and documentation-only changes do not trigger the Worker. R2 writes, migrations, secrets and production workflows remain separately authorized.
