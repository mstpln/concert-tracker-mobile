#!/usr/bin/env bash
set -euo pipefail
mkdir -p '.github/workflows'
cat > '.github/workflows/research.yml' <<'__LIVEVAULT_FILE_00__'
name: Weekly concert & news research

on:
  schedule:
    # 01:00 UTC every Thursday — lands at ~02:00-03:00 Swedish local time
    # (CET/CEST), depending on daylight saving. Running overnight means the
    # slow, deliberately-throttled pace (the pipeline paces Groq calls to
    # stay safely under its free-tier rate limits, so a full run can take a
    # couple of hours) never competes with anything and finishes long
    # before morning. GitHub Actions cron can run a few minutes late at
    # busy times — that's fine for a weekly job.
    - cron: '0 1 * * 4'
  workflow_dispatch: {} # lets you trigger a run manually from the Actions tab, for testing

permissions:
  contents: read

concurrency:
  group: live-vault-data-writes
  cancel-in-progress: false

jobs:
  research:
    runs-on: ubuntu-latest
    # Generous ceiling — the pipeline throttles itself well within this,
    # this just stops GitHub from killing a legitimately slow, safe run.
    timeout-minutes: 300
    steps:
      - name: Check out repo
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run research pipeline
        env:
          TICKETMASTER_API_KEY: ${{ secrets.TICKETMASTER_API_KEY }}
          TAVILY_API_KEY: ${{ secrets.TAVILY_API_KEY }}
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          SETLISTFM_API_KEY: ${{ secrets.SETLISTFM_API_KEY }}
          SPOTIFY_CLIENT_ID: ${{ secrets.SPOTIFY_CLIENT_ID }}
          SPOTIFY_CLIENT_SECRET: ${{ secrets.SPOTIFY_CLIENT_SECRET }}
          CF_WORKER_ENDPOINT: ${{ secrets.CF_WORKER_ENDPOINT }}
          CF_WORKER_TOKEN: ${{ secrets.CF_WORKER_TOKEN }}
        run: node scripts/research.js

      - name: Generate structured release lifecycle alerts
        env:
          CF_WORKER_ENDPOINT: ${{ secrets.CF_WORKER_ENDPOINT }}
          CF_WORKER_TOKEN: ${{ secrets.CF_WORKER_TOKEN }}
        run: node scripts/process-release-alerts.js
__LIVEVAULT_FILE_00__
mkdir -p '.github/workflows'
cat > '.github/workflows/release-alerts.yml' <<'__LIVEVAULT_FILE_01__'
name: Daily release lifecycle transitions

on:
  schedule:
    # Provider research remains weekly. This lightweight pass reads only the
    # existing canonical release observations so exact seven-day and release-day
    # lifecycle events are not limited to the weekday of the research run.
    - cron: '20 0 * * *'
  workflow_dispatch: {}

permissions:
  contents: read

concurrency:
  group: live-vault-data-writes
  cancel-in-progress: false

jobs:
  release-alerts:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Check out repo
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Generate structured release lifecycle alerts
        env:
          CF_WORKER_ENDPOINT: ${{ secrets.CF_WORKER_ENDPOINT }}
          CF_WORKER_TOKEN: ${{ secrets.CF_WORKER_TOKEN }}
        run: node scripts/process-release-alerts.js
__LIVEVAULT_FILE_01__
mkdir -p 'docs'
cat > 'docs/LIVEVAULT_STATE.md' <<'__LIVEVAULT_FILE_02__'
# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by an authenticated Cloudflare Worker and private R2. The production data files remain `bands.json`, `concerts.json`, `news.json`, and `apiUsage.json`; ticket PDF bytes are separate authenticated R2 objects. The structured release-alert feature branch uses `APP_VERSION` and the service-worker cache literal v69. It does not add a release collection, production migration, Worker allowlist change or deployment; production remains on the currently merged build until the feature PR is explicitly merged.

## Product purpose and navigation

This is a single-user concert tracker for followed bands, upcoming shows, attended history, alerts/news, venues, statistics and user-owned concert preparation. Structured release data is an internal identity, matching, deduplication and lifecycle layer rather than a browsable discovery product. Bottom navigation remains **Concerts**, **Dates**, **Bands**, and **Alerts**, with MYCONCERTS, CONCERTDATES, MYBANDS and ALERTS headers. There is no Releases screen, discography, album/song browser, release search or additional navigation item.

## Major screens

My Concerts shows summary cards, upcoming/attended shows and preparation. Concert Dates provides concert and venue browsing. My Bands lists followed artists. Alerts has alerts/news subtabs. Settings contains usage, identity coverage and app options. Statistics summarises concert history. Band profiles retain a permanent header and use Concerts, Alerts, News and Data tabs; Concerts is default. Tabs filter by stable `bandId`, support ArrowLeft/ArrowRight/Home/End, and restore focus after rerender.

Structured release lifecycle cards appear only in the existing main Alerts view and the matching artist profile's Alerts tab. They extend the existing alert cards with **ALBUM ANNOUNCED**, **NEW SINGLE**, **UPCOMING RELEASE** and **OUT TODAY** tags, compact optional artwork or a stable placeholder, release title/type/date, source context and a direct **Open in Spotify** action only when a trusted release URL is available. Editorial News remains separate from lifecycle alert records.

## Concert preparation and show day

Upcoming attending concerts support a readiness checklist, manual or generated playlist state, weather, predicted setlist, owned tickets and directions. Past cards can show actual setlists, Spotify song links, ratings, notes, photos and live-performance insights. One saved ticket uses the established yellow ticket CTA with an outlined directions CTA beside it; two PDFs use equal Ticket 1/Ticket 2 controls and full-width outlined directions beneath. Show-day behaviour remains limited to implemented countdown/ticket actions.

## Data model and ownership

Bands contain stable IDs, artist identity and follow state. Concerts contain stable IDs, date/venue/source observations and additive preparation/research data. Alerts/news use stable band IDs. User-owned fields include attendance, manual concerts, ticket price/quantity, ticket PDFs/links, playlists, checklist, ratings, notes, photos, favourites, mute state, alert read/saved/dismissed state and review decisions. Provider-owned fields are confined to their owned allowlists. Research-owned fields include predictions, observations and insights. Browser-local state includes settings, caches and OAuth state. R2 stores JSON and private ticket bytes; PDF metadata lives with the concert record.

Canonical releases remain under each band's additive `structuredResearch.releases` state. Records retain stable internal identity, `bandId`, normalized matching title, release type/date precision, provider observations and IDs, evidence references, first-seen/update timestamps, baseline/continuation state and durable lifecycle-stage timestamps and alert IDs. MusicBrainz owns release-group identity/type/date fields, Spotify owns Spotify IDs/URLs/artwork/availability, Tavily pages remain evidence and Groq remains extraction-only. Unknown fields, provider baselines and user fields are preserved.

## Identity and research

MusicBrainz MBID is the artist backbone. Ticketmaster attraction and Spotify artist identifiers are nested under the MusicBrainz identity. `confirmed`, `manual_confirmed` and `auto_confirmed` are trusted; `needs_review`, `no_match`, `error` and manual rejection retain retry/candidate metadata. Settings reports coverage, duplicates and review candidates without raw identity editing.

Research uses Ticketmaster, Tavily, Groq, MusicBrainz, Spotify, setlist.fm and geocoding through UsageTracker pacing/caps. MusicBrainz and Spotify remain the primary structured release sources; Tavily/Groq is a targeted fallback for genuinely new announcements that structured providers do not yet contain. The lifecycle postprocessor reuses observations created by `processStructuredResearch` and makes no provider calls. Coordinated writes persist deterministic alerts before band stage state, reread the latest documents and merge only intended fields so a retry repairs partial writes without duplicate alerts.

## Structured release lifecycle

A canonical album or EP may generate separate lifecycle events. **ALBUM ANNOUNCED** is generated once for a genuinely new formal announcement and can exist without a date, artwork or Spotify URL. **NEW SINGLE** is generated once only when a trusted artist-linked single is confirmed available; v1 has no advance single-announcement or upcoming-single stage. **UPCOMING RELEASE** is generated once exactly seven days before a full album/EP release date, except when its announcement stage was generated in the previous 14 days. **OUT TODAY** is generated once on a full album/EP release date and does not require Spotify. A clearly typed, unambiguous new live album may use only the **OUT TODAY** stage on its exact full release date; it does not receive announcement or upcoming stages in v1.

MusicBrainz/Spotify first scans, incomplete/resumed baselines and historical catalogue anchors remain silent. A future observation encountered during an incomplete feature-activation baseline stays inactive until that provider baseline completes, after which it can become eligible for later date transitions without backfilling an announcement. A newly encountered post-activation provider observation without its expected structured event remains an inactive provider-baseline anchor. Existing completed provider keys are never reset or re-keyed. Compilations remain silent identity/deduplication anchors. Clear new live albums may generate a single **OUT TODAY** event on an exact full date, while ambiguous/undated live records remain silent; they do not generate announcement or upcoming stages in v1. Deluxe/expanded/anniversary editions, remasters, reissues, remix packages and other excluded variants also remain silent. A later Spotify-only album/EP that reuses the title of an older MusicBrainz release is held for review unless independent announcement evidence shows it is genuinely new. Conservative matching prefers exact provider IDs, then stable `bandId` plus compatible normalized title/type/date evidence; uncertain records remain separate.

Legacy generic structured album alerts are handled lazily and additively. A confidently matched legacy record can become the existing lifecycle alert and receive later Spotify/artwork enrichment without changing its ID, `foundAt`, read/saved/dismissed state, notes or unknown fields. Browser rendering also handles safe legacy structured records before the next research pass. No destructive production migration is required.

## Ticketmaster precedence and data safety

Ticketmaster can enrich an existing Tavily/Groq concert in place only for confident matches. Exact event-ID matches also require the same band and date. Fallback matching requires compatible band/date/city/country and venue evidence. Different dates, IDs or ambiguous records remain separate; the app does not interpret cancellation or rescheduling. Stable IDs are never recreated, user fields and unknown future fields survive, and latest remote records are reread before merging.

## Design rules

The app is mobile-first. Focused changes preserve unrelated blue/black/grey/white design, text-only top banner, current headers, bottom navigation, ticket CTA hierarchy and profile tabs. Reuse existing renderers/icons; maintain accessible controls, narrow-width readability and no horizontal overflow. Release artwork stays square and compact inside alert cards, lazy-loads, preserves card layout on failure and is never the only information source.

## Completed features

Readiness checklist; playlist builder; concert weather; predicted and actual setlist support; live-performance insights; owned tickets; MusicBrainz/provider identity backbone and backfill; identity-aware research; band-profile tabs; contextual links; Ticketmaster source precedence; updated bottom navigation; structured release identity, canonical matching, baseline protection and four-stage release-alert lifecycle.

## Active backlog

1. Concert Map View
2. Expanded Backup, Restore and Export
3. Native Push Notifications

## Intentionally excluded

Cancellation/reschedule monitoring, repeated concert freshness verification, freshness/cancellation badges, broad source-conflict UI, a conflict-review queue, social features and multi-user features are excluded until explicitly reconsidered. Release discovery, a Releases screen/tab, discography/song lists, Spotify browsing, advance single announcements and recurring release reminders are also excluded.

## Known limitations

Provider research remains weekly, while a lightweight provider-free lifecycle workflow checks stored canonical release dates daily. It is still in-app rather than real-time push delivery. Exact seven-day and release-day stages require full `YYYY-MM-DD` dates; month/year dates can support announcements but not date transitions. Spotify actions appear only for a strictly validated direct release URL linked to the trusted artist identity, with the followed artist first in Spotify's credited-artist order. A later guest credit alone is never trusted. Live albums are classified conservatively; only a clear provider-backed record with an exact full date can receive **OUT TODAY**, so weekly provider discovery may miss a same-day event when the provider record arrives later. Spotify's broad `album_type=single` bucket is kept stable for existing baseline keys, so a Spotify-only EP can remain conservatively typed as a Single until MusicBrainz or other trusted cross-provider evidence refines it. Artwork is provider-owned and may be absent or change; existing alerts retain enough snapshot metadata to remain displayable.

## Development workflow and QA

Approve scope, use a branch, implement and test, maintain state/build state, push and review a PR, then merge only after explicit `Merge it`. Pull GitHub Desktop only before later local Codex work. The webview-first foundation is active: deterministic synthetic fixtures, a local fake Worker/storage layer, QA-only build output, desktop/mobile Playwright coverage, a separate manual PWA workflow, isolated offline service-worker validation, PR safety checks, sanitized production-smoke support and continuity documentation are in place. QA service workers use their own cache namespace and remove only obsolete QA caches, never unrelated or production-named caches.

Release QA adds deterministic fixtures for all four lifecycle tags, artwork/placeholder/broken-art handling, trusted/untrusted Spotify actions, date precision, cross-provider enrichment, duplicate sources, legacy state, baseline states, muted artists, excluded variants and stable profile filtering. Browser QA verifies main/profile Alerts, News separation, existing concert alerts, reload persistence, desktop/mobile overflow, unexpected networks, console/page errors and offline shell loading. Workflow validation also enforces that the daily lifecycle job receives no provider credentials and shares the production data-write concurrency lock. Physical installation and real-device mobile Chrome behaviour still require device-specific manual verification; this feature has no real-device claim until that is performed.
__LIVEVAULT_FILE_02__
mkdir -p 'docs'
cat > 'docs/LIVEVAULT_DECISIONS.md' <<'__LIVEVAULT_FILE_03__'
# LiveVault Decisions

## 2026-07-18 — GitHub main is authoritative

**Decision:** Treat merged `main`, not a chat transcript or local clone, as the product source of truth.

**Reason:** Conversations and local checkouts can be stale.

**Consequence:** Inspect main, state, decisions and build state before work; pull local clones before local work.

## 2026-07-18 — Durable project memory lives in the repository

**Decision:** State, decision and generated build-state documents supplement chats.

**Reason:** Work must survive project-chat limits.

**Consequence:** Update durable facts with the matching implementation.

## 2026-07-18 — Concert identity and ownership are preserved

**Decision:** Stable concert IDs, user fields and unknown fields survive enrichment.

**Reason:** Research must never replace a person’s concert history.

**Consequence:** Use in-place, latest-record merges and provider-owned allowlists.

## 2026-07-18 — Ticketmaster precedence is conservative

**Decision:** Ticketmaster may enrich a record only on confident same-band/same-date evidence.

**Reason:** Different dates are not evidence of a reschedule.

**Consequence:** Ambiguous/different records remain separate; cancellation/reschedule monitoring is out of scope.

## 2026-07-18 — Band profiles use four tabs

**Decision:** Band profiles use Concerts, Alerts, News and Data, with Concerts default.

**Reason:** It groups existing information without changing ownership.

**Consequence:** Exact `bandId` filtering and keyboard tab navigation are required.

## 2026-07-18 — Synthetic QA and sanitized smoke

**Decision:** QA uses fictional data; production smoke is read-only and aggregate-only.

**Reason:** Browser review must never expose personal records or use providers.

**Consequence:** QA may be publicly reachable only with synthetic data; `READ_ONLY_TOKEN` is limited to `/qa-smoke`.

## 2026-07-18 — Explicit release authorization

**Decision:** A merge requires the explicit phrase `Merge it`.

**Reason:** A branch, PR, cache bump or passing tests is not deployment approval.

**Consequence:** Version/cache bump together once per build; focused pre-merge corrections stay on that version.

## 2026-07-19 — Structured releases remain an internal layer

**Decision:** Canonical release records remain an internal identity, matching, deduplication and lifecycle layer under each band's existing `structuredResearch.releases` state. Do not add `releases.json`, a Releases screen/tab, discography, song list, release search, Spotify browser or navigation item.

**Reason:** The product objective is timely lifecycle alerts for followed artists, not catalogue discovery, and the existing per-band model already preserves identity, baselines and safe writes without a migration.

**Consequence:** Release information is presented only in the existing main Alerts view and artist-profile Alerts tab, filtered by stable `bandId`. Editorial News remains separate. A separate collection requires a future concrete correctness, contention, size or Worker-limit case and explicit migration approval.

## 2026-07-19 — MusicBrainz and Spotify are primary release sources

**Decision:** MusicBrainz owns canonical artist/release-group identity, type and first-release date; Spotify owns direct release IDs/URLs, artwork and availability. Tavily is a targeted announcement fallback and Groq is extraction/classification only, never a factual source.

**Reason:** Provider roles must match their strengths and factual provenance must be auditable.

**Consequence:** Exact trusted provider IDs are preferred for matching. Spotify ownership requires the followed artist to be the first credited artist; a later guest credit is not enough. Title-only, artist-name-only, guest/compilation appearances and ambiguous Spotify search results are not trusted. Provider fields are merged by ownership, evidence URLs remain attached and uncertain records stay separate.

## 2026-07-19 — Release alerts use four durable lifecycle stages
