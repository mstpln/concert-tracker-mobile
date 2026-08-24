# LiveVault Current State

This continuity file was compacted on 2026-08-24. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged application baseline is **v163** at merge commit `a79a114c0e7927349c542197b2dcb2d9396987d6`. The active unmerged venue-directory correction is **v164** on `fix/venue-directory-canonical-grouping-v164`; `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v164` on that branch. PR #179 is the active review surface.

PR #174 fixed the Next Concert capacity layout. PR #175 hardened the offline venue-cleanup tool and merged to `main` at `c9af931190599828e66c27b583f87932c5f23b9e`. PR #176 compacted continuity to the v162 merged baseline. PR #177 merged the v163 Ticketmaster data-integrity remediation, and PR #178 recorded the completed production cleanup.

No deployment, production provider call, production research workflow or production smoke is authorized by the v164 implementation branch.

## v163 Ticketmaster concert data integrity

The Ticketmaster ingestion path is identity-first. Automatic Ticketmaster event lookup requires a `confirmed` or `manual_confirmed` Ticketmaster attraction ID. Loose keyword/name containment remains only a discovery/review helper and cannot directly create concert records. Bands without a trusted attraction identity skip automatic Ticketmaster event fetching until identity resolution is reviewed.

Attraction resolution requests a broad Music candidate set and fails to `needs_review` when similarly named Music attractions exist or the provider result set cannot be shown complete. Trusted event candidates preserve Ticketmaster event, attraction and venue IDs plus provider event title, lifecycle status, source and offer type. Canceled/postponed/rescheduled candidates are not admitted as ordinary upcoming concerts. Missing embedded venue names use a bounded provider-venue lookup when a venue ID exists; unresolved venue identity is held rather than creating another `Unknown venue` concert.

Ticketmaster standard and alternate-offer listings are classified separately from the physical performance. Consolidation requires matching trusted attraction, date, physical venue identity or complete matching address, and compatible start time. Each alternate must directly match exactly one standard listing; alternate-only chains and transitive bridges never collapse. Re-observed alternate offers merge monotonically and the standard listing remains preferred primary provider evidence when safely known.

`scripts/ticketmasterConcertAuditV163.js` remains the local read-only audit path. Automatic cleanup requires trusted identity, one deterministic canonical, direct same-performance proof for every proposed removal, complete alternate provenance, valid stable IDs/roles, safe lifecycle state and no protected/unknown data loss. Ambiguity remains review-only.

The broader `lineupRole`/event-grouping/statistics model was not redesigned by v163.

## Production Ticketmaster cleanup completed

On 2026-08-24 the user supplied current production `concerts.json` and `bands.json` snapshots for offline review, explicitly authorized the exact production replacement, uploaded the validated cleaned `concerts.json`, then downloaded that production object again for verification.

The source snapshot contained **3,596 concert records**. The validated production replacement contains **3,262 records**, removing **334** legacy Ticketmaster records: **243** clearly wrong-artist legacy matches and **91** redundant VIP/package/premium offer records. All **76** `attending: true` IDs are identical before/after; no meaningful user-owned or unknown future state was lost; no new stable concert IDs were introduced; removed package IDs/URLs are retained as alternate-provider provenance; ticket-cost total remains **31,337**.

The downloaded post-upload production object was byte-for-byte identical to the authorized cleanup candidate: **3,262 records**, size **2,711,433 bytes**, SHA-256 `d30c413cfe84a002e2e93361d94eb05854c529588dc20f7ba0b9fabefa8b3bab`.

Three legacy offer labels remain a focused future Ticketmaster hardening candidate: `Premium Experience`, `Logen Seat`, and plain `Box Seat`.

## Venue metadata implementation

### v158 reusable venue metadata

Venue facts live in separate durable `venues.json` records rather than being copied onto concert records. Venue records use stable `venueId` identity and may contain canonical name/city/country context, address, positive-integer `maxCapacity`, official HTTPS URL, short factual description, research state/timestamp, sources, aliases, legacy IDs and unknown future fields.

The UI reuses venue metadata on attended cards, the Next Concert ticket, Dates > Venues and Venue Detail. Missing capacity is hidden rather than replaced by a placeholder. Research sources and timestamps are internal and are not rendered in the normal UI. `worker.js` owns `venues.json` through the explicit allowlist and protected JSON write path.

### v159-v160 scheduled venue research

The scheduled venue lane reuses the twice-monthly focused Tavily/Groq workflow and is enabled only when `VENUE_METADATA_RESEARCH_ENABLED` is exactly `true`. Its Europe scope is the EU27 plus Norway, Iceland, United Kingdom, Switzerland, Turkey and Serbia. Unknown/out-of-scope country values fail closed. Targets are derived only from `attending: true` concerts, incomplete venues are prioritized, and each run is capped at 10 unique venues. `concerts.json` is read-only for this lane and venue writes use the least-privilege data-maintenance credential.

The production repository variable `VENUE_METADATA_RESEARCH_ENABLED=true` and required `DATA_MAINTENANCE_TOKEN` secret were previously confirmed configured. That configuration is not authorization to manually dispatch production research.

### v161 venue data-quality hardening

v161 tightened venue identity and evidence quality. Safe country/city aliases canonicalize matching while stored aliases/legacy IDs can be retained. Placeholder venue names such as Unknown/TBA/TBD do not become research targets. Known-country/address conflicts fail closed. Unknown future fields are preserved, and conflicting shared unknown fields block automatic consolidation.

`maxCapacity` means the highest reliably documented maximum across normal concert/event configurations. Obvious ticket sellers, social profiles, tourism pages, directories, aggregators and event listings are rejected as official venue websites. Failed/evidence-less research does not create a successful `researchedAt` timestamp.

The local `scripts/venueMetadataDedupeV161.js` tool has no provider/R2 path. Different-name venues may consolidate only when pair-specific review evidence explicitly identifies the counterpart. Generic same-address evidence is insufficient; this protects distinct venues such as AFAS Dome and Lotto Arena Antwerpen.

## Production venue cleanup completed

On 2026-08-24 the production venue snapshot was reviewed offline and the user explicitly authorized the eventual replacement. The source contained **1,208 records** and the audited cleanup candidate contained **530 records**: 651 conservative duplicate records consolidated and 27 Unknown/TBA-style placeholder records removed. The candidate had zero duplicate `venueId` values, placeholder venue records, blocked/non-official display URLs, misleading unresolved `researchedAt` timestamps or structural validation failures.

The user confirmed that cleaned file was uploaded as top-level production `venues.json`. No broad production research workflow, provider run, Worker deployment or production smoke was triggered as part of that cleanup.

## v162 Next Concert capacity layout

v162 preserves the venue metadata content contract but corrects its Next Concert presentation. Capacity uses the muted address-sized treatment and no longer collides with the ticket-quantity CTA at supported mobile/desktop widths.

## v164 canonical venue directory identity

v164 corrects the Venues directory so cards represent canonical physical venue identity instead of raw `concert.venue + concert.city` strings. Known `venues.json` aliases, canonical city/country spelling and stable `venueId` identity collapse all matching concert rows into one venue card and one Venue Detail history. This applies across the entire collection rather than to a fixed list of venue names.

Placeholder names such as `Unknown venue`, Unknown, TBA and TBD never render as standalone venue cards. A placeholder concert may join an established venue only when its stored address/location evidence selects one unique canonical venue record. Exact or strong stored address evidence is used conservatively; ties remain unresolved and are omitted rather than guessed. This specifically preserves distinct same-complex venues such as AFAS Dome and Lotto Arena Antwerpen even when they share an address.

Venue-related statistics use the same read-time canonical venue identity so spelling/city aliases do not inflate unique venue counts or split top-venue visit counts. Canonicalization operates on copies used for grouping/statistics only: it does not rewrite `concerts.json`, stable IDs, `eventGroupId`, attendance, ticket data, notes, ratings or any other user-owned/unknown fields.

The production post-v163 concert snapshot audit found 1,364 raw venue/city card combinations, including 25 placeholder cards covering 64 concert records and 15 definite non-placeholder same-venue/canonical-city duplicate groups. v164 is designed to resolve these generically through the canonical metadata model rather than hard-coded Royal Arena/Pumpehuset exceptions. Synthetic regression coverage includes Royal Arena, Pumpehuset, Nordichallen placeholder recovery, Filmstudion, Roxy, unresolved placeholders and the AFAS Dome/Lotto Arena same-address safety case.

## Event/performance statistics contract

Concert performance records remain independent. `lineupRole` is a user-owned `headliner`/`support` field. Existing explicit `eventGroupId` relationships remain authoritative, while read-time effective shared events require conservative same-date/venue/city context. Automatic grouping writes no relationship field.

Concert nights, spend, travel, venue/city visits, event milestones and ticket extremes are event-level. Artist appearances, ratings, setlists, genres and lineup roles are performance-level. v160 sums user-entered `ticketPrice` contributions across valid event members; ticket-quantity and travel conflict handling remain conservative. v164 changes only the venue identity interpretation used for venue grouping/statistics and leaves stored event relationships untouched.

## Active safety and ownership boundaries

- Stable IDs, user-owned fields, reviewed decisions and unknown future fields must be preserved.
- Attendance, notes, ratings, ticket price/quantity/free state, playlist/photo links, manually added concerts, favorites, muted state, lineup role and event relationships remain user-owned.
- Automated browser QA uses only synthetic fixtures and the QA fake backend.
- Production provider calls, workflows, deployments and production data changes require explicit authorization.
- Production smoke is manual-only and read-only.
- Provider calls remain under UsageTracker caps/pacing and existing circuit/lease rules.
- Existing JSON writes use optimistic concurrency and bounded reread/reconciliation.

## Active UI contracts to preserve

The Start root remains `MYMUSIC`; Music keeps the approved five-bar equalizer and Stats the approved angular rising-line glyph. The Next Concert normal-day ticket keeps the v147/v148 geometry/chrome with the v162 capacity correction; concert-day Maps/OwnedTickets behavior remains unchanged.

ConcertDates/Band Detail geographic filters retain Nearby -> SE -> EU semantics, with SE meaning exact canonical Sweden. My Bands search remains transient. Listening yearly Overview mode changes density only and keeps all underlying yearly data.

## Backlog hygiene

Completed/superseded historical work must not be treated as current debt. PR #134 remains intentionally open as production-inert NB2 tooling. Cloudflare Worker CORS-origin hardening and versioned CSS/JS patch-layer consolidation remain deferred maintenance work. The focused Ticketmaster offer-label hardening remains separate from v164.

## Next operational steps

Finish exact-head review and CI for PR #179. Do not merge without explicit `Merge it`, and do not deploy, mutate production data, manually run venue research or run production smoke as part of v164 validation.
