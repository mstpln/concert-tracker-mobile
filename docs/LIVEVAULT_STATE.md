# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The merged baseline is v136 at merge commit `bd4e40ee57a5b9e381eefad30f4d116ccea1870a`. PR #142 is merged. The active correction/finalization build is v137 on `fix/provider-release-scope-finalization-v137`; it is not merged or deployed.

## Provider and release cleanup finalization

v135/v136 retired the active Releases product path while preserving stored historical/provider state. Alerts is concert-only, Band Detail has no Releases tab, scheduled structured release catalogue polling is disabled, and lifecycle release-alert planning is inert.

v137 completes the remaining reviewed cleanup requirements. Scheduled non-playlist track-link work now seeds one fail-closed provider-neutral resolver from the ordinary `bands.json`/`concerts.json` state already available to automation, allowing exact existing setlist and predicted-setlist Spotify links to satisfy later historical display-link work before another Spotify search. Private listening evidence remains usable only by callers that already possess it; ordinary automation still cannot read raw private listening archives.

When reusable local evidence is absent, the historical non-playlist lane now attempts a conservative MusicBrainz catalogue path before Spotify: one uniquely trusted band MBID constrains an exact-title recording search, then one unique recording may expose an exact Spotify track URL relation. Ambiguous/no-match evidence falls through; transient MusicBrainz errors stop that item safely rather than being converted into a Spotify guess. MusicBrainz calls remain behind UsageTracker courtesy caps/pacing.

Listening artwork no longer treats a bare MusicBrainz release MBID as proof that Cover Art Archive has a front image. CAA presentation artwork suppresses Spotify fallback only when the ListenBrainz observation contains both an exact CAA release MBID and explicit CAA ID evidence. Bare or conflicting release identity remains eligible for the established Spotify album-artwork fallback. CAA fields remain provider-neutral/local and never enter Spotify-owned metadata.

Spotify diagnostics now include an explicit aggregate `attempted` outcome counter in addition to lane, endpoint, successful/no-match/skipped/provider-error and circuit information. No IDs, queries, URLs, tokens or payloads are recorded.

`APP_VERSION`, `CACHE_NAME_LITERAL`, and deterministic build state are synchronized at v137.

## Safety and release boundary

Existing UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation, immutable listening source observations and credential boundaries remain authoritative. Automated browser QA uses only synthetic fixtures and the QA fake backend.

No production provider call, production workflow, production R2 read/write, deployment, merge or auto-merge is authorized by this build. After merge, the PDF's production observation step remains a separate explicit production action: observe the first authorized structured run and confirm zero release polling plus expected provider diagnostics/opportunity.
