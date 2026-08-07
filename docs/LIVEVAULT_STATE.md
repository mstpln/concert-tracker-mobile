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

v91 / Listening Build 3.2D is merged through PR #67 as commit `e7be4367c7d6cd9930868151c89bc7f7c4b79eb9`. It validates conservative duplicate-candidate processing against a generated 250,001-event synthetic archive, applies trusted Levels 1–3 one-to-one, and preserves all overlapping probable or ambiguous alternatives as grouped review records. Review groups live in the separate disposable local database `bandmarkr-listening-review-v1`; they never replace or share keys with real canonical source-event records. Settings → Review shows local artist, track, timestamp and source context before a durable duplicate decision. Ordinary unresolved identity baselines are not included in this queue. **Decide later** is session-only. A pair-level merge resolves only the displayed relationship and leaves every unresolved alternative pending; later sequential merges flatten all connected source records to one canonical representative instead of creating canonical chains. **Keep all separate** resolves the remaining group without changing source observations. Partial and completed user decisions survive unchanged candidate-plan reruns. Candidate and review persistence remain bounded to batches of at most 500 records, aggregate audit output contains counts only, and review rollback exposes a continuation cursor while retaining user-owned decisions. Progress and safe-resumption status remain local. No real archive processing, R2 access, provider call, production workflow, deployment, source-observation edit or visible-statistics switch was included.

v92 / Build 3.2 activation is merged through PR #68 as commit `c7a05bfe4d52a9b09313f472d803c16588b7953f`. Settings → Review adds a two-step local flow: **Prepare cleaned totals** creates and verifies derived identity, canonical and review records from the private browser history; **Use cleaned totals** explicitly switches visible listening screens to canonical representatives. Preparation does not change visible totals. Activation excludes only confirmed automatic or user-reviewed duplicates, while probable and ambiguous matches remain counted separately until reviewed. It refuses to activate if canonical coverage is incomplete or the source history count changed. Once active, a later history change marks the activation stale and falls back to original source totals until preparation is run again. Source observations, R2 objects and provider data remain unchanged. Automated validation uses synthetic fixtures only.

v93 / Listening Build 3.2 recovery is merged through PR #69 as commit `b3a028d0551c89e6e06ded2d9c7f6403de8a3ad0`. It detects abandoned or stalled preparation, preserves checkpoints and derived/source records, shows safe retry progress, and never activates cleaned totals automatically. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v93. The user subsequently confirmed on the primary phone that preparation completed, cleaned totals were explicitly activated, zero confirmed duplicate listens were excluded, and the visible totals appeared accurate. Those results are user-confirmed physical validation, not independently verified by GitHub.

v94 / Listening Build 3.3A1 is merged through PR #73 as merge commit `a37453ed01b9b1a69f412fda9bf10449f1fba3af`. It audits every band without a trusted Spotify artist ID, calculates affected listening-history counts locally, identifies duplicate Spotify-ID conflicts, and separates rows with already-stored exact candidates from rows that require future candidate acquisition. Settings → Review adds a narrow Spotify artist review section with explicit manual confirmation or rejection only; no candidate is selected automatically. Durable decisions remain under `band.musicbrainz.spotify`, while audit values remain derived and disposable. Stale candidate confirmations and rejections fail closed, explicit historical band IDs remain authoritative, and identity writes use conditional concurrency without merging stale review decisions. v94 uses synthetic QA only and makes no provider calls, production workflow runs, R2 changes, listening-source edits or automatic activation changes.

v95 / Listening Build 3.3A2 is merged through PR #75 as merge commit `166aa599193a269f24713356f02206b4cc5ea45d`. It adds a bounded, manually dispatched, main-only Spotify candidate-acquisition workflow for bands labelled as requiring candidate acquisition. Spotify search results are retained only as review candidates under `band.musicbrainz.spotify`; the runner never confirms a Spotify identity automatically. Exact provider fields returned for candidates are preserved, including Spotify ID, name, URL, genres, image metadata, followers and popularity. Candidate writes reread `bands.json`, merge by stable band ID, preserve unknown and user-owned fields, protect confirmed and rejected decisions, skip stale rows, never recreate deleted bands, use UsageTracker caps and pacing, and make no hidden retry. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v95. Automated validation uses synthetic data only. The user subsequently authorized and ran bounded production candidate acquisition, then manually reviewed the resulting Spotify links.

The controlled five-band provider-identity correction is complete. PR #76 merged as `b5dbb9d6482e8521b95ba6c7e5e931aaeaeb57e3`. The manually dispatched production workflow validated five targets and updated five bands: The Technicolors, Maudlin Strangers, James and the Cold Gun, The Plan and LE SSERAFIM. The user then confirmed in the production app that no unresolved Spotify artist identities remained and manually checked the five updated bands. The workflow preserved stable IDs, user-owned fields, unrelated provider records and unknown future fields. `APP_VERSION` and `CACHE_NAME_LITERAL` remain synchronized at v95.

v96 / Build 3.3B — Toplist merged through PR #78 as merge commit `f7a3e54c13f80c72b8334082fea4c96e21792ac1`. It renames the Top bands destination to Toplist, adds Top Bands and Top Tracks segmented tabs, retains 2 weeks, 3 months, 1 year and All time for both views, defaults a fresh visit to Top Bands and 3 months, preserves tab and timeframe state while the page remains open, and adds conservative global Top Tracks ranking. Tracks group only through trusted recording identity; unresolved events remain separate rather than being collapsed by text. Physical-device review then found that the Stats preview still used the old Top Bands-only card and that the dedicated Toplist tabs were outside the ranking card without the agreed dynamic timeframe heading.

v97 merged through PR #79 as merge commit `80f93b6f32be2f00fcfb58d22aa1174b19bb54e1`. It places Top Bands / Top Tracks tabs inside the same ranking card on both the Stats preview and dedicated Toplist screen, follows the established in-card segmented-tab pattern, and shows a dynamic `TOP BANDS · <TIMEFRAME>` or `TOP TRACKS · <TIMEFRAME>` heading directly below the tabs. Physical-device review confirmed the correction and then identified a smaller visual inconsistency: the Band Detail and Toplist-family segmented controls did not share identical full-width geometry and spacing around the following heading or content.

v98 merged through PR #80 as merge commit `f2b41463f701676e64e904ca677001ecb43b5b4b`. It applies one full-width segmented-control pattern to Band Detail Top Tracks / Top Albums, the Stats Toplist preview, and the dedicated Toplist screen, with shared 42px tab height, padding, radius, active state, typography and a balanced 10px gap before the following timeframe heading or content. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v98. Automated validation passed with synthetic desktop and mobile QA. The user subsequently confirmed on the installed PWA that v98 loaded and that the unified tab geometry and spacing look correct. No production data, provider calls, Worker logic changes or production workflows were involved. The Listening Stats overview card, trusted Spotify track and album links, identity-backed artwork and selected-year genre-detail reconciliation remain deferred to later focused Build 3.3 slices. General App Updates remain deferred to issue #72. Offline Concert Access has been permanently removed and is not part of the plan.

v99 / Build 3.3C merged through PR #82 as merge commit `0f491bcc186f884fcaf850572d8167dcf65809e3` and is live. It adds exact Spotify track links and identity-backed artwork to the Listening Stats Top Tracks preview, dedicated Toplist Top Tracks, and Band Detail Top Tracks, plus exact Spotify album links and artwork in Band Detail Top Albums. Only already-stored trusted Spotify track IDs are eligible. A manual **Fetch listening artwork** action resolves those IDs through Spotify in batches of 50 with a hard 5,000-track cap per run, stores derived track URL, album ID, album URL and artwork URL separately from immutable source listens in local IndexedDB and private R2 at `listening/spotify-metadata.json`, and uses conditional writes that fail closed on stale data. Missing, malformed, conflicting or unresolved identity remains non-clickable with the neutral placeholder. The user confirmed v99 loaded, then reported that Settings showed the existing Spotify playlist connection as connected while the artwork action reported Spotify was not connected.

v100 merged through PR #83 as merge commit `65de671fdcd8d87e1c6e9b00002e11f892f4d889`. It addresses the installed-PWA mixed-shell upgrade case in which the v99 metadata module can load beside the older v98 Spotify authorization module, whose public object lacks `request` and `validAuth` even though the saved PKCE authorization remains present and Settings therefore shows **Disconnect**. The compatibility layer adds only those missing request helpers, reuses the existing token storage and refresh implementation, requests no new scope, and leaves the current v99 implementation unchanged. Synthetic browser coverage proved that the existing saved authorization could be reused through that compatibility path. After merge, physical-device testing still reported **Spotify permissions are missing. Connect again.**, which established that the remaining failure was downstream of connection compatibility rather than a missing saved Spotify authorization.

v101 merged through PR #84 as merge commit `63cd937e6baa27d4348380fe8105e48bff4c0c75`. It replaces the removed Spotify batch-track metadata request with exact single-track `GET /tracks/{id}` requests, still using only already-stored trusted Spotify track IDs. The manual artwork action processes at most 500 tracks per run, spaces requests by 150 ms, persists local progress every 25 tracks, honors one bounded `Retry-After` wait for HTTP 429, treats an exact 404 as unresolved, and no longer tells a still-connected user to reconnect merely because Spotify returns HTTP 403 for metadata. The existing PKCE authorization, playlist scope, local metadata store, conditional private-R2 write path and immutable source listens remain unchanged. After merge, physical-device testing reached Spotify successfully but reported **Spotify returned an invalid track metadata response.** Investigation showed that v101 incorrectly required the provider-returned track ID to equal the requested trusted ID, which is not safe when Spotify relinks a track for the supplied market.

v102 merged through PR #85 as merge commit `f52937df1dc366cb29856f3f42eae2a127197dc4`. It accepts a successful Spotify Track response when the returned provider track ID is valid, while preserving the original requested trusted Spotify track ID and URL as BANDMARKR's metadata identity and storage key. Album and artwork metadata come from the provider response; when Spotify returns a different valid ID, that resolved ID is retained only as separate derived audit metadata and does not replace source identity. Malformed successful responses still fail closed. Physical-device testing then reached Spotify successfully but received HTTP 429, establishing that the remaining problem is Spotify Development Mode rate/quota enforcement rather than connection or relinking logic.

v103 merged through PR #86 as merge commit `b8589009402c5fbc05497c430280e75d7207e73a`. The manual artwork action owns a persisted logical run of at most 100 unresolved trusted Spotify track IDs, spaces calls by 1,000 ms, saves local metadata after every processed track, and requires an explicit new tap after the PWA leaves the foreground. Resumption continues the same remaining logical batch rather than creating a fresh allowance. Ordinary HTTP 429 handling is bounded and structured `QUOTA_EXCEEDED` stops immediately with clear feedback. The v102 trusted-ID/relinked-metadata identity rules remain unchanged and `APP_VERSION` / `CACHE_NAME_LITERAL` are synchronized at v103. Physical-device testing then reached Spotify and reported the Development Mode quota-exhausted condition, confirming that BANDMARKR now identifies the provider quota state rather than misdiagnosing connection or track identity.

The one-time historical Spotify listening-artwork backfill is being prepared on draft PR #87 / `maintenance/spotify-artwork-backfill-plan`. It remains outside the app and does not bump v103. The branch contains a pure resumable core, a network-free synthetic dry-run, a verified source reader for the immutable Spotify archive plus ListenBrainz incrementals, a gated local maintenance engine, and a supported production entrypoint that routes real Spotify provider operations through `UsageTracker`. The initial production plan is 25 track requests per invocation, at least 1,000 ms pacing and a hard logical ceiling of 100. Completed results are checkpointed locally under ignored `.livevault-maintenance/`, a fully staged logical batch is not expanded until synchronized, relinked provider IDs remain derived audit metadata only, and metadata writes use ETag/create-only conditions. Private reads/live Spotify calls and production metadata writes have separate explicit authorization gates. Automated work on PR #87 is synthetic only; no live Spotify backfill call, production listening read, production R2 write or production workflow has been executed.

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
- Duplicate review groups live in their own disposable `bandmarkr-listening-review-v1` database and never occupy canonical source-event keys.
- Derived and review storage operations are bounded to 500 records and support deterministic pagination and resumable version rollback.
- Partial and completed user decisions survive unchanged candidate-plan reruns; replacement requires an explicit reviewed-write option.
- The v90 migration runner is chunked, resumable, idempotent, additive and rollback-safe for archive-scale local processing.
- Migration checkpoints advance only after both identity and canonical writes succeed.
- Migration integrity checks source counts before and after every chunk and fails closed when they differ.
- Exact normalized band-name mapping is accepted only when one stable BANDMARKR band ID owns that normalized name; ambiguous duplicate names remain unresolved.
- v91 candidate assignment processes trusted automatic candidates first, is one-to-one, and rejects conflicting reuse of either source event.
- Probable and ambiguous alternatives remain review-only, are grouped without loss, and never edit source history or replace canonical baselines.
- Candidate persistence is bounded to batches of at most 500 records.
- The Settings review queue contains only probable or ambiguous duplicate groups with local source context; baseline unresolved identities are excluded.
- **Decide later** does not create a durable decision; completed duplicate-group decisions are local and user-owned.
- A pair-level merge removes only that displayed relationship from review. Remaining alternatives stay pending.
- Sequential pair merges flatten every connected source record to one canonical representative and never leave duplicate-of chains.
- **Keep all separate** changes no additional canonical source record and resolves only the remaining alternatives in the group.
- Review rollback retains user-owned decisions and returns a continuation cursor when more than one bounded page remains.
- Synthetic archive-scale validation covers 250,001 fictional events and does not include real listening data.
- Candidate audit reports pair evidence counts only and do not claim a visible canonical reduction.
- Audit output is aggregate-only and excludes names, titles, raw timestamps, URLs, tokens and payloads.
- v92 preparation and activation are explicit separate actions; preparation alone never changes visible totals.
- v92 activation excludes only confirmed duplicate relationships and leaves unresolved alternatives counted separately.
- v92 fails closed to source-event totals when derived coverage is incomplete or listening history changes.
- v93 treats persisted or stalled **Preparing** state as retryable, never as evidence that work is still running.
- v93 preserves the bounded migration checkpoint and source history across interruption, and never activates cleaned totals automatically.
- The real archive is processed only by the installed browser after the user explicitly starts preparation; development, QA and GitHub never receive that history.

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
