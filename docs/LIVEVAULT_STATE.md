## v192 — Softer Spotify CTA Variant 4 (PR, not deployed)

- Discover > Bands green Spotify links now use approved Variant 4: closer to Spotify's original hue, a restrained top-edge lightening and a nearly flat green body. This replaces the darker metallic v191 vignette only for `#screen-concerts .discover-actions .discover-spotify`.
- Spotify icon, label, original link destination, card text, button dimensions, border width, responsive three-action row, keyboard focus and Dismiss/Add actions remain unchanged. All Settings divider glows and other v191 styling remain unchanged. This is a CSS-only styling correction; no application data, provider calls, quota or Worker changes.
- The existing synthetic Playwright regression now verifies the v192 matte dual-linear gradient, absence of the old radial vignette, original link and icon, untouched Settings styling, narrow 375/480px layouts and light/dark themes. `APP_VERSION` and `CACHE_NAME_LITERAL` advance together once to v192. Branch/PR/QA status must be confirmed against GitHub; this record does not authorize or establish a production release.

## v191 — Spotify green spotlight and Settings divider highlights

- Use the existing v187 blue primary CTA treatment as a *shape and light-position* reference for the green Spotify button inside Discover > Bands. Keep it green, with a static asymmetric dark-edge/bright-center gradient and white label/icon; preserve the link destination, behavior, dimensions and 3-button layout.
- In Settings (Automation, Review, Data), keep existing 2px horizontal section borders and 4px rounded vertical accent pills at the exact positions and dimensions. Overlay the established v186/v187 Highlights stats-card blue gradient and restrained outward halo without changing content, semantics or responsive layout.
- Do not restyle other blue accent lines, navigation, progress indicators, focus outlines, active tabs, generic cards, or any other Spotify controls. Visual-only change: no data shape, Worker, API/provider logic, quotas, migrations, or runtime dependencies.
- APP_VERSION and CACHE_NAME_LITERAL advance together to v191. Synthetic QA tests cover gradient/glow, screenshot comparisons, keyboard and layout safety at 375/480px in light/dark themes. Release status must be verified against GitHub PR and Pages workflows, not inferred from this implementation record.


## Merged v190 — Prevent stale browser writes from undoing an R2 backfill

- A stale pre-backfill PWA session can lose artist-enrichment and review decisions after two Add Band operations: the first 412 response merges the latest R2 document safely, but Add Band passed a transient-stripped copy and never reconciled the in-memory list, so the next ordinary write could revert to the old IDs. This was identified through an offline comparison of two privately supplied backups (379 corrected artist records versus 381 after two additions); those backups are not in the repository or QA fixtures.
- Add Band now performs a fresh authorized bands.json read before appending one artist, serializes its own submit action, and makes the reconciled write result the active in-memory list. A failed read/write cannot add an unsaved artist to the active list. Legacy browser enrichment code paths that write cloned snapshots likewise restore the persisted reconciled list after saving. No provider APIs, quota caps, Worker code, storage schema, or existing ID ownership changed.
- Synthetic, isolated ETag/412 browser regression QA covers an out-of-band update during the first Add Band save followed by a second Add Band save, protecting reviewed identity decisions, unknown fields, and newly added artists. The backup/recovery file is a separate offline operation and requires explicit production-data authorization; v190 does not modify any R2 data during build or QA.
- v190 was merged via PR #217 and deployed through GitHub Pages on 2026-10-12 at merge commit `8d96337c866b7a9044182f1029947d98e5377562`. Already-open stale pre-v190 tabs require a full reload; the manually prepared corrected bands.json backup is a separate production-data operation, not part of the code release.


## v189 — Identity-first, bounded new-artist profile research (PR #216; verify release via GitHub)

- New Add Band records retain a small additive artistProfileResearch pending marker, save and appear without a stale fetching-info label, and do not start a browser research request. The client never resumes name-only Wikipedia/AI for marked artists after pending/partial/complete/retryable transitions. User-edited official URLs may still refresh source-backed official artwork; legacy unmarked artist enrichment remains available.
- MusicBrainz identity lookup is enabled in the existing Monday/Wednesday/Friday structured workflow for at most two eligible artists per run; three of the shared five MusicBrainz calls remain available for confirmed-artist metadata, prioritizing new pending profiles. Existing IDs, user-reviewed decisions and unknown fields are protected; concurrent duplicate MusicBrainz IDs, stale artist renames and outdated nested manual-provider choices fail closed, and solo artists receive the strict same-name confirmation path. Legitimate artist names with Revival do not trigger tribute rejection.
- Confirmed MusicBrainz metadata now retains only validated official homepage, Wikipedia and Instagram relationships and a group-only formation year. A bounded two-new-profiles-per-run lane fills blank data only, with Wikipedia linked to the exact MusicBrainz identity and a 30-credit-per-month Tavily fallback in the existing twice-monthly focused web-research workflow only, for verified official sites; Groq may extract a short, source-supported bio from official excerpts, never serve as the identity authority. No extra workflow, key or historical backfill. Existing Ticketmaster events with clear tribute wording are rejected even if they contain the trusted attraction ID.
- The MusicBrainz metadata refresh cadence is 365 days rather than 90, reserving existing request capacity; Spotify's persisted rate-limit circuit, provider global caps and original production workflows remain unchanged. Scheduled release discovery stays disabled. QA used only synthetic fixtures and did not access production API or R2 data. APP_VERSION and CACHE_NAME_LITERAL are synchronized at v189. GitHub PR/Pages activity, not this implementation record, establishes whether the release is deployed.

## v188 — Actionable automation statuses and inspectable artist candidates

Implemented on branch `fix/automation-retrying-artist-review-v188` from v187 `main`; PR and release status must be checked against GitHub. Not a production deployment record.

- Settings > Automation > Update activity distinguishes Healthy (normal), Retrying (known recoverable lookups automatically revisited), and Failed (investigate). Structured research can complete successfully while individual setlist.fm lookups are rate-limited, unavailable, or identity-uncertain: known retryable per-show failure categories show Retrying, not Failed, with a clear note that BANDMARKR will check again at the next scheduled run. Genuine failed runs, unclassified failures, and checks with no verified automatic retry remain Failed; unknown status is Not reported rather than a fabricated retry. A connected ListenBrainz device without a successful sync shows neutral Not synced, not a false automatic retry.
- Settings > Review > Artist matches now provides safe, explicit View on Spotify and View on MusicBrainz profile links for stored candidates, including identically named artists. Spotify candidate IDs remain visible to distinguish alternatives; the existing Use this artist, None of these and Later decisions remain manual and unchanged.
- No provider API calls, quota changes, identity-matching relaxations, stored-data/schema changes, migrations, or production workflows. Only Settings presentation/classification of existing stored activity, tests, continuity docs and synchronized v188 app/cache versions. Known limitation: no persisted repeated-failure escalation counter is introduced; a repeated recoverable lookup remains Retrying until a genuine run failure or unclassified error is reported.

## v187 — Visual consistency and Blue Light corrections

Implemented in PR #214 on branch `feat/visual-consistency-v187`, originally based on merged v186 `main` commit `d0b829c527874cde59eff27d9f0132ca9e781528`. For its current release status, verify PR #214, GitHub `main`, and GitHub Pages Actions; this implementation record does not itself establish whether a deployment completed.

- Restore neutral Upcoming / Past / Cancelled secondary tabs by excluding the shared history selector from v186 first-letter lighting CSS and JS. Preserve the v184 continuous selector/card frame, all three active states, and 42px geometry.
- Match My Bands list rows to the approved Past concert-card surface token (dark `#1d2124`; light `#eef1f5`) without recoloring Add Band, grey badges, or other generic cards.
- Give only blue accent words in top page headers a restrained, static asymmetric blue glow/gradient. Keep typography and layout unchanged.
- Preserve the v186 stats-card 1px shimmer, with a modest additional outward blue halo; no animation.
- Use the same static asymmetric blue gradient on all filled primary CTA actions (`.btn-primary` and Discover `.discover-add`) including Official site and Add a concert. Exclude grey/outlined buttons, grey pills, neutral tabs and active state filters.
- Presentation-only release. No schema, data, providers, persistent storage, or production workflow changes. Advance app/cache to v187 together; synthetic unit/browser QA required.

## Merged v186 — Asymmetric Blue Light styling and unified concert-card surfaces

Branch `feat/blue-light-unified-concert-cards-v186` was merged via PR #213 and deployed through GitHub Pages on 2026-10-11 at merge commit `d0b829c527874cde59eff27d9f0132ca9e781528`.

- Approved Blue Light v3 color-only theme: reuse the existing Next Concert spotlight color family. The unchanged text-only BANDMARKR wordmark banner has asymmetrically brighter blue behind its lettering and darker side edges. Every existing blue **primary segmented tab** (Music/Stats/Discover/Band Profile/Settings and Discover blue location selections) gets a static dark-edge asymmetric gradient; the lighter area is anchored at the actual **first letter** of the active tab label without altering labels or event listeners. The blue active bottom-nav tile gets a static darker asymmetric gradient with a softer light source centered on its icon. The Next Concert blue banner, cyan concert-day state, muted neutral secondary tabs, buttons, other card content and typography remain unchanged.
- Highlights Listening stats/Concert stats frames retain their 1px blue outline and accepted subtle glow. Compared to the v3 HTML design, the two darker border stops are **slightly** deeper blue; neither is black, and card geometry/v185 12px spacing is untouched. No animation.
- All **concert listing** card bodies (featured Next, Upcoming/Past/Cancelled Music history, Band Detail Upcoming/Past, Discover > Concerts, and Venue Detail) explicitly use the established Past surface token `--concert-card-background-v86` (dark `#1d2124`, the **actual legacy Past-card dark surface**, and light `#eef1f5`). This also removes the historical gray background override for cancelled *listing* cards while preserving their cancellation indicators/actions. Generic band-directory rows, Discover artist recommendations and Alerts/Release notification cards are not concert-listing cards and retain their own appearance.
- Further v186 final review found that the previous v86 dark token (`#232a32`) is the *old Upcoming* appearance, while the higher-specificity v129 Past rule uses `#1d2124`. The shared concert-listing surface now correctly adopts **the actual Past color** (`#1d2124`) instead of incorrectly recoloring Past to Upcoming; the existing light-theme surface stays `#eef1f5`. Existing v86 QA expectations were updated to the new approved color; no storage changes or extra version bump.
- Focused v186 correction during PR review: the v129 Past-card rule has greater CSS specificity than the general shared surface, so the new theme explicitly overrides `#screen-myconcerts .row-card-mc.is-past`. Concert-listing Past card opacity is normalized to 1 so the identical background no longer appears dimmed. Historical synthetic browser checks are updated accordingly; no new version bump or data change.
- Only a new CSS and a lightweight client-side first-letter positioning helper are added to the PWA shell. There is no data change, storage/provider call, API secret, animation or production workflow. v186 app/cache versions match, with synthetic unit/browser validation and documented limitations.

## Merged v185 — Music Highlights balanced spacing

Branch `fix/highlights-vertical-rhythm-v185` was merged via PR #212 and deployed on GitHub Pages on 2026-10-11 at merge commit `a240479b2d386c137113d5b62ee8c3318e467200`.

- The approved v185 refinement applies **only** when Music > Highlights is active: reduce the gap from the bottom of the existing 33px primary Highlights / Concerts selector to Listening stats from about 20px to 12px, and reduce the gap from Listening stats to Concert stats from 16px to 12px. The approximately 12px saved vertically provides breathing room above the unchanged bottom navigation on the reference phone viewport.
- Do not change the space above the primary tabs, either card's contents/size/fonts/colors, any click behavior, scroll-container bottom padding, safe-area handling, Music > Concerts, other app pages, data records or providers. Single-card Highlights with no past concerts remains supported.
- Scoped CSS is appended to the existing `musicSectionsV183.css` (no new runtime assets); synthetic regression tests cover both present/absent Concert stats and narrow/wide viewports. App/cache versions are synchronized at v185; deterministic build state refreshed.

## Merged v184 — Combined Band Listening card and integrated Concerts history tabs

Branch `feat/integrated-listening-concert-cards-v184` was merged as PR #211 and deployed to GitHub Pages on 2026-10-11 at `35bfdba1861b845922620e89f3ee976c3edd6211`.

- Approved Band Detail > Listening change: the exact existing Your Listening summary and Listening Over Time chart are moved (not cloned/re-rendered) into one common neutral card frame. The v183 muted timeframe control remains at the top of the original summary section. Graph geometry, axes, metrics, timeframe calculations, labels and separate Top Tracks/Top Albums card are unchanged.
- Approved Music > Concerts change: the 42px muted Upcoming / Past / Cancelled selector visually joins the first native concert card in the active panel, sharing one continuous outline with no gap or duplicate top border. Extra cards remain independent; later-year headings, original concert details and actions are not altered. The v183 year/count heading stays outside/above the tab-card group and keeps its current counting/text rules. Empty lists have a matching attached panel.
- The new finishing layer changes only DOM grouping/classes and CSS: no new data fields, provider/network/storage calls, identifiers, migrations or production workflows. v184 APP_VERSION and CACHE_NAME_LITERAL remain synchronized. QA runs exclusively with synthetic fixtures and the fake backend.

## Merged v183 — Music Highlights/Concerts and consistent secondary selectors

Branch `feat/music-highlights-concerts-navigation-v183` is under review, based on merged v182 `main` at `0fcd9e9bc4ad9efcbc381a4d927eb06465967ed3`. **Merged and deployed** via PR #210 to GitHub Pages on 2026-10-11 as merge commit `9b5fa6ad926c07b735bb927dcfbbe631df1e329a`.

- Music adds the approved 33px/13px primary Highlights / Concerts selector. Highlights initially opens with the existing start listening and concert stats cards, unchanged. Concerts has last attended concert (artist, calendar date, local elapsed days), the established v182 Next Concert card or its empty state, and Upcoming / Past / Cancelled history.
- The lower concert-history selector uses the existing neutral 42px Top Bands/Top Tracks styling (three columns), with the existing year-left/show-count-right header outside the individual concert cards and above the selector. The heading follows the selected tab; the first year is not duplicated inside the list, and later year sections remain. Featured validated event group cards are not duplicated in Upcoming.
- Band Detail > Listening keeps the blue 33px/13px primary tabs, but moves the existing timeframe control into the top of the Your Listening card using the same neutral 42px secondary-tab treatment. Its existing listeners and calculations remain unchanged.
- The v182 day numeral gets a minimal font/baseline alignment correction within its unchanged 100px / 88px banner, while the concert-day variant, other card content, navigation actions, IDs and data are untouched. The old invisible featured-card spacers no longer consume space in the newly separated Concerts view; the original pre-v183 placement invariant remains historical to the old combined layout.
- No new data fields, provider calls, production R2/Worker operations or manual production workflows. v183 app and service-worker versions are synchronized. QA uses synthetic fixtures and the fake backend.

# LiveVault Current State

## Merged v182 — Compact Hero Split (#21) for the featured Next Concert banner

Branch `feat/next-concert-compact-hero-v182` implements the user-selected Version 21 (Compact Hero Split) on top of merged v181 `main` at `f4e0ffa199354bd254252dfffd7879e0d04c9955`. PR #209 was merged into `main` as `0fcd9e9bc4ad9efcbc381a4d927eb06465967ed3` on 2026-10-11; GitHub Pages deployment was automatically triggered. This paragraph retains the historical branch implementation details.

- Ordinary pre-concert Next Concert cards now put one large but proportionally scaled day number at left, `NEXT CONCERT` and `DAYS / LEFT` beside it, and distance above a live days/hours/minutes countdown to the right of a vertical divider. The blue header adopts Version 21's gentle spotlight gradient.
- The 110px-high mockup is scaled to the narrower actual PWA card: 100px banner at 375/390/480px and 88px at 320px. Very long day counts scale down separately. Seconds are intentionally not displayed in Version 21, but the existing ticker still updates the day/minute fields and concert-day rollover.
- **Position invariant:** the Next Concert card's vertical top and its blue banner start remain **unchanged from v181**. The v181 invisible original separator and year-spacer geometry above the card remain untouched. The larger/shorter internal content must not move the card up or reveal blue sooner above fixed selected Music navigation. Synthetic browser tests compare the top edge before/after changing banner height on the same page.
- The existing cyan CONCERT DAY version, ticket/get-directions actions, support/headliner grouping, concert tabs, and user records remain untouched. No provider calls, Worker/R2 modifications, production secrets or production workflows. `APP_VERSION` and `CACHE_NAME_LITERAL` are both v182, using existing shell assets only.

## v181 — Start concert tabs, restored visibility, and approved Next banner

Implemented in PR #208 on `feat/start-concert-tabs-cancelled-visibility-v181`, based on `main` at `d168b60aa0a0b60c7c86071b3628d5f84feb068e` (v180 / PR #207). This section records implemented behavior; verify PR #208 and the GitHub Pages deployment workflow for authoritative merge and production-release status.

- Root cause: v180 initialized inactive Past/Cancelled tab panels with native HTML `hidden`, then switched them using the CSS `.hidden` class. After navigation or reload, switching to Cancelled selected the tab visually but left `hidden` intact. The stored cancellation was not automatically deleted. v181 sets the actual `panel.hidden` property for all three tabs; automated synthetic QA reopens and reloads a cancelled concert and confirms it remains visible and restorable.
- Start has a single Upcoming concerts / Past concerts / Cancelled tab strip, default Upcoming. Each of the three equal-width tabs has 33px outside height and 13px normal-case type. The same sizing/typography applies to the app's other primary segmented tab sections, while listening timeframe controls remain separate. The former stand-alone Upcoming and Past headings are retired.
- The v167 Next Concert promoted card remains at the same vertical **top edge**: the retired NEXT CONCERT separator is visually hidden while preserving its old geometry. This prevents a blue-banner sliver rising into view directly above the fixed blue-selected Music navigation at the original initial scroll position. The originally approved support/headliner event grouping and ticket controls still operate before the remainder of Upcoming is moved under the new tabs; the promoted event is not duplicated.
- The new 80px blue banner follows **exact approved option 02**: small NEXT CONCERT over 13px "12 DAYS LEFT" at left, a vertical divider and 75 km above the full live countdown at right, without an oversized day number. A special concert-day banner retains its separate CONCERT DAY styling and ticket actions.
- Year headings within Upcoming, Past and Cancelled show the year on the left and that year's show count on the right, with no connecting horizontal line; existing count/group behavior remains.
- Source changes are limited to the static PWA and its QA/tests. No provider calls, Worker/R2 change, production secret, source-data migration or production workflow execution. `APP_VERSION` and `CACHE_NAME_LITERAL` are both v181 and the deterministic build-state shell list includes the new modules.

## v180 — personal concert cancellation and history

PR #207 (`feat/cancelled-concert-history-v180`) was developed from authoritative `main` at `479ec811aa40e0871bed1a202a2572051bd6a6f3`. The v180 source pairs `APP_VERSION` and `CACHE_NAME_LITERAL` at `v180`.

- The Start/My Music page replaces the Past divider with Stats-style **PAST CONCERTS / CANCELLED** tabs, Past selected by default, and matching option-8 uppercase no-icon ATTENDED (green) / CANCELLED (red) labels.
- Upcoming records have a 28px Cancelled action beside the 28px trash control with 20px separation; cancelled records have same-size-position Restore. Both require confirmation. Both manually added deletion and discovered-concert removal require confirmation.
- Optional user-owned `personalLifecycleStatus: 'cancelled' | 'active'` leaves all provider-owned lifecycle/evidence and other user/unknown fields intact. Cancellation remains visible in history across dates and excludes concerts from all personal attendance, travel and ticket-spending statistics and upcoming countdowns. Restore requires a confirmed future date.
- Valid same-date event groups update their personal statuses together without splitting canonical concert/event identity.
- The optimized venue directory/detail and Discover read caches include provider and personal lifecycle state in their cache keys, ensuring status changes neither show stale upcoming concerts nor mislabel cancelled concerts as Attended. The date-only fallback venue render path also distinguishes cancellation.
- No Worker, R2 schema, scheduled provider workflow, production data, quota, secret or external API change is required by this release. QA uses synthetic fixtures exclusively.

This continuity file was refreshed on 2026-09-04 after the full workflow/data-enrichment audit and final pre-merge PR #206 review. Earlier implementation detail remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The previous v179 release had merge commit `845a5bf6a8b16603306a1b427569af74a81936a0` (PR #205). Its `APP_VERSION` and `CACHE_NAME_LITERAL` were synchronized at `v179`. PR #204 introduced the provider identity/lifecycle conflict safeguard; PR #205 completed post-merge ownership hardening so weaker/unrelated provider evidence cannot control top-level lifecycle or leak provider-presentation identity fields.

Merged PR #206 (`fix/workflow-enrichment-integrity-qa`, merge commit `479ec811aa40e0871bed1a202a2572051bd6a6f3`) implemented the workflow/data-enrichment integrity correction without a PWA shell or version bump. Its scope is scheduled-run idempotency, focused Tavily canonical ingestion/reporting and failure-safe retry behavior, and explicit/latest-state fail-closed safety for the historical legacy release cleanup.

## Canonical identity and ingestion

### v174 foundation

Canonical venue identity supports current/historical names and locations, namespace-scoped provider identities, legacy venue IDs and parent/sub-location semantics. Rooms, halls, stages, theatres, temporary structures and hospitality sub-locations resolve to their parent venue when explicitly represented. Independent venues in one complex and simultaneous branches remain distinct. Historical concerts preserve date-correct raw venue facts while current/upcoming presentation can use current canonical venue facts.

Canonical concert identity is `bandId + canonical venue identity + full calendar date`. Time, provider event/listing ID, room/stage and ticket package/offer do not split a concert. Existing valid explicit `eventGroupId` remains user-owned/authoritative. Ordinary derived event identity is canonical venue + date; evidence-backed festival editions may span dates/venues.

### v175 lifecycle/provider ownership

Automatic concert observations must reconcile through shared canonical identity before persistence. Matching observations preserve the stable BANDMARKR concert ID, user-owned fields and unknown future fields while namespace-scoped provider evidence accumulates additively. Latest-state ETag reconciliation protects newer user edits.

Cancellation retains the record and history. Confirmed upcoming reschedules retain stable identity and former-date evidence. Postponed without a verified replacement date becomes `POSTPONED · DATE TBD`. Attended historical dates are immutable. Ambiguous continuity fails closed.

Ticketmaster automatic admission requires the band's trusted confirmed attraction ID and that exact attraction on the returned event. The trusted band attraction ID is persisted even when a co-bill artist appears first. Active evidence cannot reactivate a cancelled concert without provider-linked replacement continuity to a new date. Cancelled/postponed top-level state belongs to the provider event that owns the selected presentation. Weaker/unrelated provider evidence remains an observation and may set `lifecycleReviewRequired`, but cannot replace stronger top-level presentation fields.

### v176 audit/migration

Deterministic local audit/research/migration tooling is hash-guarded, reversible and fail-closed. It preserves stable/user-rich IDs, transitive legacy mappings, provider/source/lifecycle evidence, explicit false values, unknown future fields and user ownership. Production migration was completed and independently verified.

Verified production migration baseline/output:
- source venues: 530 -> production venues: 540
- source concerts: 3,331 -> production concerts: 2,989
- attended: 76 -> 76; historical dates unchanged
- ticket total: 14,671 -> 14,671
- ticket quantity: 58 -> 58
- all source venue/concert IDs remain traceable
- zero orphan references, duplicate stable IDs, unknown-field loss, evidence loss or second-pass mutation blockers were found

## Performance

v177 and v178 restored production-scale navigation performance after the canonical migration. The v166 contract remains mandatory: ordinary Discover/Concerts does not construct the full canonical venue directory; venue identity is indexed/cached; Venues builds once and Venue Detail reuses the group.

Production-shaped synthetic profiling at 379 bands / 540 venues / 2,989 concerts improved approximately:
- first Venues render: 19.8 s -> 160 ms
- statistics: 3.6 s -> 27 ms
- Music: 5.5 s -> 147 ms
- startup: 5.7 s -> 259 ms

## Workflow and enrichment audit — September 4, 2026

The audit reviewed all repository workflow definitions, enrichment scripts, provider identity logic, canonical write boundaries, recent scheduled/manual run history, CI/synthetic safety, and the September 4 structured research run. No production workflow was manually dispatched and no production data/provider action was initiated by the audit.

### Structured research scheduling

PR #203 changed `Structured concert and release research` to `07:47 UTC` Monday/Wednesday/Friday to avoid top-of-hour congestion. GitHub Actions delivery remains materially delayed and can duplicate a scheduled period:

- September 2 run #25 was created around 05:30 UTC from the earlier nominal schedule and completed successfully.
- September 2 run #26 was then created at 12:17 UTC and executed another full provider cycle rather than no-oping. It made roughly 384 Ticketmaster and 29 setlist.fm calls, added one concert and applied one Ticketmaster upgrade.
- September 4 run #27 was not created until 12:15:50 UTC, about 4 hours 29 minutes after the configured 07:47 UTC target. It completed successfully at about 12:21 UTC.

The shared `live-vault-data-writes` concurrency group plus persisted scheduler lease correctly prevent overlapping provider writers, but before PR #206 they did not prevent a later duplicate schedule event for the same intended period. PR #206 adds persisted per-owner completion markers. Structured research, focused Tavily, and the optional twice-monthly venue-metadata stage each suppress a later duplicate scheduled execution for the same intended period before provider work. Every known scheduled provider stage maps to its most recent nominal schedule occurrence, including cross-midnight and multi-day GitHub delivery delays, so scheduled provider work never runs without a period marker. An unknown/unconfigured scheduled provider owner fails closed before lease acquisition or provider work. Manual `workflow_dispatch` remains unaffected, failed stages do not mark the period complete, unknown usage fields are preserved, and malformed marker state fails closed. This prevents duplicate quota/data work but cannot force GitHub to deliver a delayed or missing schedule event.

### September 4 structured research run #27

Run #27 completed successfully on merged `main` (`845a5bf...`). Key observed behavior:
- bands processed: 379
- new concerts: 10
- Ticketmaster upgrades: 32
- ambiguous Ticketmaster matches: 417, held rather than guessed
- Ticketmaster calls: 384
- Tavily: 0 (month total remained 142/900)
- Groq: 0
- setlist.fm: 29
- Spotify: 0
- setlists checked: 9/9 eligible past shows; 0 new setlists
- predicted setlists: 5 upcoming attending, 0 currently due
- live-performance insights: 2 eligible, 0 processed; 20 setlist.fm requests

The run repeatedly failed closed on `provider_identity_collision`, `lifecycle_venue_unresolved`, `venue_location_conflict` and `provider_band_conflict`. Ticketmaster event lookup was skipped where a trusted attraction identity was missing. Setlist.fm 404/429 responses were treated as provider errors/retry conditions, not persisted as false no-setlist facts.

### Focused Tavily

Historical focused Tavily scheduling is also substantially delayed: the September 1 run nominally scheduled for 02:00 UTC began around 07:32 UTC. That run attempted 142 bands, observed 23 candidates and prepared 21 additions; malformed Groq responses were rejected/logged rather than accepted. Its venue-metadata phase made zero writes.

The audit found a code-path inconsistency: focused Tavily still used the pre-v175 `reconcileConcertCandidate` heuristic and a plain latest read/write instead of shared canonical ingestion. PR #206 corrects this. Focused Tavily observations now pass through the v175 canonical ingestion primitive with the current venue index and `writeJsonReconciled`, preserving stable IDs, user/unknown fields, lifecycle/provider ownership and latest-state concurrency. Run metrics count only actual persisted additions, observation merges and lifecycle continuations as changes; exact idempotent replays are reported separately as unchanged. A successful evaluated search with no accepted concerts may advance the established adaptive empty-result backoff, but Tavily/Groq failure, quota skip, malformed/empty extraction, structurally invalid or entirely invalid Groq tour output, or a thrown focused-search error cannot be treated as a trusted no-concert result: the prior success/backoff state and previously committed fingerprints are left intact, additive failure diagnostics are recorded, and the band remains retryable. The optional venue-metadata stage in the same twice-monthly workflow now has its own scheduled completion marker so a duplicate GitHub schedule cannot bypass the first-stage no-op and still spend provider quota in the second stage.

### Provider/data-quality logic reviewed

- **Ticketmaster:** trusted reviewed attraction ID is required for automatic event lookup/admission; the exact trusted ID must appear on the event; multi-attraction/co-bill order cannot replace tracked-band identity; ambiguous identity/venue continuity fails closed.
- **MusicBrainz:** automatic confirmation requires exact artist-name/alias evidence, no impersonator signal, no origin contradiction/unverifiable saved-origin case, threshold clearance and a clear lead. Otherwise candidates remain reviewable.
- **Setlist.fm:** actual setlist persistence requires date + artist identity + venue agreement. Multiple/no matching candidates are not guessed. 404/429/provider errors do not become trusted absence facts.
- **Focused Tavily provider failures:** provider/extraction failure or skip is retryable evidence of an incomplete evaluation, not proof that no concert exists; it cannot advance empty-result backoff or consume newly observed fingerprints as if the evaluation had completed.
- **Spotify candidate acquisition / provider identity backfills / approved-identity application:** review/approval ownership boundaries remain in place; no audit finding showed automatic overwrite of user-reviewed provider identity.
- **Venue metadata research:** incomplete/ambiguous research remains fail-closed; the September 1 focused run attempted no venue writes. PR #206 also protects the scheduled venue-metadata stage from later duplicate schedule executions.
- **Legacy release cleanup:** this is manual/destructive historical tooling. PR #206 requires the explicit phrase `CLEAN_LEGACY_RELEASE_FEED`, requires `RELEASE_FEED_BACKUP_PATH`, refuses missing/malformed non-array `news.json`, uses latest-state reconciled mutation, writes the exact rollback snapshot before mutation, and keeps an existing rollback snapshot eligible for artifact upload even when the cleanup step fails after the snapshot was created.
- **PR QA / full PWA QA:** synthetic fixture/fake-backend boundaries remain intact. Unit/syntax/version/cache/workflow/build-state/QA-safety checks and desktop/mobile Chromium are the normal merge gates.
- **Production smoke:** remains manual-only and read-only with separate authorization.

## Active safety boundaries

- Stable BANDMARKR IDs, user-owned fields, reviewed decisions, provider ownership/provenance and unknown future fields must be preserved.
- Existing optimistic-concurrency/latest-state safeguards remain mandatory on enrichment writes.
- Automated browser QA uses synthetic fixtures and the QA fake backend only; production R2 and live providers are forbidden.
- Production provider calls, production workflows, deployments, production smoke and production-data changes require separate explicit authorization. `Merge it` authorizes merge only.
- Production smoke remains manual-only/read-only.
- Provider ambiguity or provider failure must fail closed rather than invent identity, lifecycle, venue or absence facts.

## Project sequence

1. v174 canonical venue/concert/event foundation — merged.
2. v175 canonical ingestion/lifecycle — merged.
3. v176 audit/research/migration tooling — merged.
4. Production canonical migration — completed and verified.
5. v177 venue navigation performance correction — merged PR #201.
6. v178 global navigation performance correction — merged PR #202.
7. Structured research schedule adjustment — merged PR #203.
8. v179 provider identity/lifecycle safeguard — merged PR #204.
9. v179 post-merge provider/lifecycle ownership QA — merged PR #205 at `845a5bf6a8b16603306a1b427569af74a81936a0`.
10. Workflow/data-enrichment integrity QA corrections — merged PR #206; version remains v179; corrections cover scheduler idempotency, canonical focused Tavily persistence, retry-safe provider failure handling, and hardened cleanup rollback safety.
11. v180 personal cancelled-concert history, confirmed delete/restore controls, attendance/spending exclusion and cache invalidation — PR #207.

PR #134 remains intentionally open as unrelated production-inert listening backfill tooling. Production smoke remains separately authorized. No GitHub Desktop/local action is required for this webview-first work.
