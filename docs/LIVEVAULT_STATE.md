# LiveVault Current State

This continuity file was compacted on 2026-08-24. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged application baseline is **v165** at `56a377542bb21faf98d54fd5676752ef3b4d134a`, which merged PR #180. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v165` on `main`.

The active unmerged application build is **v166** in PR #182, `Restore instant Dates and venue navigation (v166)`, on branch `fix/venue-navigation-performance-v166`. The branch keeps `APP_VERSION` and `CACHE_NAME_LITERAL` synchronized at `v166`. v166 is a focused performance correction for the v164 canonical venue-directory path; it does not authorize merge, deployment, production provider execution, production workflows, production smoke or production-data changes.

PR #174 fixed the Next Concert capacity layout. PR #175 hardened the offline venue-cleanup tool. PR #176 compacted continuity to the v162 merged baseline. PR #177 merged the v163 Ticketmaster data-integrity remediation. PR #178 recorded the completed v163 production cleanup state. PR #179 merged the v164 canonical venue-directory correction. PR #180 merged the v165 reviewed provider-decision safety correction. PR #182 is the active v166 venue-navigation performance correction.

No deployment, production provider call, production research workflow or production smoke was performed as part of the v165 merge or the v166 build work to date.

## v163 Ticketmaster concert data integrity

The Ticketmaster ingestion path is now identity-first. Automatic Ticketmaster event lookup requires a `confirmed` or `manual_confirmed` Ticketmaster attraction ID. Loose keyword/name containment remains only a discovery/review helper and cannot directly create concert records. Bands without a trusted attraction identity skip automatic Ticketmaster event fetching until identity resolution is reviewed.

Attraction resolution requests a broad Music candidate set and fails to `needs_review` when similarly named Music attractions exist or the provider result set cannot be shown complete, including for longer exact names. Existing confirmed/manual-confirmed decisions remain authoritative and are reused.

Trusted event candidates preserve Ticketmaster event, attraction and venue IDs plus provider event title, lifecycle status, source and offer type. Canceled/postponed/rescheduled candidates are not admitted as ordinary upcoming concerts. Missing embedded venue names use a bounded provider-venue lookup when a venue ID exists; unresolved venue identity is held rather than creating another `Unknown venue` concert.

Ticketmaster standard and alternate-offer listings are classified separately from the physical performance. Strong package vocabulary is recognized directly; generic premium/lounge/experience/suite terms require offer context, and legacy URL evidence inspects only the decoded path rather than host/query/fragment text. Within Ticketmaster data, consolidation requires band/date, matching trusted attraction, exact provider venue identity or matching complete address, and compatible start time. Each alternate must directly match exactly one standard listing; alternate-only chains and transitive bridges never collapse. Re-observed alternate offers merge monotonically so null, empty or partial provider evidence cannot degrade richer stored IDs, URLs, titles, status, source or classification. The standard listing is preferred as primary provider evidence when safely known. Reconciliation keeps materially different same-day performance times separate, allows compatible known times plus strong location evidence to enrich an existing stable record, and holds missing timing/location evidence, multiple possible matches and distinct standard listings rather than falling through to salted IDs. Exact provider-event identity is scoped to Ticketmaster records and cannot collide with Tavily/Groq provider-ID namespaces.

v163 introduces no provider or quota bypass and does not change configured limits, caps, pacing or schedules. Ticketmaster event pagination can make additional bounded requests for artists whose results span multiple pages; every attempted page and bounded venue lookup still passes through `UsageTracker` and remains subject to its existing caps and pacing.

`scripts/ticketmasterConcertAuditV163.js` is a local read-only cleanup audit path. It reads supplied local `concerts.json` and optional `bands.json`, never R2 or provider APIs, and classifies package duplicates/uncertainties, identity conflicts or incomplete identity, recoverable/unknown venues, unsafe lifecycle states and lineup-role review cases. Automatic package plans require current trusted band metadata, one deterministic standard/legacy-standard canonical, direct same-performance proof from every proposed removal to that canonical, complete alternate provenance, valid stable IDs/roles, safe lifecycle state, and lossless ownership checks. Direct proof uses matching attraction, compatible time, and exact provider venue ID or complete matching legacy address; transitive connectivity and venue-name similarity cannot authorize deletion. Positive package evidence with missing/conflicting performance facts is always emitted as `manual_review_required`, including missing time/attraction/location, unknown or incompatible venue evidence, and scoped `alternateProviderOffers` linkage. Linkage is keyed by band/date/event ID and never bypasses physical proof.

For pre-v163 records without event-title/offer-type metadata, alternate classification requires positive stored event-name, URL-path or scoped linkage evidence; absent evidence stays unknown. Conflicting explicit offer metadata, multiple possible canonicals and standard-vs-standard same-show evidence remain manual. Reports name stable IDs, direct relationship reasons, primary/alternate provider evidence and classification reasons, protected fields, unknown fields and proposed actions. Equal meaningful user state may be considered preserved only when the canonical already has the exact value; conflicts, missing/invalid roles, manually added state and unknown future fields remain manual. Wrong-artist removal is automatic only for a clear trusted-attraction conflict with a valid stable ID/role and no protected or unknown state. Supplying no current band metadata makes identity-dependent cleanup review-only.

The broader `lineupRole`/event-grouping/statistics model is not redesigned by v163.

## Production Ticketmaster cleanup completed

On 2026-08-24 the user supplied current production `concerts.json` and `bands.json` snapshots for offline review, explicitly authorized the exact production replacement, uploaded the validated cleaned `concerts.json` to the top level of the production R2 bucket, then downloaded that production object again for verification.

The source snapshot contained **3,596 concert records**. The validated production replacement contains **3,262 records**, removing **334** legacy Ticketmaster records:

- **243** clearly wrong-artist legacy Ticketmaster matches;
- **91** redundant VIP/package/premium ticket-offer records;
- **0** attending concert IDs removed or changed; all **76** `attending: true` IDs are identical before/after;
- **0** meaningful user-owned fields changed on retained records;
- **0** removed records carried meaningful user-owned state or unknown future fields;
- **0** new stable concert IDs were introduced;
- **73** retained records changed only by adding/updating `alternateProviderOffers` provenance;
- removed package Ticketmaster event IDs/URLs are retained as alternate provider provenance on their canonical concert;
- ticket-cost total remains **31,337** before and after cleanup.

The downloaded post-upload production object is byte-for-byte identical to the authorized cleanup candidate: **3,262 records**, size **2,711,433 bytes**, SHA-256 `d30c413cfe84a002e2e93361d94eb05854c529588dc20f7ba0b9fabefa8b3bab`.

Known Queen/Beatles/Johnny Cash legacy pollution patterns targeted by the remediation are absent from the verified production replacement. No live Ticketmaster/Tavily/Groq call, production research workflow, deployment or production smoke was used for this cleanup.

Three legacy offer labels observed during the cleanup are not explicit v163 vocabulary cases and remain a focused future-ingestion hardening candidate: `Premium Experience`, `Logen Seat`, and plain `Box Seat`. The cleanup handled the reviewed existing records conservatively; any code change for these labels should remain a separate focused correction.

## Production Ticketmaster identity enrichment completed

On 2026-08-24 the remaining Ticketmaster attraction identities in production `bands.json` were reviewed offline. The source snapshot contained **370 bands**, with **258** already carrying trusted Ticketmaster attraction IDs and **112** without a trusted Ticketmaster ID.

Of those 112 unresolved bands, **76** were manually confirmed with exact Ticketmaster attraction IDs and **36** remained unresolved. The resulting production baseline therefore contains **334 / 370 bands (90.3%)** with trusted Ticketmaster IDs. All **334** trusted Ticketmaster IDs are unique.

The enrichment preserved every stable BANDMARKR band ID and all non-target band records. Only the nested `musicbrainz` container changed on the 76 reviewed targets. Existing provider-owned fields and unknown future fields were preserved; a missing `musicbrainz` container was created only where required. Manual Ticketmaster decisions use `status: "manual_confirmed"`, `matchMethod: "user_approved_exact_id"`, `confidence: "user_confirmed"`, `reviewedBy: "user"`, and the exact reviewed attraction ID. Provider artist name/URL were reused only when the source record already contained exact matching provider evidence; otherwise those fields remained null rather than being synthesized.

Four identities were deliberately left unresolved despite relevant provider evidence because the match was not sufficiently deterministic: Phoenix, The Animals, Dollface and Thåström. The remaining 32 unresolved bands had no reliable original-artist Ticketmaster Discovery K8 attraction ID in the reviewed evidence.

The user uploaded the reviewed candidate as the production top-level `bands.json`, then downloaded the production object again for verification. The downloaded production object is byte-for-byte identical to the authorized reviewed candidate, with SHA-256 `9744a107b22586d3446a1560514378511b262a3ea12c740224a1edab536e0774`. Verification confirmed **370 records**, **370 unique stable band IDs**, **334 trusted Ticketmaster IDs**, **334 unique trusted IDs**, **76 manual-confirmed Ticketmaster records**, **36 unresolved bands**, and no unexpected changed band IDs.

This production identity enrichment was a reviewed data-maintenance action only. No live Ticketmaster/Tavily/Groq provider call, automated production workflow, deployment or production smoke was used to perform or verify it.

## Venue metadata implementation

### v158 reusable venue metadata

Venue facts live in a separate durable `venues.json` document rather than being copied onto concert records. Venue records use stable `venueId` identity and may contain canonical name/city/country context, address, positive-integer `maxCapacity`, official HTTPS URL, short factual description, research state/timestamp, sources, aliases, legacy IDs and unknown future fields.

The UI reuses venue metadata on attended cards, the Next Concert ticket, Dates > Venues and Venue Detail. Missing capacity is hidden rather than replaced by a placeholder. Research sources and timestamps are internal and are not rendered in the normal UI.

`worker.js` owns `venues.json` through the explicit allowlist and protected JSON write path. Venue writes remain data-maintenance-only and preserve the established conditional ETag semantics.

### v159-v160 scheduled venue research

The scheduled venue lane reuses the twice-monthly focused Tavily/Groq workflow and is enabled only when `VENUE_METADATA_RESEARCH_ENABLED` is exactly `true`. Its Europe scope is the EU27 plus Norway, Iceland, United Kingdom, Switzerland, Turkey and Serbia, including maintained aliases. Missing/unknown and out-of-scope country values fail closed.

Targets are derived only from `attending: true` concerts, incomplete venues are prioritized, and each run is capped at 10 unique venues. Provider calls remain behind UsageTracker limits/pacing. Automation is fill-only for established venue facts; conflicts preserve stored display facts and move/keep records at `review_needed`. `concerts.json` is read-only for this lane. Venue writes use the least-privilege data-maintenance credential.

The user has confirmed the production repository variable `VENUE_METADATA_RESEARCH_ENABLED=true` and the required `DATA_MAINTENANCE_TOKEN` secret are configured. Those are current production configuration facts, not authorization to manually dispatch the broad workflow or run providers on demand.

### v161 venue data-quality hardening

v161 tightened venue identity and evidence quality. Safe country/city aliases are canonicalized for matching while stored aliases/legacy IDs can be retained. Placeholder venue names such as Unknown/TBA/TBD do not become research targets. Known-country/address conflicts fail closed. Unknown future fields are preserved, and conflicting shared unknown fields block automatic consolidation.

`maxCapacity` means the highest reliably documented maximum across normal concert/event configurations, not event attendance or a guessed configuration. Obvious ticket sellers, social profiles, tourism pages, directories, aggregators and event listings are rejected as official venue websites. Failed/evidence-less research does not create a successful `researchedAt` timestamp.

The local `scripts/venueMetadataDedupeV161.js` tool has no provider/R2 path. Different-name venues may be consolidated only when the pair is explicitly confirmed by review-note evidence naming the counterpart. Generic confirmation on one record cannot authorize a same-address merge with another venue. Negated confirmation language also fails closed. The cleanup normalizes records individually before pair evaluation so same-ID records cannot bypass the pair-specific rule.

## Production venue cleanup completed

On 2026-08-24 the user downloaded the current production `venues.json`, supplied it for offline review, and explicitly authorized the eventual production replacement.

The source snapshot contained **1,208 records**. The final audited cleanup candidate contained **530 records**:

- 651 conservative duplicate records consolidated;
- 27 Unknown/TBA-style placeholder records removed;
- 0 duplicate `venueId` values remaining;
- 0 placeholder venues remaining;
- 0 blocked/non-official `officialUrl` values remaining;
- 0 unresolved/no-evidence records retaining misleading `researchedAt` timestamps;
- 0 structurally invalid records in the audited candidate;
- no capacity or official-site-origin conflicts inside the reviewed merged groups.

The dry-run initially exposed a real same-complex risk: AFAS Dome and Lotto Arena Antwerpen share an address but are distinct arenas. PR #175 added pair-specific confirmation safeguards and regression tests so those venues remain separate. The exact final PR head `75a61dcd4e49c8f36954a3607c8d8085d19c4c41` passed unit/safety, desktop Chromium and mobile Chromium QA before merge.

After PR #175 merged, the user confirmed that the cleaned 530-record file was uploaded to the top level of the production R2 bucket as `venues.json`. This production-upload fact is based on the user's confirmation; the private R2 object cannot be independently read from the current ChatGPT tool environment.

No broad production research workflow, provider run, Worker deployment or production smoke was triggered as part of the cleanup.

## v162 Next Concert capacity layout

v162 preserves the venue metadata content contract but corrects its Next Concert presentation. Capacity uses the muted address-sized treatment and no longer collides with the ticket-quantity CTA at supported mobile/desktop widths. Synthetic browser assertions cover 375px, 480px and 1280px layouts with no capacity/CTA overlap or horizontal overflow.

## v164 canonical venue directory identity

v164 corrects the Venues directory so cards represent canonical physical venue identity instead of raw `concert.venue + concert.city` strings. Known `venues.json` aliases, canonical city/country spelling and stable `venueId` identity collapse matching concert references into one venue card and one Venue Detail history across the full collection rather than through hard-coded Royal Arena/Pumpehuset exceptions.

Placeholder names such as `Unknown venue`, Unknown, TBA and TBD never render as standalone venue cards. Placeholder concerts may join a known venue only when existing stored location/address evidence identifies exactly one canonical venue; ties and missing evidence remain omitted rather than guessed. Shared-address complexes such as AFAS Dome and Lotto Arena Antwerpen remain distinct.

The canonical fallback is intentionally scoped to the venue directory and venue-specific statistics. Ordinary concert-card and Next Concert metadata lookup keeps the established `findVenueRecord` behavior. Known address conflicts fail closed, including when a matching alias lacks its own address and therefore cannot override a conflicting primary venue address.

`uniqueVenues` and `topVenues` use the same canonical venue interpretation, but the existing event/statistics engine receives the original records unchanged. Therefore v164 does not change automatic concert-night grouping, spend, travel, ticket averages, event relationships or other non-venue metrics. It does not rewrite `concerts.json`, stable IDs, `eventGroupId`, attendance, tickets, notes, ratings or unknown/user-owned fields.

The verified post-v163 production concert snapshot audit found 1,364 raw venue/city combinations, including 25 placeholder cards covering 64 records and 15 definite non-placeholder same-venue/canonical-city duplicate groups. Synthetic regression coverage includes Royal Arena, Pumpehuset, Nordichallen placeholder recovery, Filmstudion, Roxy, Ippodromo SNAI San Siro, Hollywood Bowl, distinct Greek Theatre venues, unresolved/ambiguous placeholders, AFAS Dome/Lotto Arena shared-address safety, alias address-conflict safety, and preservation of non-venue event statistics.

## v166 venue navigation performance correction

v166 preserves the v164 physical-venue identity contract while removing the repeated full-dataset scans that made Dates/Venues navigation regress to minute-scale waits on the current collection. Venue metadata lookup now indexes normalized primary/reviewed-alias names before calling the existing conservative `findVenueRecord` matcher. Canonical venue grouping indexes the same name/address evidence once, caches the current in-memory canonical directory, and reuses the existing group for Venue Detail and unchanged return navigation.

The ordinary Dates concert list is kept outside canonical venue-group construction entirely. Dates DOM is reused when its relevant data/view state is unchanged, and venue directory/detail clicks use delegated handlers rather than repeatedly attaching hundreds of row listeners. Cache invalidation remains tied to the current in-memory concert/band/venue-record state; no cache is persisted as source data.

The optimization does not broaden venue identity. Known address/country conflicts still fail closed, unresolved or ambiguous placeholders remain omitted, reviewed aliases/canonical city variants may resolve one known physical venue, and distinct same-address venues such as AFAS Dome and Lotto Arena Antwerpen remain separate. Ordinary concert-card and Next Concert metadata behavior is not broadened. No concert, band or venue record, stable ID, event relationship, user-owned field, provider-owned field or unknown future field is rewritten by v166.

Synthetic browser coverage adds a production-scale fixture of **3,260 concerts, 520 venue records and 320 tracked bands**. It asserts that ordinary Dates builds zero canonical venue groups, the Venues directory builds once and is reused by detail/return navigation, indexed metadata lookup builds once, all 520 venue cards render, and broad timing ceilings prevent recurrence of multi-second/minute synchronous navigation. The existing v164 canonical venue correctness suite remains authoritative and continues to run on both desktop and mobile Chromium.

## v165 reviewed provider-decision safety

v165 closes a browser-side ownership gap exposed by the manual Ticketmaster identity enrichment. The Settings MusicBrainz review actions (`Use this artist`, `None of these`, and `Try again`) rebuild the root `musicbrainz` identity, but now carry forward every direct nested provider object whose status is `manual_confirmed` or `manual_rejected`. This includes Ticketmaster, Spotify and unknown future providers, and preserves each reviewed provider object wholesale including unknown future fields.

The preservation is intentionally narrow: ordinary automated nested provider state and stale MusicBrainz metadata are not carried into a new root MusicBrainz decision. Node-side automation and conflict merges retain their existing reviewed-decision protections.

The Band Data view now presents the existing manual provider markers naturally: stored `confidence: "user_confirmed"` renders as `User confirmed`, and `matchMethod: "user_approved_exact_id"` renders as `User-approved exact ID`. The final implementation normalizes only the dedicated Data-tab `Confidence` and `Match method` rows, so unrelated provider-owned text containing the same words is not rewritten. The persisted schema and provider trust semantics are unchanged; this is display-only normalization.

v165 changes no provider selection rules, Ticketmaster admission rules, quotas, pacing, schedules or production data. The version/cache bump exists because the browser safety/UI correction is user-visible and must invalidate the PWA shell cache. The exact final PR head `37aa018e0951eded9703638c5e6dcb28c3ea0441` passed PR QA run #1820, including unit/safety, syntax, version/cache, workflow/build-state/fixture checks, Desktop Chromium and Mobile Chromium synthetic QA, before PR #180 merged.

## Event/performance statistics contract

Concert performance records remain independent. `lineupRole` is a user-owned `headliner`/`support` field. Existing explicit `eventGroupId` relationships remain authoritative, while v157 also derives an effective shared event at read time only when attended records have exactly matching date plus conservative venue and non-empty normalized city context. Automatic grouping writes no relationship field.

Concert nights, spend, travel, venue/city visits, event milestones and ticket extremes are event-level. Artist appearances, ratings, setlists, genres and lineup roles are performance-level. v160 sums user-entered `ticketPrice` contributions across valid event members; it does not deduplicate different performance prices. Ticket-quantity and travel conflict handling remain conservative. v164 changes only venue-directory/venue-stat identity interpretation and leaves the underlying event grouping inputs untouched.

## Active safety and ownership boundaries

- Stable IDs, user-owned fields, reviewed decisions and unknown future fields must be preserved.
- Attendance, notes, ratings, ticket price/quantity/free state, playlist/photo links, manually added concerts, favorites, muted state, lineup role and event relationships remain user-owned under their established rules.
- Automated browser QA uses only synthetic fixtures and the QA fake backend.
- Production provider calls, production workflows, deployments and production data changes require explicit authorization.
- Production smoke is manual-only and read-only.
- Provider calls remain under UsageTracker caps/pacing and existing circuit/lease rules.
- Raw private listening history remains outside ordinary GitHub Actions/automation inputs.
- Existing JSON writes use optimistic concurrency and bounded reread/reconciliation.

## Active UI contracts to preserve

The current Start root is visibly `MYMUSIC`; the first bottom-nav item is Music with the approved five-bar equalizer. Stats uses the approved angular rising-line glyph. The Next Concert normal-day ticket remains the v147/v148 geometry/chrome contract, with v162 capacity layout correction layered on top; concert-day Maps/OwnedTickets behavior remains unchanged.

ConcertDates/Band Detail geographic filters retain Nearby -> SE -> EU semantics, with SE meaning exact canonical Sweden. My Bands search remains transient. Listening yearly Overview mode changes density only and keeps all underlying yearly data.

## Backlog hygiene

Completed/superseded historical work must not be treated as current debt. PR #134 remains intentionally open as production-inert NB2 tooling. Cloudflare Worker CORS-origin hardening and versioned CSS/JS patch-layer consolidation remain deferred maintenance work and should stay isolated from feature builds. The focused Ticketmaster offer-label hardening remains separate from v166.

## Next operational steps

PR #182 is the active v166 application build. Continue the exact-head fix -> validate -> review cycle until unit/safety, desktop Chromium and mobile Chromium are green and the final head is merge-ready. Do not merge without the user's explicit `Merge it` authorization, and do not run production providers, production research workflows, production smoke, deployments or production-data mutations without separate explicit authorization.
