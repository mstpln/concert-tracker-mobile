# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker `concert-tracker-api` and private R2 bucket `concert-tracker-data`.

Security Builds 1-3 are deployed. Browser and automation roles are verified, the legacy `API_TOKEN` has been removed, and browser writes were verified afterward. v77 focused research schedules are active and the one-time release-feed cleanup completed successfully.

Listening Build 3.1 and its focused Settings correction are merged and deployed as v78. The production Worker has the listening routes, the private archive and manifest are stored in R2, and a clean incognito browser successfully restored the complete history.

v79 is merged and deployed. The existing `concert-tracker-api` Worker is connected to GitHub through Cloudflare Workers Builds. The first repository-driven deployment completed successfully from merge commit `8deb2f03e6b7e224ce84e9609508eb0b37016d04` using Cloudflare build `6ac9e5e3` after setting the build variable `NODE_VERSION=22`.

v80 is merged and deployed. PR #53 merged as commit `2d47a5b0b066f41da2c95bc3835283311d2e4dda`, and Cloudflare Workers Build `33f08233` completed successfully from `main`. ListenBrainz is connected on the user's primary mobile device; other devices restore shared updates from private R2 without storing the token.

## v81 review state

The v81 listening-insights and app-refresh build is implemented on `feature/v81-listening-insights-refresh` for review and is not merged or deployed.

- Start Top Bands uses the rolling latest two weeks and compares movement with the preceding two weeks.
- Top 100 offers 2 weeks, 3 months, 1 year and All time, resetting to 3 months on entry.
- Band Detail Listening resets to 1 year, uses a five-metric summary and switches between Top Tracks and conservatively grouped Top Albums.
- Valid events with unknown duration count as listens while contributing no invented time; relevant UI explains known-duration time totals.
- Listening Stats retains a three-month three-metric summary, adds a continuous yearly-hours chart, and gives both yearly charts independent mobile tap details.
- The Start header displays `APP_VERSION` and provides a controlled service-worker update check and single reload without clearing credentials, settings, IndexedDB or remote data.
- Album artwork requires an existing stable identity; unresolved albums use a neutral placeholder and no text-only guessing.

## Product purpose and navigation

This is a single-user concert tracker for followed bands, upcoming shows, attended history, concert alerts, Spotify releases, listening history, venues, statistics and user-owned concert preparation. Bottom navigation is **Concerts**, **Dates**, **Bands**, **Stats**, and **Alerts**.

## Listening Vault production state

The validated sanitized Spotify archive contains 250,403 eligible unique track listens from 2009-01-16 through 2026-07-29. Private R2 is the durable source of truth while IndexedDB remains each device's fast offline working copy. Real listening history is never committed, included in QA, written to public artifacts or sent to providers in bulk.

## Data ownership and safety

Bands and concerts preserve stable IDs, user-owned fields, provider ownership boundaries and unknown future fields. Listening source events remain distinct from derived mapping and optional metadata. QA uses fictional listening fixtures and the fake backend only.

## Development workflow

Approve scope, create a branch, implement and test with synthetic data, maintain state/decisions/build facts, push and open a PR, then merge only after explicit `Merge it`. R2 writes, migrations, secrets and production workflows remain separately authorized.
