# LiveVault Current State

This continuity file was compacted on 2026-08-24. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged application baseline is **v162**. `APP_VERSION` and `CACHE_NAME_LITERAL` are both `v162`, and `docs/LIVEVAULT_BUILD_STATE.json` reports `versionsMatch: true`. PR #174 fixed the Next Concert capacity layout without changing venue data semantics. PR #175 then hardened the offline venue-cleanup tool; it merged to `main` at `c9af931190599828e66c27b583f87932c5f23b9e`.

No app/service-worker version bump was required for PR #175 because it changed only offline cleanup tooling and tests. No deployment or production workflow was triggered by that PR.

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

## Event/performance statistics contract

Concert performance records remain independent. `lineupRole` is a user-owned `headliner`/`support` field. Existing explicit `eventGroupId` relationships remain authoritative, while v157 also derives an effective shared event at read time only when attended records have exactly matching date plus conservative venue and non-empty normalized city context. Automatic grouping writes no relationship field.

Concert nights, spend, travel, venue/city visits, event milestones and ticket extremes are event-level. Artist appearances, ratings, setlists, genres and lineup roles are performance-level. v160 sums user-entered `ticketPrice` contributions across valid event members; it does not deduplicate different performance prices. Ticket-quantity and travel conflict handling remain conservative.

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

Completed/superseded historical work must not be treated as current debt. PR #134 remains intentionally open as production-inert NB2 tooling. Cloudflare Worker CORS-origin hardening and versioned CSS/JS patch-layer consolidation remain deferred maintenance work and should stay isolated from feature builds.

## Next operational venue step

The production venue dataset cleanup is complete by user confirmation. The next normal venue-maintenance milestone is the first real scheduled venue-research run under the existing twice-monthly schedule and its operational verification. Do not manually dispatch the broad production workflow merely to test the venue lane; manual provider/workflow execution remains separately authorized.
