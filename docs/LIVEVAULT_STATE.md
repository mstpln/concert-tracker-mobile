# LiveVault Current State

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Production is a GitHub Pages static PWA backed by the authenticated Cloudflare Worker and private R2 storage.

The merged baseline is v138 at merge commit `21ded491848d15e46a64255334aee39ddbdb7a80`. PR #146 is merged and contains the first Next Concert ticket presentation.

An unreleased v139 correction build is active on `fix/next-concert-ticket-v139`. It rebuilds only the Start-screen Next Concert presentation from the approved 820x386 ticket geometry: the outer graphite contour and dashed tear line share the same graphite, the tear is fixed at x=468, and the two inset frames are 358x286 and 238x286. The normal state uses a silver/graphite countdown in the right stub. On concert day the countdown is replaced by the approved yellow circular `Open tickets` control while `Get directions` remains on the left. Existing Maps URL construction and OwnedTickets PDF opening remain authoritative behavior paths.

## Provider and release cleanup finalization

v135-v137 retired the active Releases product path while preserving stored historical/provider state. Alerts is concert-only, Band Detail has no Releases tab, scheduled structured release catalogue polling is disabled, and lifecycle release-alert planning is inert.

v137 uses one fail-closed provider-neutral resolver for non-playlist track links. Scheduled research seeds it only from ordinary `bands.json`/`concerts.json` state already authorized for automation. Private listening evidence remains usable only by callers that already possess it. Ordinary scheduled automation still cannot read raw private listening archives.

Listening artwork does not treat a bare MusicBrainz release MBID as proof that Cover Art Archive has a front image. CAA presentation artwork suppresses Spotify fallback only when explicit trusted CAA evidence exists. CAA fields remain provider-neutral/local and never enter Spotify-owned metadata.

Spotify diagnostics retain aggregate outcome/circuit information only; no IDs, queries, URLs, tokens or payloads are recorded.

For the active v139 branch, `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at v139. The service-worker shell includes the v139 ticket stylesheet in addition to the existing v138 compatibility assets.

## Safety and release boundary

Existing UsageTracker caps/pacing, Spotify circuit, cross-scheduler lease, optimistic concurrency, reviewed provider-decision preservation, immutable listening source observations and credential boundaries remain authoritative. Automated browser QA uses only synthetic fixtures and the QA fake backend.

No production provider call, production workflow, production R2 read/write or deployment has been performed for v139. Merge still requires explicit user authorization after the exact PR head is green for unit/safety plus desktop/mobile synthetic browser QA.
