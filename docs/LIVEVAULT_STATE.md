# LiveVault Current State

This continuity file was compacted again on 2026-08-28. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged application baseline is **v171** at `4a1b923ea1c1eb1b1a08e3ea0ad681934a5da628`, which merged PR #187. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v171` on `main`.

The active unmerged application build is **v172** on branch `fix/discover-filter-pills-v172`. It is a focused visual correction to the merged v171 Discover filter placement. The branch keeps `APP_VERSION` and `CACHE_NAME_LITERAL` synchronized at `v172`.

No production provider call, production research workflow, production smoke or production-data mutation has been performed for v172.

## v172 Discover compact-filter correction

The current Discover visual baseline remains exactly the merged v171 app: BANDMARKR blue brand bar, Discover header, Concerts / Venues / Bands segmented selector, concert cards, typography, colors, icons, spacing and bottom navigation are unchanged.

Only the geographic filter presentation changes. The v171 placement is retained directly below Concerts / Venues / Bands and remains limited to Discover > Concerts, but the full-width secondary segmented row is replaced with the compact pre-v171 control treatment, left-aligned in one row. Nearby is the existing compact location-pin control; SE and EU are compact text pills with identical geometry. EU is text-only and must not contain a globe or other icon. Active/inactive state continues to mirror the existing hidden header-owned controls, so persistence, mutual exclusion and filtering behavior remain unchanged.

v172 is presentation-only for the geographic filters. It does not alter Discover recommendation identity behavior, concert filtering rules, provider ownership, stored data, navigation IDs or venue-render performance.

## v171 Discover/header correction build

v171 merged in PR #187. Compound header emphasis is corrected so **MYMUSIC** renders `MY` white + `MUSIC` blue and **CONCERTALERTS** renders `CONCERT` white + `ALERTS` blue. Discover keeps its existing globe/header identity and Settings action.

On Discover > Concerts, the Nearby / SE / EU geographic controls were moved out of the crowded app header and rendered immediately below the existing Concerts / Venues / Bands segmented selector. The controls reuse the existing geographic-filter owners and persisted state rather than introducing a second filter model. The secondary geographic row is only shown for Discover > Concerts; Venues and Bands keep it hidden.

v171 also closes a Discover duplicate-risk exposed by an existing followed artist such as Klaxons that has a confirmed Ticketmaster identity but no trusted MusicBrainz identity. Discover still prefers trusted MBID matching first. If Add Band finds exactly one existing followed band with the same exact normalized name and that band has no trusted or stored MBID, the recommendation is linked into that existing record instead of appending a duplicate. The stable band ID, user-owned fields, nested Ticketmaster/provider decisions, unknown future fields and existing provenance are preserved. The Discover MBID becomes a user-confirmed MusicBrainz identity, Discover provenance is added provider-neutrally, and normal pending artist-enrichment state is prepared. Multiple same-name records, a different trusted MBID, or any existing nonblank stored MBID fail closed rather than guessing.

The Band Data Setlist.fm presentation is also corrected for the per-band case: when a band lacks a trusted MusicBrainz MBID, the UI no longer claims `Linked through the confirmed MusicBrainz MBID`; it instead reports that Setlist.fm is waiting for MusicBrainz identity. No stored provider state is rewritten by this presentation correction.

## v170 Discover artist recommendations

The visible Dates destination is **Discover** while retaining the stable internal `concerts` tab identifier. Its bottom-navigation icon and header icon use the existing globe glyph. Discover uses the existing Stats segmented-control classes and dimensions for three views: **Concerts / Venues / Bands**. Concerts and Venues continue to delegate to the established v166 venue-navigation/render path; the feature must not reintroduce full-dataset venue scans on the ordinary Concerts view.

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
- v170: Discover replaces the visible Dates identity while retaining the internal `concerts` route and adds bounded cache-first ListenBrainz/MusicBrainz recommendations with durable Add/Dismiss decisions.
- v171: Discover filters move below the primary Discover selector; header emphasis, safe exact-name recommendation linking and per-band Setlist.fm identity copy are corrected.

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

Completed/superseded historical work must not be treated as current debt. PR #134 remains intentionally open as production-inert NB2 tooling. Cloudflare Worker CORS-origin hardening and versioned CSS/JS patch-layer consolidation remain deferred maintenance work and should stay isolated from feature builds. The focused Ticketmaster offer-label hardening (`Premium Experience`, `Logen Seat`, plain `Box Seat`) remains separate from v172.

## Next operational steps

Validate v172 on the exact branch head with unit/safety, version/cache sync, deterministic build-state, desktop Chromium and mobile Chromium QA. Keep the change isolated to the compact geographic filter presentation and required build/continuity files. Do not merge without the user's explicit `Merge it` authorization, and do not run production providers, production research workflows, production smoke, deployments or production-data mutations without separate explicit authorization.
