# LiveVault Current State

This continuity file was compacted again on 2026-08-28. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged application baseline is **v169** at `90b98ce33389a3b6143bb76950f58022d553fff0`, which includes PR #185. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v169` on `main`.

The active unmerged application build is **v170** in draft PR #186, `Add Discover artist recommendations (v170)`, on branch `feature/discover-bands-v170`. The branch keeps `APP_VERSION` and `CACHE_NAME_LITERAL` synchronized at `v170`.

No merge, deployment, production provider call, production research workflow, production smoke or production-data mutation has been performed for v170.

## v170 Discover artist recommendations

The visible Dates destination becomes **Discover** while retaining the stable internal `concerts` tab identifier. Its bottom-navigation icon and header icon use the existing globe glyph. Discover uses the existing Stats segmented-control classes and dimensions for three views: **Concerts / Venues / Bands**. Concerts and Venues continue to delegate to the established v166 venue-navigation/render path; the feature must not reintroduce full-dataset venue scans on the ordinary Concerts view.

Discover/Bands is a cache-first recommendation stack grouped as `Similar to <Seed Artist>`. Seeds come only from trusted MusicBrainz identities in `listening/band-activity.json`, using the 14-day bucket, sorted by listen count then recency, capped at 10. The recommendation provider is ListenBrainz similar-artists plus ListenBrainz artist metadata. Spotify is not queried as an API for discovery; the visible Spotify action is a local name-search URL under `https://open.spotify.com/search/`.

Recommendation state is stored separately in `discoverRecommendations.json`. The Worker permits that document only to the browser role, caps it at 512 KB, validates kind/schema/MBIDs/group and queue bounds/decisions on write and on read, and retains the existing conditional-write semantics. Unknown future fields are allowed rather than exact-key rejected.

The queue contract is append-only for already stored group/candidate order. Candidate identity is the MusicBrainz MBID. A candidate may exist globally only once; when a new refresh returns the same candidate for multiple seeds, the strongest similarity relationship wins with deterministic tie-breaking. Followed and already-decided MBIDs are excluded. At most 10 candidates are visible per group, at most 20 unresolved candidates are retained per group, and at most 30 active groups are retained. A full 30-group queue does not discard unresolved groups to admit a new one.

Refresh is no more frequent than once every seven days and also checks when the app becomes visible again. Provider failure leaves the prior cached recommendations intact. Automated QA sets the synthetic/fake-backend flags, blocks external origins, and therefore never calls live ListenBrainz/MusicBrainz/Spotify providers.

Dismiss writes a durable `dismissed` decision. Add Band first persists the band using a fresh `bands.json` read plus conditional write/retry, reuses an existing trusted MBID rather than creating a duplicate, preserves the latest remote records/unknown fields, then writes the durable `added` Discover decision. Discover provenance is provider-neutral at the band root and is not stored inside MusicBrainz-owned metadata. Newly created bands receive the existing pending artist-enrichment checkpoint so the normal later enrichment flow can fill missing safe fields. On success the card briefly shows `Added ✓`, removes Dismiss, then disappears and the hidden queue fills from the bottom.

Synthetic browser coverage includes grouped cards, Spotify local-search URLs, Add/Dismiss durability, queue refill and responsive widths from 320 through 480 px. Existing desktop/mobile PR QA remains the required merge-readiness gate.

## Production data baseline carried forward

The validated production `concerts.json` cleanup completed on 2026-08-24 with **3,262** concert records after removal of 334 unsafe legacy Ticketmaster records. All 76 attended concert IDs were preserved and the ticket-cost total remained **31,337**. The verified replacement SHA-256 was `d30c413cfe84a002e2e93361d94eb05854c529588dc20f7ba0b9fabefa8b3bab`.

Production `bands.json` Ticketmaster identity review completed with **370** bands, **334** trusted unique Ticketmaster attraction IDs and **36** unresolved bands. The verified reviewed replacement SHA-256 was `9744a107b22586d3446a1560514378511b262a3ea12c740224a1edab536e0774`.

Production venue cleanup completed with **530** reviewed `venues.json` records after conservative consolidation/removal of placeholders. The user confirmed that file was uploaded to the top level of production R2. No provider run or deployment was used for the cleanup.

## Merged architecture and UI contracts carried forward

- v163: Ticketmaster ingestion is identity-first; loose name matching is review-only, alternate offers require direct same-performance proof, and provider IDs remain namespace-scoped.
- v164: the venue directory uses canonical physical-venue identity without changing event grouping or non-venue statistics; ambiguous placeholders fail closed and distinct same-address venues remain distinct.
- v165: manual provider decisions are preserved across root MusicBrainz review actions, including unknown future nested-provider fields.
- v166: venue navigation uses indexed/cached canonical grouping; ordinary concert dates do not build the canonical venue directory.
- v167-v169: Start uses the existing upcoming card as Next Concert and keeps the complete next valid event group together; countdown/concert-day/ticket/directions behavior and event-level Upcoming count remain established.

Concert performance records remain independent. `lineupRole` is user-owned. Existing explicit `eventGroupId` relationships remain authoritative; conservative automatic grouping is read-time only. Concert nights/spend/travel/venue/city/event milestones are event-level, while artist appearances/ratings/setlists/genres/lineup roles are performance-level.

## Active safety and ownership boundaries

- Stable IDs, user-owned fields, reviewed decisions, provider ownership and unknown future fields must be preserved.
- Attendance, notes, ratings, ticket price/quantity/free state, playlist/photo links, manually added concerts, favorites, muted state, lineup role and event relationships remain user-owned under their established rules.
- Automated browser QA uses only synthetic fixtures and the QA fake backend.
- Production provider calls, production workflows, deployments and production data changes require explicit authorization.
- Production smoke is manual-only and read-only.
- Provider calls remain under UsageTracker caps/pacing and existing circuit/lease rules.
- Raw private listening history remains outside ordinary GitHub Actions/automation inputs.
- Existing JSON writes use optimistic concurrency and bounded reread/reconciliation.

## Backlog hygiene

Completed/superseded historical work must not be treated as current debt. PR #134 remains intentionally open as production-inert NB2 tooling. Cloudflare Worker CORS-origin hardening and versioned CSS/JS patch-layer consolidation remain deferred maintenance work and should stay isolated from feature builds. The focused Ticketmaster offer-label hardening (`Premium Experience`, `Logen Seat`, plain `Box Seat`) remains separate from v170.

## Next operational steps

Continue PR #186 on the exact-head fix -> validate -> review cycle until unit/safety, desktop Chromium and mobile Chromium are green and the final head is merge-ready. Keep PR #186 draft during correction work. Do not merge without the user's explicit `Merge it` authorization, and do not run production providers, production research workflows, production smoke, deployments or production-data mutations without separate explicit authorization.
