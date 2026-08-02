# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by an authenticated Cloudflare Worker and private R2. The established production JSON files remain `bands.json`, `concerts.json`, `news.json`, and `apiUsage.json`; ticket PDF bytes are separate authenticated R2 objects.

Security Build 1 is merged and manually deployed at **v74**. Security Build 2 is merged at **v75** and adds ETag-based conditional writes and deterministic conflict recovery. Security Build 3 is merged at **v76** and has been manually deployed for staged credential migration. The production v76 Worker accepted reads but returned HTTP 500 on JSON writes because the R2 `onlyIf` option used a generic `Headers` object instead of Cloudflare R2's conditional object shape. The focused correction branch is `fix/v76-r2-conditional-writes`; it keeps v76 unchanged and requires a manual Worker redeploy after merge.

## Product purpose and navigation

This is a single-user concert tracker for followed bands, upcoming shows, attended history, alerts/news, releases, venues, statistics and user-owned concert preparation. Bottom navigation is **Concerts**, **Dates**, **Bands**, **Stats**, and **Alerts**. Settings, band profiles, Full Top Bands and venue details are secondary screens.

## Major screens

My Concerts shows a three-band listening preview, the compact concert summary, upcoming/attended shows and preparation. Concert Dates provides concert and venue browsing. My Bands lists followed artists. Alerts has alerts/news subtabs. Settings contains usage, identity coverage, app options and private listening-history import controls. Stats is a primary destination with Listening and Concerts subtabs; Listening is default and the existing concert-statistics content remains under Concerts. Band profiles use Concerts, Alerts, News, Listening and Data tabs.

## Listening statistics and private history

Historical Spotify listening data is imported only from a sanitized LiveVault file into browser-local IndexedDB. The raw Spotify ZIP and sanitized personal history are never committed, added to QA, written to R2 or sent to providers in bulk. The import excludes Spotify Kids, podcasts, video, audiobooks and plays shorter than 30 seconds. Retained event fields are timestamp, artist, track, album, played duration, Spotify track ID, deterministic stable ID and source marker.

The sanitized import contains 250,403 eligible unique track listens from 2009-01-16 through 2026-07-29. Imported artist names are matched conservatively to existing LiveVault bands. Listening statistics intentionally include only events mapped to bands already present in LiveVault.

## v74 focused security hardening

The live v74 release adds proportionate direct-risk protections:

- browser navigation permits same-origin links and HTTPS external links only, adds `noopener noreferrer`, and blocks unsafe schemes;
- Excel export and its third-party SheetJS runtime are removed; CSV export remains;
- the document declares no-referrer and compatible content-security policies;
- Worker JSON writes require JSON, are limited to 10 MB, and validate expected root types;
- authenticated Worker responses use private no-store, no-referrer and nosniff headers;
- service-worker cache cleanup is scoped to Live Vault caches.

## v75 stale-write protection

The merged v75 release adds one concurrency contract across the browser, Worker and GitHub Actions writers:

- JSON reads expose R2 ETags;
- existing-document writes require `If-Match`, creation uses `If-None-Match: *`, and R2 performs the condition atomically;
- stale writes receive HTTP 412;
- browser and automation clients reread once, perform the shared deterministic three-way merge and retry once;
- stable IDs, remote additions, unknown fields, user-owned fields and unrelated provider updates are preserved;
- remotely changed records are protected from stale deletion;
- successful conflict recovery updates the caller's in-memory data.

Ticket PDF routes remain outside the document-level merge contract.

## v76 device privacy, credential roles and bounded network work

The merged v76 release adds focused operational hardening without changing stored-data schemas:

- **Disconnect** removes only the Worker URL and token from the current browser while preserving local settings, imported listening history, Spotify authorization and cached tickets;
- **Erase this device** removes the connection, browser settings, Spotify authorization, imported listening history, cached ticket PDFs and Live Vault shell caches, but never deletes remote R2 JSON or permanent ticket PDFs;
- the Worker accepts a browser role for JSON and ticket routes, an automation role for JSON only, and the existing read-only smoke role;
- the legacy `API_TOKEN` remains temporarily supported for a safe staged migration and may be removed after the browser and GitHub Actions use their separate tokens;
- browser and research-pipeline network requests receive a default 30-second timeout unless a caller already supplies its own abort signal;
- the timeout layer performs no hidden retry, so UsageTracker accounting and existing provider-specific retries remain authoritative;
- the production research workflow declares read-only repository permissions and pins checkout/setup actions to reviewed commit SHAs.

The credential rollout is documented in `docs/SECURITY_BUILD_3_ROLLOUT.md`. During rollout, do not remove `API_TOKEN` until browser writes and a scheduled automation run are both verified. The focused v76 correction changes only the Worker-side R2 conditional option shape and its regression coverage.

## Data model and ownership

Bands contain stable IDs, artist identity and follow state. Concerts contain stable IDs, date/venue/source observations and additive preparation/research data. Alerts/news use stable band IDs. User-owned fields include attendance, manual concerts, ticket price/quantity, ticket PDFs/links, playlists, checklist, ratings, notes, photos, favourites, mute state and review decisions. Provider-owned fields remain confined to their owned allowlists. Browser-local state includes settings, caches, OAuth state and imported listening history.

## Design and QA rules

The app is mobile-first. Focused changes preserve the existing blue/black/grey/white design, text-only top banner, navigation, ticket CTA hierarchy and profile tabs. QA uses fictional data and the fake backend only. Automated tests must not contain the user's listening history. Physical installation, large-file picker behavior, mobile storage quotas, installed-PWA cache refresh and final real-device touch/visual review remain device-specific manual checks.

## Active backlog

1. Complete and redeploy the focused v76 R2 conditional-write correction
2. Finish staged browser/automation credential migration and remove legacy `API_TOKEN` only after verification
3. Real ListenBrainz account connection and incremental synchronization
4. MusicBrainz recording/release matching and optional artwork enrichment
5. Concert Map View
6. Expanded Backup, Restore and Export
7. Native Push Notifications

## Development workflow

Approve scope, use a branch, implement and test, maintain state/decisions/build state, push and review a PR, then merge only after explicit `Merge it`. A version/cache bump is not deployment permission. Production workflows, production data writes and provider calls require separate explicit authorization.
