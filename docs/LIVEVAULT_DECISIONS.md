# LiveVault Decisions

This continuity file was compacted again on 2026-08-28. Earlier durable decisions and full rationale remain recoverable in Git history. The active contracts below must be preserved by future work.

## Repository, safety and release control

### GitHub main is authoritative

**Decision:** Treat merged `main`, not chat memory or stale local copies, as the source of truth.

**Consequence:** Before changing anything, read `AGENTS.md`, current state/decisions/build-state, relevant current code, recent PRs and current app/service-worker versions.

### Merge and production actions require explicit authorization

**Decision:** Automated QA uses synthetic data and the fake backend. Merge requires the explicit phrase `Merge it`. Production workflows, provider execution, deployments and production-data writes require explicit authorization for that action.

**Consequence:** A branch, version bump, green CI or mergeability never authorizes merge or production execution. Production smoke remains manual-only and read-only.

### Stable identity, user ownership, provider ownership and unknown fields are preserved

**Decision:** Stable IDs, user-owned fields, user-reviewed decisions, provider-owned state and unknown future fields survive enrichment, cleanup and reconciliation.

**Consequence:** Ambiguity fails closed. Provider-neutral provenance stays outside provider-owned containers. Existing JSON writes use latest-state optimistic concurrency and bounded reread/reconciliation.

### Credentials remain least-privilege and separated by role

**Decision:** Browser, automation, data-maintenance and smoke credentials remain separate.

**Consequence:** Ordinary automation cannot gain maintenance privileges or raw private-listening access merely because another workflow or trusted-local process has them.

## Discover v172 visual correction

### Discover geographic filters use the new placement with the old compact control treatment

**Decision:** On Discover > Concerts, the geographic filters remain directly below the Concerts / Venues / Bands selector, but the full-width v171 secondary segmented row is replaced by the compact pre-v171 controls, left-aligned in one row.

**Consequence:** Nearby uses the existing compact location-pin presentation. SE and EU are compact text pills with the same geometry; EU is text-only and must not contain a globe or any other icon. The current BANDMARKR header, Discover header, primary segmented selector, concert cards, colors, typography, spacing, bottom navigation and all unrelated UI remain unchanged.

### Existing geographic-filter ownership remains authoritative

**Decision:** v172 changes presentation only. The hidden original Nearby / SE / EU controls remain the state owners and the visible compact row continues to proxy those controls.

**Consequence:** Existing persistence, mutual exclusion, filtering behavior and ARIA pressed state remain authoritative. The compact row is shown only on Discover > Concerts and remains absent from Venues and Bands.

## Discover v171 corrections

### Compound headers emphasize the destination noun

**Decision:** `MYMUSIC` renders `MY` white + `MUSIC` blue, and `CONCERTALERTS` renders `CONCERT` white + `ALERTS` blue. Existing Discover and Stats compound-header treatments remain unchanged.

**Consequence:** Future header-standardization layers must not restore the earlier blue `MY` or blue `CONCERT` treatment for these two roots.

### Discover may link one unique existing exact-name band that lacks MusicBrainz identity

**Decision:** Discover still resolves followed artists by trusted MusicBrainz MBID first. When Add Band encounters exactly one existing followed band whose normalized name exactly equals the recommendation name and that existing band has no trusted or stored MBID, the user action is allowed to attach the recommendation's MBID to that existing band rather than append a duplicate.

**Consequence:** The existing stable band ID, user-owned fields, nested confirmed/rejected provider state, unknown future fields and unrelated provenance must be preserved wholesale. The new MusicBrainz identity is `manual_confirmed` / user-confirmed and Discover provenance stays provider-neutral. The normal pending artist-enrichment checkpoint is prepared. Multiple exact-name matches, an existing different trusted MBID, or an existing unresolved/stored MBID fail closed and require review rather than guessing.

### Setlist.fm linked copy is conditional on actual trusted MusicBrainz identity

**Decision:** A Band Data screen may say Setlist.fm is linked through the confirmed MusicBrainz MBID only when that specific band actually has a trusted MusicBrainz identity.

**Consequence:** Bands that are still unchecked/unresolved in MusicBrainz show a waiting/not-linked state instead. This is a presentation correction only and does not create or rewrite Setlist.fm provider identity data.

## Discover v170

### Discover replaces the visible Dates identity, not its stable route

**Decision:** The visible bottom-navigation destination formerly labelled Dates is **Discover**, with the existing globe icon, but the stable internal tab remains `concerts`.

**Consequence:** Existing Concerts/Venues navigation and browser history contracts continue to use the established route identifiers. Discover is a presentation/feature layer over that route rather than a migration of stable IDs.

### Discover uses the Stats segmented-control geometry

**Decision:** Discover has exactly three subviews — Concerts, Venues and Bands — using the existing Stats segmented-control classes/dimensions rather than a new bespoke control.

**Consequence:** Concerts remains the default. Concerts and Venues continue to use the existing v166 render/caching path; Bands is the only recommendation surface.

### Recommendation seeds are trusted recent listening identities

**Decision:** Seed artists come from `listening/band-activity.json`, using only the 14-day bucket and only bands with trusted MusicBrainz identity (`auto_confirmed` or `manual_confirmed`). Sort by listen count descending, then recency, and use at most 10 seeds.

**Consequence:** Unreviewed/no-match/error identity cannot seed recommendations. The recommendation system never guesses an MBID from a name.

### ListenBrainz owns recommendation discovery; Spotify is link-only

**Decision:** Similar-artist candidates come from ListenBrainz similar-artists data, with ListenBrainz artist metadata used for display tags/area/begin year. Spotify is not called as a discovery API; the card CTA is `https://open.spotify.com/search/<encoded artist name>`.

**Consequence:** No Spotify identity lookup, token or quota is required for Discover. Provider failure must not erase cached recommendations.

### Recommendation order is append-only and identity is global MBID

**Decision:** Already stored group and candidate order is stable. A candidate MusicBrainz MBID may appear unresolved only once globally. For a new refresh that returns the same candidate for multiple seeds, the strongest similarity relationship wins with deterministic tie-breaking.

**Consequence:** Refreshes append safe new candidates/groups rather than reshuffling existing recommendations. Followed and decided MBIDs are excluded.

### Queue bounds never discard unresolved work to make room

**Decision:** Each group shows at most 10 cards, retains at most 20 unresolved candidates, and the document retains at most 30 active groups.

**Consequence:** Resolving one visible card reveals the next retained card at the bottom. If 30 groups are already active, a new group is not admitted merely by dropping an unresolved group.

### Discover refresh is cache-first and no more frequent than seven days

**Decision:** Persisted recommendations render first. Refresh is considered on startup/resume but no more often than once every seven days after a successful refresh.

**Consequence:** Network/provider failure leaves prior recommendations usable. Automated QA skips automatic provider refresh and blocks all external provider origins.

### Dismiss and Add are durable MBID decisions

**Decision:** Dismiss writes a durable `dismissed` decision. Add Band first ensures the band exists in the latest `bands.json`, then writes a durable `added` decision with the stable band ID.

**Consequence:** Add uses a fresh read plus conditional write/retry, never appends to a stale snapshot, and reuses an already-followed trusted MBID rather than creating a duplicate. After success the card briefly shows `Added ✓`, Dismiss disappears, and then the resolved card is removed so the hidden queue can fill from the bottom.

### Discover provenance is provider-neutral and normal enrichment remains authoritative

**Decision:** A newly created band stores its trusted MusicBrainz identity in the established MusicBrainz container, but Discover-specific provenance is stored separately at the band root. The band receives the existing pending artist-enrichment checkpoint.

**Consequence:** ListenBrainz provenance is not injected into MusicBrainz-owned metadata. Later normal artist enrichment may fill missing safe fields under existing ownership rules without overwriting user-owned or unknown fields.

### Discover state has a dedicated validated browser document

**Decision:** Recommendation state lives in `discoverRecommendations.json`, separate from bands/concerts/listening source history. The Worker limits it to the browser role, caps it at 512 KB, validates the document on read/write, and requires the established conditional-write path.

**Consequence:** The document is bounded to 30 groups, 20 candidates per group and 10,000 decisions, enforces valid MBID identity/global candidate uniqueness, and still permits unknown future fields for forward compatibility. Automation and data-maintenance roles do not gain access merely because the file is JSON.

## Listening and provider ownership carried forward

### Private R2 is the durable listening-history source of truth

**Decision:** Complete sanitized listening history remains private R2 data with IndexedDB as the device working copy; source observations are immutable.

**Consequence:** Derived identity/artwork/recommendation layers stay separate and provider failures never invalidate a listen or change listening statistics.

### Listening identity and artwork remain provider-neutral where possible

**Decision:** Reuse deterministic local/catalogue evidence and provider-neutral identity before new Spotify work. Spotify metadata remains Spotify-owned; provider-neutral evidence is not written into Spotify-owned fields.

**Consequence:** Ambiguous identity stays unresolved/reviewed rather than guessed. Missing artist images and album artwork use exact trusted identity only.

### Provider calls remain bounded

**Decision:** UsageTracker caps/pacing, persisted provider circuits and cross-scheduler leases remain authoritative.

**Consequence:** No provider flow may bypass quota, pacing, lease or circuit protections to make a feature, test or maintenance run succeed.

### Active Releases remain retired

**Decision:** Releases is not an active feed/alert surface; Alerts is concert-only.

**Consequence:** Reintroducing release alerts or scheduled release discovery requires a new explicit build/decision.

## Ticketmaster and concert identity carried forward

### Ticketmaster concert admission requires trusted provider identity

**Decision:** Automatic Ticketmaster concert fetching may only use a trusted Ticketmaster attraction ID for the followed BANDMARKR artist. Keyword/name containment may discover a review candidate but cannot create concert records.

**Consequence:** Collision-prone or incomplete identity fails to review/unresolved rather than admitting namesake events. Existing manual confirmations remain authoritative.

### Ticketmaster offers are not physical-performance identity

**Decision:** A Ticketmaster listing ID identifies a provider offer, not necessarily a unique physical concert. Alternate VIP/package/premium offers consolidate only with direct same-performance evidence to one safe standard listing.

**Consequence:** Transitive/alternate-only chains never authorize collapse. Material timing/location/identity ambiguity fails closed. Alternate provider provenance is monotonic and provider-event matching remains namespace-scoped.

### Provider venue/lifecycle evidence fails closed

**Decision:** Preserve Ticketmaster venue ID, title, source and lifecycle state as provider evidence. Missing embedded venue names may use bounded provider-venue lookup; canceled/postponed/rescheduled candidates are not admitted as ordinary new upcoming concerts.

**Consequence:** Unresolved venue identity is held rather than manufacturing `Unknown venue`, and provider lifecycle changes do not authorize deleting user-owned history.

## Concert/event ownership and statistics carried forward

### `lineupRole` is user-owned

**Decision:** A performance may store only `headliner` or `support`; missing legacy values are interpreted as headliner without a production-wide migration.

**Consequence:** Provider refreshes may not replace a stored role.

### Shared events are conservative and non-destructive

**Decision:** Existing valid `eventGroupId` relationships remain authoritative. Read-time automatic grouping requires exact date, conservative venue match and non-empty matching normalized city; it writes nothing.

**Consequence:** Same date/venue alone, provider similarity, blank city or partial context never establishes event identity.

### Event-level and performance-level statistics remain separate

**Decision:** Concert nights, spend, travel, venue/city visits, event milestones and ticket extremes are event-level. Artist appearances, ratings, setlists, genres and lineup roles are performance-level.

**Consequence:** Future changes must preserve that distinction unless explicitly redesigned.

## Venue identity and metadata carried forward

### Venue facts belong to reusable `venues.json`

**Decision:** Capacity, full address, official HTTPS website, short factual description and internal provenance belong to venue-level records, not copied concert fields.

**Consequence:** Concert attendance, notes, tickets, ratings, roles, stable IDs and unknown fields are never rewritten by venue metadata work. Missing metadata renders nothing rather than a guess.

### Venue identity cleanup fails closed

**Decision:** Safe aliases may canonicalize one physical venue, but different venues never merge merely because they share an address/city/complex. Different-name consolidation requires explicit pair-specific evidence.

**Consequence:** AFAS Dome/Lotto Arena-style same-address venues remain distinct. Known address/country conflicts and conflicting unknown fields block consolidation.

### Venue directory/statistics use canonical physical identity

**Decision:** Venues, Venue Detail, `uniqueVenues` and `topVenues` interpret references through canonical physical venue identity at read time; ordinary concert metadata lookup/event grouping remains scoped separately.

**Consequence:** Alias/locality spelling does not duplicate a physical venue, but ambiguous placeholders and conflicting address evidence fail closed.

### Venue navigation performance is a preserved architecture contract

**Decision:** The ordinary Discover/Concerts list must not construct the complete canonical venue directory. The Venues view indexes/builds it once and reuses the cached group for detail/return navigation.

**Consequence:** Future Discover work must not reintroduce repeated full concert × venue scans or hundreds of repeated row listeners.

## Active UI contracts carried forward

### Next Concert represents the next valid event group

**Decision:** The first upcoming card is the promoted Next Concert presentation; when it belongs to a valid multi-performance event, all cards in that event stay together in stable support-first order. The preserved spacer geometry, 8px intra-event gap, 28px section gap, event-level `X more shows`, countdown and concert-day ticket/directions treatment remain established.

**Consequence:** Unrelated work must not restore a duplicate standalone Next Concert card or split a valid next event across Next/Upcoming.

### Stable navigation IDs remain stable

**Decision:** User-visible labels/icons may evolve without casually migrating internal route/tab IDs.

**Consequence:** Discover keeps the internal `concerts` identifier; other stable navigation IDs follow the same rule unless a dedicated migration is explicitly approved.

## Backlog hygiene

Completed/superseded historical work must not be treated as current debt. PR #134 remains intentionally open as production-inert NB2 tooling. Cloudflare Worker CORS-origin hardening and versioned CSS/JS patch-layer consolidation remain deferred maintenance. Focused Ticketmaster legacy offer-label hardening remains separate from v172.
