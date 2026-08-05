# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker `concert-tracker-api` and private R2 bucket `concert-tracker-data`.

Security Builds 1-3 are deployed. Browser and automation roles are verified, the legacy `API_TOKEN` has been removed, and browser writes were verified afterward. v77 focused research schedules are active and the one-time release-feed cleanup completed successfully.

Listening Build 3.1 and its focused Settings correction are merged and deployed as v78. The production Worker has the listening routes, the private archive and manifest are stored in R2, and a clean incognito browser successfully restored the complete history.

v79 is merged and deployed. The existing `concert-tracker-api` Worker is connected to GitHub through Cloudflare Workers Builds. The first repository-driven deployment completed successfully from merge commit `8deb2f03e6b7e224ce84e9609508eb0b37016d04` using Cloudflare build `6ac9e5e3` after setting the build variable `NODE_VERSION=22`. The user confirmed that the app loaded normally, Settings showed v79, bands and concerts loaded, and listening statistics remained available.

v80 is merged and deployed. PR #53 merged as commit `2d47a5b0b066f41da2c95bc3835283311d2e4dda`, and Cloudflare Workers Build `33f08233` completed successfully from `main`. The user confirmed that the production app showed v80 and that bands, concerts and the existing listening statistics still loaded correctly.

v81 is merged and live from PR #55, merge commit `da7f9f9b0fa6ae0c152259721e73d9af20c35ed0`. Physical-device verification found production-only regressions that synthetic QA had not represented: the legacy v72 compatibility layer converted the new `twoWeeks` key to all time, its reduced genre aggregate no longer satisfied the v81 Stats renderer, the five-metric Band Detail summary compressed at installed-PWA desktop width, and the refresh SVG was malformed and vertically clipped.

v82 is merged and live from PR #56, merge commit `3529f5abc6f8ddd7e076567880ee92fdd24b8265`. It restores the authoritative rolling 14-day and preceding-14-day totals after all legacy compatibility layers, supplies the complete genre/year contract required by Stats, normalizes ISO/millisecond/Unix-second timestamps, avoids archive-scale spread operations, makes Stats fail safely, provides a two-row desktop summary while retaining the accepted mobile layout, and replaces the refresh icon with aligned unclipped local SVG geometry. Physical verification then found that the 2-week line chart still inherited the legacy bucket helper and therefore fell through to yearly buckets, even though the period totals were corrected.

v83 is merged and live from PR #57, merge commit `a68d26c6465e6d1dfc1c2f9515ac602bdeeb0a4e`. It adds daily two-week bucket helpers and gives the yearly listening-hours chart a labelled **Listening hours** y-axis with a fixed rounded maximum across year windows. Physical verification found that the visible two-week charts still failed because the v83 QA asserted the internal bucket array rather than proving that the rendered Band Detail SVG used those buckets.

v84 is merged and live from PR #58, merge commit `987edb769da117610d64b47626fcf5353c43dfbc`. It owns the final visible two-week chart-rendering path, renders the rolling period as 14–15 daily points including empty days, uses day/month labels and **Most active day** copy, and verifies the actual rendered SVG on desktop and mobile rather than only internal calculation helpers.

v85 is merged from PR #59, merge commit `6afd33207894f0a9950dc75b1680eb888774b886`. Top Tracks and Top Albums rank by listen count first, while known duration, recency and normalized title are deterministic tie-breakers. The Start concert-stat teaser keeps numeric KPI values unit-free and moves the units into the labels as **traveled (km)** and **spent (kr)**.

v86 is the merged charcoal-concert-card build from `style/v86-charcoal-concert-cards`. It changes only the background used by past and upcoming concert listing cards to the approved charcoal-blue option (`#232a32` in dark mode), covering Start/My Concerts, Concert Dates, venue-detail concert lists, and Band Detail concert sections. Generic band, venue, alert, release, listening and statistics cards remain unchanged.

v87 is the merged BANDMARKR rebrand from PR #61, merge commit `91f7d8ead58f49a016d3e7bd99463ff74396c6f8`. The in-app top banner uses the approved centered condensed uppercase **BANDMARKR** wordmark on the existing `#024ddf` blue background. Stable record IDs, user-owned fields, local-storage and IndexedDB data, provider identifiers, remote data, and the existing `concert-tracker-shell-*` cache namespace remained unchanged.

v88 is the merged installed-branding refinement from PR #62. The in-app top banner remains visually unchanged and still reads **BANDMARKR**. Installed-app metadata uses **Bandmarkr** to improve the chance of the full launcher label fitting. PWA, maskable, favicon and Apple touch icon assets use the same `#024ddf` blue background with a plain white bookmark, no `BM` letters, and a bookmark footprint reduced by approximately 10% while retaining safe-area padding. No data, storage, provider, API or application-behavior changes were included.

Listening Build 3.2A is merged through PR #63 as commit `4b7614fd03f83aa3ea77f04c0b540338256044e4`. It establishes versioned additive identity and canonical-listen contracts, conservative evidence tiers, aggregate-only audit summaries, chunked resumable migration checkpoints, source-count integrity checks and synthetic regression coverage. It did not migrate IndexedDB or R2, call providers, change visible totals, alter the app shell, or bump v88.

v89 / Listening Build 3.2B is merged through PR #64 as commit `a1e27aded46484aba95bc078e4bf968ec42a621f`. It adds the private local database `bandmarkr-listening-derived-v1`, containing separate `listen-identities` and `listen-canonical` stores. The existing source-history database `livevault-listening-history-v1` and every Spotify or ListenBrainz source observation remain unchanged. Derived writes merge atomically inside one IndexedDB read/write transaction, preserve unknown future fields, and protect reviewed assignments and reviewed canonical decisions unless an explicit reviewed replacement is requested. Batch writes, paged reads and version rollback are bounded to at most 500 records per operation. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v89. No migration, canonical aggregate switch, R2 access, provider call, production workflow, or production-data change was included.

v90 / Listening Build 3.2C is merged through PR #65 as commit `1ac73087973590e976d2746f718796c29e1e3833`. It adds the bounded resumable local migration runner over the immutable source-history store. The runner reads stable-ID pages of at most 500 events, writes versioned identity and conservative unique canonical baselines through the 3.2B derived database, and advances its local checkpoint only after both derived batches succeed. It verifies source counts before and after each chunk and fails closed if the archive changes. Exact normalized stored-band names map to a stable BANDMARKR band ID only when that normalized name resolves uniquely; ambiguous duplicate names remain unresolved, while an explicit stable band ID remains authoritative. The runner is loaded and cached in the v90 PWA shell but does not run automatically. No real archive migration, R2 access, provider call, visible-statistics switch, production workflow or production-data change was included.

Build 3.2D is the next separately approved stage. Its intended purpose is archive-scale candidate validation and aggregate audit using synthetic archive-shaped fixtures before any production migration or visible aggregation switch. Production archive processing, R2 writes, provider backfills and switching screens to canonical aggregation remain separately authorized actions.

Build 3.3 remains planned to add trusted Spotify links for Top Track and Top Album titles using stored Spotify identity and the existing past-setlist interaction pattern, alongside later grouping and artwork work. It does not begin until the remaining Build 3.2 implementation and rollout stages are separately approved. Offline Concert Access has been permanently removed and is not part of the plan.

ListenBrainz is now connected on the user's primary mobile device and disconnected on the computer. The mobile device is the primary synchronization device; other connected LiveVault devices continue restoring shared listening updates from the private R2 manifest without needing the ListenBrainz token. The private token is stored only in the mobile browser and is not present in GitHub, Cloudflare configuration, logs or project documentation.

## Build 3.2 identity, canonical and storage state

- Source Spotify and ListenBrainz observations remain immutable evidence.
- Explicit BANDMARKR `bandId` is authoritative over derived `localBandId` when both exist.
- Derived identity records preserve BANDMARKR band IDs, MusicBrainz IDs, Spotify IDs, provider provenance and protected reviewed decisions.
- Canonical-listen relationships suppress duplicate aggregation only; they never delete source observations.
- Automatic duplicate evidence is limited to exact provider IDs, exact recording MBIDs within 1,000 ms, or exact Spotify track IDs within 1,000 ms.
- Trusted Level 4 release evidence is probable only when the release identity and normalized artist/title recording signature match and both durations are known, positive and within 2,000 ms; artist/title, live, remix, cover, tribute and same-name text evidence never auto-merges.
- Unknown duration is never fabricated and does not block exact-ID evidence.
- Derived identity and canonical records live in a separate disposable local database rather than the source-history database.
- Derived storage operations are bounded to 500 records and support deterministic pagination and resumable version rollback.
- Reviewed decisions and their relationship fields survive automated reruns; replacement requires an explicit reviewed-write option.
- The v90 migration runner is chunked, resumable, idempotent, additive and rollback-safe for archive-scale local processing.
- Migration checkpoints advance only after both identity and canonical writes succeed.
- Migration integrity checks source counts before and after every chunk and fails closed when they differ.
- Exact normalized band-name mapping is accepted only when one stable BANDMARKR band ID owns that normalized name; ambiguous duplicate names remain unresolved.
- Candidate audit reports pair evidence counts only and do not claim a canonical reduction before one-to-one assignment.
- Audit output is aggregate-only and excludes names, titles, raw timestamps, URLs, tokens and payloads.
- Existing screens continue using current source-event aggregation until later Build 3.2 stages are separately approved.

## v81 listening-insights product state

The intended listening-insights contract remains:

- Start Top Bands uses the rolling latest two weeks and compares movement with the preceding two weeks.
- Top 100 offers 2 weeks, 3 months, 1 year and All time, resetting to 3 months on entry.
- Band Detail Listening resets to 1 year and Top Tracks on page entry, while preserving timeframe and Tracks/Albums selection while that Band Detail page remains open.
- Valid events with unknown duration count as listens while contributing no invented time; relevant UI explains known-duration time totals.
- Top Bands remains ranked by known listening time; Top Tracks and Top Albums are ranked by listen count.
- Listening Stats retains a three-month three-metric summary, adds a continuous yearly-hours chart, and gives both yearly charts independent mobile tap details and browsing state.
- The Start header displays `APP_VERSION` and provides a controlled service-worker update check with a bounded single reload without clearing credentials, settings, IndexedDB or remote data.
- Album artwork requires an existing stable identity; unresolved albums use a neutral placeholder and no text-only guessing.

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

## v80 ListenBrainz production state

The deployed v80 implementation provides:

- direct browser validation of a private ListenBrainz user token;
- bounded incremental fetching after the latest stored timestamp;
- deterministic overlap deduplication by stable ID and timestamp/artist/track fingerprint;
- preservation of available MusicBrainz recording, release and artist identifiers;
- provider-neutral IndexedDB events without weakening the historical Spotify import rules;
- immutable compressed objects at `listening/listenbrainz/YYYY-MM/<sha256>.json.gz`;
- conditional `listening/manifest.json` updates after each object is durable;
- integrity-checked incremental restore on other devices;
- six-hour in-use automatic sync plus a manual **Sync now** action;
- device erasure of the locally stored ListenBrainz token;
- synthetic tests and public-QA exclusion of all private sync modules.

Missing ListenBrainz duration remains unknown and is never fabricated. One primary synchronization device is recommended to reduce avoidable concurrent manifest updates. Other devices do not need the ListenBrainz token to restore incremental listening objects from R2.

## v79 Cloudflare Git Builds setup

- `wrangler.jsonc` names the existing Worker `concert-tracker-api`.
- Entry point remains `worker.js`.
- R2 binding remains `BUCKET` connected to `concert-tracker-data`.
- Runtime secrets remain stored only in Cloudflare.
- Production builds use `main`, root `/`, no build command, deploy command `npx wrangler@4.114.0 deploy`, and build variable `NODE_VERSION=22`.
- Build watch include paths are limited to `worker.js`, `wrangler.jsonc`, `package.json`, and `package-lock.json`.
- Non-production branch builds remain disabled.

Automatic Worker deployment does not authorize R2 data changes, migrations, secret changes, production workflows or provider calls.

## Focused research workflows

Structured Ticketmaster/Spotify research runs Monday, Wednesday and Friday at 01:00 UTC. Focused Tavily/Groq concert discovery runs on the 1st and 15th at 02:00 UTC. Both use the shared production-write concurrency group, UsageTracker controls and conditional writes.

The visible Releases feed accepts only actual Spotify catalogue releases with a trusted Spotify release ID and album URL. Concert alerts derive only from `concerts.json`; `news.json` remains the compatibility container for Spotify release items.

## Data ownership and safety

Bands and concerts preserve stable IDs, user-owned fields, provider ownership boundaries and unknown future fields. Listening source events remain distinct from derived LiveVault-band mapping, identity relationships and optional album metadata.

QA uses fictional listening fixtures and the fake backend only. Automated tests may never contain the real archive, call the production Worker or send history to providers.

## Development workflow

Approve scope, create a branch, implement and test with synthetic data, maintain state/decisions/build facts, push and open a PR, then merge only after explicit `Merge it`. A merged change to watched Worker deployment files may deploy the reviewed Worker automatically. App-only and documentation-only changes do not trigger the Worker. R2 writes, migrations, secrets and production workflows remain separately authorized.