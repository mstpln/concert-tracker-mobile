# The Live Vault — Current State

This document records the currently implemented repository state and important operational continuity facts. GitHub `main` remains the authoritative source of truth; later sections supersede older review-state notes when explicitly stated.

## Build C3 catalogue acquisition state

This section supersedes stale PR #104 review-state text elsewhere in the file where later facts differ. PR #104 merged successfully as `8774ec3a44d000023ef8f8becc1d601e8749d34d`; its C2 head was `861a023d3de8ddde0f146919f35b6f2ab35053d8`. C2 remains the merged production-inert catalogue resolver foundation.

Build C3 is implemented on `feature/listening-catalogue-c3-v112` in PR #105. It adds safe provider adapters and durable catalogue-cache machinery around the merged C2 contract: MusicBrainz release browsing for both `release_artist` and `release_track_artist`, independent resumable scope checkpoints, deterministic multi-scope assembly, exact 30-day demand-driven freshness, the exact derived object `listening/musicbrainz-catalogue.json`, a 25 MiB absolute object ceiling plus structural limits, conditional ETag-safe persistence, exact data-maintenance-only Worker allowlisting, a dormant bounded authenticated ListenBrainz batch adapter, and aggregate-only diagnostics. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v112 and generated build state records v112.

Review hardening on 2026-08-11 closed the first exact-head CI findings and additional cache-boundary gaps found during code review. The existing reviewed MusicBrainz User-Agent is retained while the catalogue path keeps the conservative two-second project pacing. Complete catalogue state must prove an exact 30-day `refreshedAt`/`freshUntil` interval, incomplete catalogue state must retain a valid `refreshStartedAt` resumability marker, and the dormant ListenBrainz batch adapter now has a bounded abort timeout. Node and Worker validators mirror the freshness/checkpoint rules. Focused synthetic tests for these corrections passed before the review-fix commit was pushed; full exact-head PR QA is still required before the PR is considered merge-ready.

C3 does not reopen or migrate existing durable `needs_review`, `retry`, `error`, or `no_match` track/provider states. It does not alter immutable listening observations or user-owned/reviewed identity decisions. The historical v111 production backfill entrypoints are not connected to C3 and remain unauthorized for production use.

C3 development and automated validation are synthetic/fake-backend only. No live MusicBrainz, ListenBrainz or Spotify call, production R2 read/write for the new catalogue, Worker deployment, production workflow, six-hour schedule activation or historical backfill execution is authorized by PR #105. Build C4 remains the separately authorized production activation/backfill slice.
