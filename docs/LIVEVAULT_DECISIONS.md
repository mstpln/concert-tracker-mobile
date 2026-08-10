# LiveVault Decisions

## 2026-07-18 — GitHub main is authoritative

**Decision:** Treat merged `main`, not a chat transcript or local clone, as the product source of truth.

**Reason:** Conversations and local checkouts can be stale.

**Consequence:** Inspect main, state, decisions and build state before work; pull local clones before local work.

## 2026-07-18 — Durable project memory lives in the repository

**Decision:** State, decision and generated build-state documents supplement chats.

**Reason:** Work must survive project-chat limits.

**Consequence:** Update durable facts with the matching implementation.

## 2026-07-18 — Concert identity and ownership are preserved

**Decision:** Stable concert IDs, user fields and unknown fields survive enrichment.

**Reason:** Research must never replace a person’s concert history.

**Consequence:** Use in-place, latest-record merges and provider-owned allowlists.

## 2026-07-18 — Ticketmaster precedence is conservative

**Decision:** Ticketmaster may enrich a record only on confident same-band/same-date evidence.

**Reason:** Different dates are not evidence of a reschedule.

**Consequence:** Ambiguous/different records remain separate; cancellation/reschedule monitoring is out of scope.

## 2026-07-18 — Band profiles use four tabs (superseded 2026-08-01)

**Decision:** Band profiles use Concerts, Alerts, News and Data, with Concerts default.

**Reason:** It groups existing information without changing ownership.

**Consequence:** Exact `bandId` filtering and keyboard tab navigation are required.

## 2026-07-18 — Synthetic QA and sanitized smoke

**Decision:** QA uses fictional data; production smoke is read-only and aggregate-only.

**Reason:** Browser review must never expose personal records or use providers.

**Consequence:** QA may be publicly reachable only with synthetic data; `READ_ONLY_TOKEN` is limited to `/qa-smoke`.

## 2026-07-18 — Explicit release authorization

**Decision:** A merge requires the explicit phrase `Merge it`.

**Reason:** A branch, PR, cache bump or passing tests is not deployment approval.

**Consequence:** Version/cache bump together once per build; focused pre-merge corrections stay on that version.

## 2026-07-22 — Structured release lifecycle stays internal and additive

**Decision:** Keep release identity, provider observations, baselines and lifecycle state under each band’s existing `structuredResearch.releases` structure. Do not add a separate production data file or Releases screen.

**Reason:** Release data is research identity and deduplication state, not a new user-managed collection.

**Consequence:** Album Announced, New Single, Upcoming Release and Out Today remain additive, conservatively sourced and backward compatible.

## 2026-07-22 — Release baselines are conservative

**Decision:** Provider baselines are never reset automatically; historical catalogues, first baselines and partial/resumed baselines remain silent.

**Reason:** Alerts must describe genuinely newly observed releases.

**Consequence:** Existing structured album alerts remain compatible and user/unknown fields are preserved.

## 2026-08-01 — ListenBrainz is the listening-history direction

**Decision:** Future personal listening events come from ListenBrainz. MusicBrainz identity is the preferred bridge; Spotify is optional metadata/artwork enrichment only.

**Reason:** The open event model fits the existing identity backbone without making Spotify the history source.

**Consequence:** Initial work uses normalized provider-neutral events and synthetic QA only.

## 2026-08-01 — Listening and concert statistics share one Stats destination

**Decision:** Bottom navigation is Concerts, Dates, Bands, Stats, Alerts. Stats contains Listening and Concerts subtabs, with Listening default.

**Reason:** The app needs one statistics destination while keeping listening facts separate from concert-history facts.

**Consequence:** Existing concert statistics remain intact under Concerts.

## 2026-08-01 — Band profiles add a fifth Listening tab

**Decision:** Band Detail tabs are Concerts, Alerts, News, Listening, Data. Concerts remains default.

**Reason:** Artist-specific listening analysis belongs with the artist but not inside concert content.

**Consequence:** Five-tab keyboard behavior and stable-band deep links are preserved.

## 2026-08-01 — Listening periods and movement use shared deterministic rules

**Decision:** Three months uses calendar subtraction and weekly buckets; one year uses calendar subtraction and monthly buckets; All time begins at the earliest event and uses yearly buckets. Movement compares the immediately preceding equivalent period.

**Reason:** Every listening surface must agree.

**Consequence:** `listeningStats.js` remains the pure calculation layer.

## 2026-08-01 — Historical Spotify export is a private local import (superseded 2026-08-03)

**Decision:** Historical Spotify data is imported only from a sanitized LiveVault file into browser-local IndexedDB. Raw and sanitized personal history never enter GitHub, R2, providers or public QA.

**Reason:** Listening history is personal.

**Consequence:** Only the strict event allowlist is retained; tests use synthetic records.

## 2026-08-01 — v72 listening scope and terminology

**Decision:** Event counts are labelled listens. Global and band-level statistics include only events mapped to stored LiveVault bands.

**Reason:** The counts represent listen occurrences and the product is scoped to followed bands.

**Consequence:** Start, Stats and ranking use Top 3, Top 10 and up to Top 100, with independent timeframe state.

## 2026-08-01 — v72 concert-card listening context

**Decision:** Upcoming cards show the rolling previous three months; past cards show the three months before the concert.

**Reason:** Upcoming context should reflect current interest, while historical context should reflect the lead-up to that show.

**Consequence:** Values are derived and never written to concert records.

## 2026-08-01 — v72 genre and artwork ownership

**Decision:** Genre groups derive from stored band genres. Spotify artwork may be fetched only for visible stored track IDs and cached locally.

**Reason:** Imported events do not contain trustworthy genre or artwork fields.

**Consequence:** No complete history is sent to Spotify and failures retain placeholders.

## 2026-08-02 — Existing JSON writes use optimistic concurrency

**Decision:** Every write to an existing production JSON document is conditional on the ETag from the corresponding read. A stale write is rejected and may be retried once only after rereading and applying the shared deterministic three-way merge.

**Reason:** Browser and automation edit the same full documents, making last-writer-wins unsafe.

**Consequence:** R2 performs atomic conditional puts. Stable-ID arrays preserve concurrent additions and unrelated changes; remotely changed records are protected from stale deletion.

## 2026-08-02 — Disconnect and device erasure are distinct

**Decision:** Disconnect removes only the saved Worker URL and credential. Erase this device removes all Live Vault state held by that browser, including settings, OAuth state, imported listening history, cached ticket PDFs and Live Vault shell caches.

**Reason:** Reconnecting and disposing of a device are different privacy actions and must not be ambiguous.

**Consequence:** Neither action deletes remote R2 JSON or permanent ticket PDFs. Erasure is confirmed explicitly and cache cleanup is scoped to `concert-tracker-shell-*`.

## 2026-08-02 — Browser and automation credentials have separate roles

**Decision:** `BROWSER_TOKEN` may use JSON and ticket routes. `AUTOMATION_TOKEN` may use only the allowed JSON routes. `READ_ONLY_TOKEN` remains limited to sanitized smoke. `API_TOKEN` is a temporary legacy fallback during migration.

**Reason:** GitHub Actions does not need access to private ticket files, and a single credential unnecessarily widens compromise impact.

**Consequence:** Deployment follows the staged order in `docs/SECURITY_BUILD_3_ROLLOUT.md`. Legacy access is removed only after both browser and automation roles are verified.

## 2026-08-02 — Network requests are bounded without hidden retries

**Decision:** Browser and automation requests receive a default 30-second timeout unless they already provide an abort signal. The shared timeout layer does not retry.

**Reason:** Hanging provider or Worker requests can stall the app or workflow, while generic retries could bypass provider quotas and UsageTracker accounting.

**Consequence:** Existing provider-specific bounded retry behavior remains authoritative, and timeout errors contain no credentials or private URLs.

## 2026-08-02 — Production workflow dependencies are pinned

**Decision:** The scheduled research workflow declares read-only repository permissions and pins checkout/setup actions to reviewed commit SHAs.

**Reason:** Production data-writing workflows should use least privilege and immutable action references.

**Consequence:** Action upgrades require an explicit reviewed SHA update.

## 2026-08-02 — Spotify is the sole visible release-feed source

**Decision:** The Releases feed contains only actual Spotify catalogue releases with a trusted Spotify release ID and album URL. Tavily, general articles and advance web announcements do not create release items.

**Reason:** The user wants music that is available where they listen, not general music news or speculative announcements.

**Consequence:** Album and single availability, Spotify URL and artwork come from Spotify. MusicBrainz may support identity and deduplication internally but does not independently create visible releases. Missing artwork uses a local fallback.

## 2026-08-02 — Alerts separate concerts from releases

**Decision:** The Alerts destination uses visible subtabs **Concerts** and **Releases**. Band profiles use **Concerts**, **Alerts**, **Releases**, **Listening**, and **Data**. Internal `news` identifiers and `news.json` remain for compatibility.

**Reason:** Repeating Alerts as both page title and subtab was redundant, while News no longer describes a Spotify-only release feed.

**Consequence:** Concert alerts derive only from `concerts.json`; Spotify releases appear only under Releases and never duplicate into Concerts.

## 2026-08-02 — Provider workflows use separate cadences

**Decision:** Structured Ticketmaster/Spotify research runs three times per week without Tavily or Groq. Focused Tavily/Groq concert discovery runs twice monthly under the same write-concurrency group.

**Reason:** Structured providers are inexpensive and benefit from frequent checks; web search is quota-limited and should be slower and narrowly framed.

**Consequence:** Both workflows keep existing UsageTracker enforcement, conditional Worker writes and pinned dependencies. Tavily never searches releases or general/status news.

## 2026-08-02 — Tavily concert searches use adaptive backoff

**Decision:** New bands receive an initial concert web search. Consecutive empty results defer the next search by 30 days, then 60 days, then recurring 90-day intervals. A later concert observation resets the cadence.

**Reason:** Retired or inactive bands should not consume the same recurring search budget as actively touring artists, but they must still be checked occasionally for comeback activity.

**Consequence:** No band is permanently disabled. Existing full-date, upcoming-only, impersonator and duplicate protections remain mandatory.

## 2026-08-02 — Legacy news cleanup is intentional and controlled

**Decision:** The v77 rollout removes non-Spotify records from `news.json`, including status/general articles, Tavily release announcements and concert/ticket articles. The compatibility filename remains unchanged.

**Reason:** The user explicitly requested that obsolete content be removed rather than merely hidden.

**Consequence:** Cleanup is idempotent, logs aggregate counts only and requires separate production-workflow authorization. Concert records and alerts remain in `concerts.json`.

## 2026-08-03 — Private R2 is the durable listening-history source of truth

**Decision:** Store the complete sanitized Spotify archive, including events for artists not currently in LiveVault, in private Cloudflare R2. Keep IndexedDB as each device’s fast offline working copy.

**Reason:** A browser-only archive is too fragile for long-term backup, recovery and multi-device continuity. The sanitized archive excludes account, password, IP, device and location fields, while retaining the source facts required for listening statistics.

**Consequence:** Production migration requires separate authorization. Real history never enters GitHub, public QA, logs or provider bulk requests. Visible statistics continue to include only events mapped to stored LiveVault bands, while unmatched events remain available for future remapping.

## 2026-08-03 — Spotify history uses one immutable content-addressed archive

**Decision:** Store the current Spotify history as one compressed immutable object at `listening/spotify-history/<sha256>.json.gz`, referenced by `listening/manifest.json`.

**Reason:** One logical history file is simple, while content addressing avoids rewriting or corrupting the previous complete archive. The manifest can change only after the new archive is durable.

**Consequence:** Prior archive objects remain recoverable and are not automatically deleted. Future incremental ListenBrainz events use separate bounded monthly objects rather than rewriting the historical Spotify archive.

## 2026-08-03 — Listening backup and restore are part of Build 3.1

**Decision:** Build 3.1 includes Cloudflare backup, local compressed export, integrity-checked restore and safe device bootstrap—not merely remote storage.

**Reason:** A storage migration is incomplete without a tested recovery path.

**Consequence:** Restore verifies SHA-256, schema and event count before replacing IndexedDB. Failed uploads or restores preserve the prior manifest and local archive. Worker deployment and real archive migration remain separately authorized production actions.

## 2026-08-03 — Listening artwork metadata remains separate from source events

**Decision:** Future Spotify album artwork URLs and album metadata are stored once in a separate shared metadata layer, while actual images are cached locally on devices.

**Reason:** Source listen records should remain compact and stable, and repeated listens must not duplicate the same artwork URL hundreds of times.

**Consequence:** Artwork failure never invalidates a listen or changes statistics. Artwork implementation remains deferred until after the v78 vault foundation.

## 2026-08-03 — Worker deployment follows reviewed GitHub main

**Decision:** Connect the existing `concert-tracker-api` Worker to Cloudflare Workers Builds after the v79 deployment configuration is merged. A merge to `main` that changes a watched Worker deployment file may deploy the reviewed Worker automatically.

**Reason:** Repository-owned deployment configuration removes error-prone manual copying while keeping GitHub `main` authoritative and preserving review and QA before production changes.

**Consequence:** `wrangler.jsonc` preserves the existing Worker name, `worker.js` entry point, `BUCKET` binding and `concert-tracker-data` bucket. Build watch paths are limited to Worker deployment files. Automatic Worker deployment does not authorize R2 data operations, migrations, secrets, production workflows or provider calls.

## 2026-08-03 — Cloudflare Worker builds use Node.js 22

**Decision:** Set the Cloudflare Workers Builds variable `NODE_VERSION=22` while keeping the repository's application and QA runtime on Node.js 20.

**Reason:** The pinned deployment command uses Wrangler 4.114.0, which requires Node.js 22 or newer. The application test toolchain remains validated on Node.js 20 and does not need to change.

**Consequence:** Cloudflare production Worker deployments run with Node.js 22. Repository PR QA continues to use the existing Node.js 20 contract until a separate reviewed runtime upgrade is approved.

## 2026-08-03 — v81 listening duration and ranking semantics (partially superseded by v85)

**Decision:** A valid listen with missing duration counts as a listen. Listening-time totals and time-based charts use only positive known duration. Top Bands, Top Tracks and Top Albums rank by known time, then listen count, recency and normalized title.

**Reason:** ListenBrainz may legitimately omit duration, and inventing or dropping those listens would make counts incorrect.

**Consequence:** Unknown-duration entries remain visible with zero known time, and relevant UI explains that time totals use listens with known duration.

## 2026-08-03 — v81 timeframe and page-state defaults

**Decision:** Start Top Bands uses rolling 14-day windows. Top 100 resets to 3 months on entry. Band Detail Listening resets to 1 year and Top Tracks on page entry, while preserving timeframe and Tracks/Albums selection while that Band Detail page remains open.

**Reason:** Start should reflect recent activity, while deeper pages need predictable defaults without discarding in-page exploration.

**Consequence:** Two-week movement compares the current rolling 14 days with the immediately preceding 14 days.

## 2026-08-03 — v81 albums are grouped and illustrated conservatively

**Decision:** Top Albums groups only normalized release names already present on stored listening events. Differently named editions remain separate, and artwork is shown only when the event already carries a stable approved release or track identity.

**Reason:** Text similarity is not reliable album identity.

**Consequence:** Missing release names are excluded only from Top Albums. Unresolved artwork uses a neutral placeholder without changing ranking or row visibility.

## 2026-08-03 — v81 yearly charts keep independent interaction state

**Decision:** The yearly-hours line chart and stacked genre chart each own an independent latest-six-year window and selected-year state. The line chart defaults to All genres and its pills affect only that chart.

**Reason:** The charts answer different questions and should not unexpectedly control each other.

**Consequence:** Empty calendar years remain visible, the current year is marked year-to-date, and moving a chart window clears only that chart's selection.

## 2026-08-03 — v81 refresh is a non-destructive shell update check

**Decision:** The Start refresh control requests a service-worker update, activates a waiting worker where available and performs one guarded reload with a bounded fallback.

**Reason:** The installed PWA needs an explicit way to check for a newer shell without simulating device erasure.

**Consequence:** Refresh never clears credentials, settings, IndexedDB listening history, cached user data or remote data, and remains safe when offline or when service-worker promises stall.

## 2026-08-03 — Top Tracks and Top Albums rank by listens

**Decision:** Top Tracks and Top Albums rank by listen count first. Known duration, recency and normalized title are deterministic tie-breakers. Top Bands remains ranked by known listening time.

**Reason:** A track or album ranking should represent how often it was played rather than favoring longer recordings or releases.

**Consequence:** Valid unknown-duration events contribute to track and album listen counts without inventing listening time, and every timeframe uses the same ordering.

## 2026-08-04 — Public app branding is BANDMARKR

**Decision:** The public app name is **BANDMARKR**. The top banner uses the approved centered condensed uppercase wordmark. The installed-app icon uses the approved `#024ddf` blue rounded-square background, a solid white bookmark, and condensed blue `BM` letters centered above the bookmark notch.

**Reason:** The new name and visual identity better describe marking and keeping bands and concert experiences while preserving the established app color and structure.

**Consequence:** User-facing titles, PWA metadata and active branding use BANDMARKR. Stable IDs, user-owned data, local-storage and IndexedDB identifiers, provider ownership boundaries, remote data, internal compatibility names and the `concert-tracker-shell-*` cache namespace remain unchanged unless a separate technical migration is explicitly approved.

## 2026-08-04 — Installed identity uses Bandmarkr and a simplified bookmark icon

**Decision:** Keep the in-app top banner and outlined wordmark as uppercase **BANDMARKR**, while using title-case **Bandmarkr** for the installed-app name and home-screen label. The installed icon is the existing `#024ddf` blue background with a plain white bookmark, no `BM` lettering, and an approximately 10% smaller bookmark footprint.

**Reason:** The title-case label has a better chance of fitting in mobile launcher layouts, and the simpler icon remains clearer at small sizes.

**Consequence:** Manifest, document application metadata, favicon, Apple touch icon and PWA/maskable icon assets use the refined installed identity. The in-app banner, application UI, stable IDs, user data, local-storage and IndexedDB identifiers, provider boundaries, remote data and `concert-tracker-shell-*` namespace remain unchanged.

## 2026-08-04 — Listening identity and deduplication remain additive

**Decision:** Build 3.2 introduces versioned identity records and canonical-listen relationships as derived data. Original Spotify and ListenBrainz observations remain intact. Deduplication suppresses duplicate aggregation only and never deletes a source event.

**Reason:** Provider observations are evidence and must remain recoverable, while visible statistics need one logical listen when two providers clearly describe the same play.

**Consequence:** BANDMARKR band IDs remain authoritative for application identity. MusicBrainz and Spotify IDs remain provider-owned evidence. User-reviewed identity and keep-separate/merge decisions cannot be overwritten by automation.

## 2026-08-04 — Automatic listening matches require trusted identity evidence

**Decision:** Automatic duplicate matching is limited to exact same-provider event IDs, exact MusicBrainz recording IDs within 1,000 ms, or exact Spotify track IDs within 1,000 ms. Level 4 remains probable only and requires matching release identity, timestamp compatibility, two known positive durations within 2,000 ms, and a matching normalized artist/title recording signature. Artist/title, same-name, live, remix, cover and tribute text evidence never auto-merges by itself.

**Reason:** The current ListenBrainz adapter has integer-second timestamps and the existing overlap logic compares same-second fingerprints. A narrow one-second boundary preserves that reality without turning text similarity into identity, while the extra recording signature prevents different tracks on the same release from becoming noisy probable candidates.

**Consequence:** Unknown duration does not block exact-ID matches and is never fabricated. Level 4 cannot be satisfied by release identity or duration alone. Candidate assignment in later builds must be one-to-one so two genuine nearby listens remain distinct.

## 2026-08-04 — Listening migration must be chunked and rollback-safe

**Decision:** Any later identity or canonicalization migration over the 250,000+ event archive must be chunked, resumable, idempotent and additive, with persisted cursors, versioned checkpoints, source-count verification and rollback by disabling/removing derived records.

**Reason:** All-at-once transactions, all-pairs comparison and destructive rewrites are unsafe at archive scale and would make interruption recovery difficult.

**Consequence:** No aggregate switches to canonical representatives until integrity checks pass. Production migration, provider backfill, R2 writes and archive replacement remain separately authorized actions.

## 2026-08-04 — Top Tracks and Top Albums use trusted Spotify links in Build 3.3

**Decision:** Build 3.3 will make Top Track titles open exact trusted Spotify tracks and Top Album titles open exact trusted Spotify albums, using the existing past-setlist Spotify-link interaction pattern.

**Reason:** The user wants the same direct Spotify navigation already available from past-concert setlists.

**Consequence:** Links are rendered only from trusted stored Spotify IDs or URLs. Missing or ambiguous identity leaves normal non-linked text; title-only guessing is prohibited.

## 2026-08-05 — Derived listening state is isolated and disposable

**Decision:** Store generated listen-identity and canonical-listen records in the separate local IndexedDB database `bandmarkr-listening-derived-v1`, never in the immutable source-history store.

**Reason:** Generated identity and deduplication state must be replaceable, rollback-safe and independently versioned without risking Spotify or ListenBrainz observations.

**Consequence:** Identity and canonical writes are atomic, bounded to 500 records, preserve unknown future fields and protect reviewed decisions. Rollback removes or disables derived versions only; it never edits source events.

## 2026-08-05 — Exact band-name mapping requires a unique owner

**Decision:** The migration runner may map a source event by exact normalized stored-band name only when exactly one stable BANDMARKR band ID owns that normalized name. Duplicate normalized names are ambiguous and remain unresolved. An explicit stable band ID remains authoritative.

**Reason:** Choosing the first or last matching band would create deterministic but incorrect identity assignments for same-name artists.

**Consequence:** Automated migration prefers false negatives over false positives. Ambiguous events remain available for later review or stronger identity evidence and are never silently assigned by array order.

## 2026-08-05 — Migration checkpoints follow complete derived writes

**Decision:** A migration checkpoint advances only after both the identity batch and canonical batch have committed successfully, with source counts verified before and after the chunk.

**Reason:** Advancing after a partial write would make resumed runs skip missing derived records, while a changing source archive would invalidate stable pagination assumptions.

**Consequence:** Interrupted runs safely repeat the current chunk, writes remain idempotent, and any source-count change fails closed without advancing the checkpoint.

## 2026-08-05 — Listening review is conservative, local and user-owned

**Decision:** Trusted Levels 1–3 may be assigned automatically only through deterministic one-to-one candidate selection. Probable and ambiguous candidates remain local review groups in the separate disposable database `bandmarkr-listening-review-v1`. **Decide later** is session-only. A pair-level merge resolves only that displayed relationship; unresolved alternatives remain pending. **Keep all separate** resolves the remaining group without editing source observations.

**Reason:** Uncertain evidence must neither silently change listening totals nor disappear as though the user made a choice. Review metadata must not occupy canonical source-event keys, and sequential pair decisions must not create canonical chains or overwrite prior human choices.

**Consequence:** Candidate writes affect only `bandmarkr-listening-derived-v1`; review-group writes affect only `bandmarkr-listening-review-v1`. Both remain local, bounded to 500 records per operation, rollback-safe and protected against reruns. Sequential merges flatten every member to one canonical representative, partial decisions remain available until completed, and source observations remain immutable. Audit output remains aggregate-only. No real archive migration, R2 access, provider call or visible canonical aggregation switch occurs without separate authorization.

## 2026-08-05 — Canonical listening totals require explicit local activation

**Decision:** Preparing canonical listening data and using it for visible statistics are two separate local actions. Preparation writes and verifies derived identity, canonical and review records but leaves visible statistics unchanged. Visible statistics switch only after the user selects **Use cleaned totals**. Only trusted automatic or completed user-reviewed duplicate relationships are excluded; probable and ambiguous groups remain counted separately until reviewed.

**Reason:** The real listening archive is private and large, and derived matching can become stale when new listens arrive. A two-step flow lets the user see aggregate results before changing the app while preserving a clear fallback to the original source observations.

**Consequence:** Activation fails closed when canonical coverage is incomplete or the source event count differs from the prepared count. A later history change marks activation stale and restores source-event totals until preparation is run again. Source observations, R2 objects and provider records are never rewritten, and development/QA use synthetic fixtures only.

## 2026-08-07 — Spotify artwork runs are foreground-only, bounded and manually resumed

**Decision:** A manual Spotify listening-artwork fetch owns a persisted logical batch of at most 100 trusted unresolved track IDs. BANDMARKR saves each completed track locally, stops that logical run when the PWA leaves the foreground, and requires another explicit **Fetch listening artwork** tap to continue the same remaining batch. Foregrounding the PWA never silently restarts provider calls.

**Reason:** Mobile browsers may suspend or terminate PWAs unpredictably, and a resumed request loop must not repeat completed Spotify calls or accidentally turn a partially completed 100-track run into another full 100-track allowance.

**Consequence:** The local run checkpoint is required before provider calls and fails closed if it cannot be persisted. A 50-of-100 interruption resumes only the remaining 50 IDs; completed IDs are skipped. Spotify HTTP 429 handling remains bounded and quota-aware, source listening observations remain immutable, and the separate historical backfill remains an explicitly authorized maintenance operation outside the app.

## 2026-08-07 — Historical Spotify artwork backfill is local, resumable maintenance

**Decision:** The historical listening-artwork backfill stays outside the BANDMARKR app and outside GitHub Actions. The supported production path is a manually invoked local Node maintenance runner. It verifies the private Spotify archive and ListenBrainz incrementals before planning work, sends only exact trusted Spotify track IDs to Spotify, uses a private ignored checkpoint, defaults to 25 track requests per invocation with at least 1,000 ms pacing and a hard logical ceiling of 100, and routes every real Spotify provider operation through the existing `UsageTracker`.

**Reason:** Spotify Development Mode quota size and reset timing are not reliable enough for an all-at-once backfill, while the existing GitHub automation role is intentionally barred from private listening objects. A local resumable runner preserves that role boundary and prevents completed provider work from being repeated across quota stops, process interruption or metadata synchronization failures.

**Consequence:** `QUOTA_EXCEEDED`, ordinary 429, 401/403, malformed responses and ETag conflicts stop conservatively without hidden loops. Completed provider results are checkpointed before more track work and a fully staged logical batch is not expanded until it is synchronized. Relinked provider IDs never replace the requested trusted identity. Private production reads/live Spotify calls and production metadata writes use separate explicit authorization gates; the write gate is additionally required for `--write`. Real checkpoint files must remain inside ignored `.livevault-maintenance/`, and no production backfill operation is authorized merely by merging the maintenance code.

## 2026-08-07 — Listening identity completion preserves exact edition boundaries

**Decision:** Manual listening-identity completion may add a MusicBrainz recording MBID only from an exact normalized artist-and-recording match. ListenBrainz release output is not accepted as proof of a specific edition. A missing release MBID is never inferred from release text. When a source listen already carries a trusted MusicBrainz release MBID, BANDMARKR may retrieve only that exact release's release-group context. Canonical sibling listens may contribute one unambiguous recording MBID but may never transfer release or release-group identity between editions.

**Reason:** Recording identity can safely improve track-level grouping, but edition identity is materially stricter. Treating a provider-selected or sibling release as exact evidence could merge deluxe, remaster, regional, or otherwise distinct releases and would violate the existing conservative identity model.

**Consequence:** Release-group identity remains context only and is never an album grouping key. Partially enriched same-title historical listens stay together unless contradictory trusted same-provider IDs prove distinct editions. Identity enrichment remains additive and local, immutable source observations remain unchanged, and all live provider use remains explicit and bounded.

## 2026-08-07 — MusicBrainz release-context lookups keep a two-second safety margin

**Decision:** Browser requests to the authenticated `/musicbrainz/release-context` route start at least 2,000 ms apart. The pacing guard applies only to that route; ListenBrainz and unrelated browser requests keep their existing behavior. MusicBrainz 429/503 responses still stop the manual identity run and are never retried automatically. The existing 25-combination manual run cap remains unchanged.

**Reason:** The first controlled physical v104 identity-completion run reached the MusicBrainz route and was rate-limited after roughly three processed combinations while using the previous 1,000 ms boundary. MusicBrainz documents approximately one request per second as the normal client limit, so operating exactly at that boundary left too little margin for real network timing and service pressure.

**Consequence:** Release-context enrichment is intentionally slower but more conservative. A MusicBrainz-heavy 25-combination run may spend roughly 50 seconds or more on provider pacing, while source listening events, R2 data, identity evidence rules and album-edition boundaries remain unchanged. Automated QA remains synthetic and does not call the live provider.

## 2026-08-07 — Release-group context must not block recording identity completion

**Decision:** The manual **Complete listening identities** action resolves only missing recording MBIDs through ListenBrainz and does not call MusicBrainz release context. Existing trusted release and release-group identities remain preserved. The authenticated Worker release-context route and its pacing guard remain available for a future separately scoped enrichment path.

**Reason:** Controlled physical runs on both v104 and v105 stopped on MusicBrainz rate limiting, including after v105 doubled browser-side pacing. Release-group identity is optional context and is not an album grouping key, so Worker-egress or MusicBrainz availability must not block conservative recording identity work that ListenBrainz can complete.

**Consequence:** v106 prefers completing recording identity and deferring release-group enrichment. The 25-combination cap, resumable local cursor, trusted-artist requirement, exact normalized artist/recording matching, source immutability, no guessed release edition, additive derived identity writes and no hidden retry remain unchanged.

## 2026-08-07 — Listening maintenance uses a dedicated least-privilege role and derived identity document

**Decision:** Historical and scheduled listening maintenance uses a distinct `DATA_MAINTENANCE_TOKEN` role rather than widening the existing research automation credential. Cross-provider track mapping and retry state live in the separate derived document `listening/track-identities.json`. Spotify-owned exact-track metadata remains in `listening/spotify-metadata.json`, extended additively with provider-returned Spotify artist IDs and ISRC when available.

**Reason:** Listening maintenance needs read access to private immutable listening objects and narrowly scoped derived writes that the research workflow does not need. Separating credentials and documents preserves provider ownership, keeps source observations immutable, and lets track identity/retry state evolve without contaminating Spotify-owned metadata or user-owned records.

**Consequence:** The maintenance role may read bands, concerts, api usage and listening objects, but it may write only `apiUsage.json`, Spotify listening metadata and track identities in the listening-only foundation. It cannot access tickets, read news, mutate bands/concerts, rewrite manifests or immutable archives, or use the browser-only MusicBrainz release-context route. Known provider IDs, ISRCs, statuses and retry dates are validated while unknown future fields remain additive. The role and new document remain inert until separately authorized production secret/configuration and data creation; merging code does not authorize provider calls, R2 writes, workflow runs or backfill activation.

## 2026-08-08 — Listening maintenance advances only across explicit durability gates

**Decision:** Build C maintenance executes one Build B provider step at a time. Before every provider attempt, the persistence preflight and provider-usage gate must each return explicit approval. After a provider result is validated and merged into derived state, persistence must explicitly confirm durability before the runner may plan or call another provider. Checkpoint history is audit state only; Build B's provider retry status and `nextEligibleCheckAt` remain authoritative for retry eligibility.

**Reason:** Provider quota must not be spent when durable progress is already known to be unwritable or stale, and an ambiguous callback result must never be interpreted as successful persistence. Checkpoint bookkeeping must also never suppress a legitimately due explicit retry.

**Consequence:** Missing/false/undefined approval fails closed. Persistence exceptions or non-confirmation stop the batch before another provider call. Terminal retry/error/review halt reasons are persisted with the step result. Build C defaults to 25 provider steps with a hard ceiling of 100, remains synthetic-only until live adapters and maintenance-specific UsageTracker/Worker persistence are separately reviewed, and merging this foundation does not authorize production provider calls, R2 operations, secrets, schedules or backfill activation.

## 2026-08-09 — Build D begins with dual authorization and a five-step ceiling

**Decision:** The first Build D production enrichment entrypoint requires separate explicit authorization for provider execution and derived production writes. It defaults to one provider step and hard-caps the initial rollout at five provider steps per invocation while reusing Build C's persistence preflight, UsageTracker accounting, strict conditional writes and retry ownership.

**Reason:** The production inventory found 12,026 Spotify-track work items, so the first real enrichment must prove the complete quota, provider-response and durable-write path on a tiny sample before the rollout can expand. Provider calls cannot safely run in a nominally read-only mode because Build C intentionally persists provider usage before each request.

**Consequence:** Merging Build D code does not authorize a live backfill. The first production invocation remains separately authorized and should use one provider step. Increasing the five-step code ceiling requires a later reviewed change after real aggregate results have been inspected; source listening observations remain immutable.

## 2026-08-09 — Bulk listening backfill is one resumable local process

**Decision:** Keep the validated five-step Build D entrypoint unchanged for focused diagnostics and add a separate local bulk entrypoint for the full historical enrichment. The bulk process reuses the same one-step planner and persistence gates, runs internal chunks of at most 100 provider steps, automatically continues only after a durable `batch_limit`, and has a 50,000-step runaway ceiling. It requires a third exact full-backfill authorization in addition to the existing provider-execution and derived-write authorization gates. Bulk-only maintenance ceilings may be widened without changing ordinary research-pipeline caps or provider pacing.

**Reason:** Three separately authorized one-step production runs proved the real Spotify → MusicBrainz → ListenBrainz evidence path and durable writes. Restarting the command thousands of times would add human error without improving per-step safety. At the same time, Spotify Development Mode does not provide a stable numeric quota that the app can safely assume, so an unattended process must remain resumable and stop when the provider itself reports quota or throttling conditions.

**Consequence:** The intended full backfill can be started once and continue unattended until work is complete, the explicit bulk ceiling is reached, or a provider/data-safety condition requires a stop. Every completed provider result is durable before another step. Spotify client-credentials tokens are refreshed during long runs. A structured Spotify `QUOTA_EXCEEDED` response stops the process without marking the current track terminal, so a later separately authorized invocation can resume it. Source observations remain immutable, output remains aggregate-only, and merging the bulk code does not authorize or start production enrichment.

## 2026-08-09 — Bulk review-required tracks are quarantined instead of stopping unrelated work

**Decision:** A persisted provider `needs_review` result remains terminal for that individual track but is not a process-wide halt in the full bulk backfill. Bulk mode records the existing review-required identity state, leaves that work item excluded from automatic routing, and continues to unrelated tracks. The focused 1–5 step diagnostic entrypoint keeps the original halt-on-review behavior.

**Reason:** The first separately authorized v111 bulk invocation persisted four provider steps and then stopped safely on one `musicbrainz:needs_review`, with more than 12,000 unrelated provider steps still planned. Requiring a manual restart for every ambiguous track adds operational risk without improving the conservative handling of the ambiguous item itself.

**Consequence:** Bulk review quarantine never guesses or auto-resolves identity. Retry/error outcomes, structured provider-wide quota halts, usage denial, stale state, concurrency changes, persistence failures and other safety exceptions still stop the bulk process. Source observations remain immutable, the correction stays on v111, and resuming production remains separately authorized after review and merge.

## 2026-08-09 — Transient MusicBrainz maintenance failures are explicit retries

**Decision:** Listening-maintenance MusicBrainz ISRC lookup treats HTTP 429 and 503 as retryable provider availability failures. A usable `Retry-After` remains authoritative; otherwise the maintenance path records a conservative 30-minute retry. Network and timeout failures use the same dated retry policy. HTTP 404 remains a legitimate no-match, while malformed responses and other non-transient failures remain terminal errors. Bulk mode may also repair legacy records created by the old policy only when both the root identity and MusicBrainz provider state are `error`, the provider reason is `http_429`, `http_503`, or `musicbrainz_network_error`, and the original provider `checkedAt` is valid.

**Reason:** The separately authorized long-running v111 backfill stopped after 97 persisted provider steps on `musicbrainz:error`. Under the old policy, a temporary provider outage could both halt the invocation and permanently remove that track from automatic retry.

**Consequence:** A transient MusicBrainz result is persisted as `retry`. Legacy recovery derives `nextEligibleCheckAt` from the original `checkedAt` plus 30 minutes, preserves unrelated and unknown fields, and leaves incomplete or non-transient errors terminal. Any legacy correction is written through a strict identity-only conditional persistence step before provider usage is reserved or a provider call is made; concurrent identity changes abort the run. Spotify, ListenBrainz, 404 fallback, review quarantine and the focused diagnostic path remain unchanged. Later bulk outcome-policy decisions below supersede this entry's original process-wide stop consequence.

## 2026-08-09 — Bulk transient retries defer a provider without blocking unrelated work

**Decision:** The full bulk backfill persists a track-level retry exactly as before, then defers that provider for the remainder of the current invocation instead of stopping all unrelated work. The runner may continue eligible work through other providers. It does not call the deferred provider again during that invocation. The focused 1–5 step diagnostic path keeps the original stop-on-retry behavior.

**Reason:** The first post-PR-#100 production attempt persisted 118 provider steps and correctly converted the transient MusicBrainz condition into `musicbrainz:retry`, but stopping the entire 12,000-track migration at every transient provider retry would require repeated manual restarts and leave unrelated provider work idle.

**Consequence:** Bulk mode carries the deferred-provider set across internal 100-step chunks. Later bulk outcome-policy decisions below generalize this from retry-only deferral to any provider-scoped failure while keeping durable retry state authoritative.

## 2026-08-09 — Bulk maintenance outcomes are scoped to item, provider, or global safety boundaries

**Decision:** Full bulk maintenance classifies outcomes by scope rather than by individual error string. A semantic/data validation failure from an otherwise successful provider response is item-scoped: the affected derived identity is persisted as terminal/quarantined and unrelated work continues. A provider adapter/transport/HTTP/auth failure or an explicit provider-wide halt is provider-scoped: the current track is left unmodified, that provider is deferred for the rest of the invocation, and eligible work through other providers may continue. Explicit dated retries keep their durable retry state and also defer that provider. The focused diagnostic entrypoint remains fail-fast by default.

**Reason:** After PR #101 merged, the next separately authorized production attempt successfully deferred MusicBrainz and continued, but then stopped after 52 attempted/persisted steps because one Spotify response contained a malformed ISRC. A one-off exception for every malformed field would repeat the same operational failure pattern. The durable distinction is whether the evidence is bad for one item, unavailable for one provider, or unsafe for the entire maintenance process.

**Consequence:** Bulk mode uses the generic `provider_deferred:<provider[,provider...]>` end reason when only deferred-provider work remains. Provider-scoped failures never poison the current track into permanent `error`; a later separately authorized invocation can retry it. Item-scoped failures never guess or salvage invalid provider evidence and remain excluded from automatic routing until separately reviewed or repaired. Missing configuration caught before a call, UsageTracker denial, stale/concurrent state, failed/non-confirmed persistence and thrown data-safety checks remain global stops. No hidden provider retry loop is added, deferred providers are not called again during that invocation, source observations remain immutable, v111 remains unchanged, and production resumption remains separately authorized after review and merge.

## 2026-08-09 — Bulk provider stops retain safe aggregate diagnostics

**Decision:** Full bulk maintenance must retain a safe aggregate reason whenever a provider is deferred or a usage gate blocks execution. The diagnostic state records provider outcome counts, provider deferral kind and controlled reason, the exact retry-eligibility timestamp for dated retries, and controlled UsageTracker denial reasons. The same aggregate diagnostic state carries across internal 100-step chunks and is copied into the existing maintenance checkpoint as well as progress/final summaries.

**Reason:** The post-PR-#102 production invocation attempted 473 provider steps and persisted 472. A read-only reconstruction could prove MusicBrainz was deferred by `retry:http_503`, but the exact final Spotify provider-level failure could not be recovered because the affected track was correctly left untouched and the old summary retained only the provider name. Rebuilding code for every future unknown stop would be operationally fragile.

**Consequence:** Provider-scoped failure safety remains unchanged: the current track is not poisoned, no raw provider payload is persisted, and a deferred provider is not retried inside the same invocation. Usage denial still makes zero provider calls; only the safe diagnostic checkpoint is persisted and no track or Spotify metadata is mutated. Diagnostic values are restricted to known provider names, controlled status/reason strings, aggregate counts and retry dates; track IDs, artist names, titles, tokens, URLs and raw provider messages are excluded. A later read-only inspection can determine whether a stop was a retry, provider error, provider-wide halt, repeated-item circuit breaker, daily/per-run cap, policy denial or missing usage hook without another code change. This remains a focused v111 correction and does not authorize production resumption.

## 2026-08-10 — Catalogue-first listening resolution preserves durable routing holds

**Decision:** Historical listening identity resolution moves toward the cache/catalogue-first architecture from the revised Data Automation plan: reuse existing recording identity first, anchor automatic local matching to the already trusted MusicBrainz artist MBID, require exact normalized recording evidence and conservative release evidence, leave ambiguous candidates unresolved, and reserve Spotify for genuinely Spotify-specific presentation or metadata work. Existing durable root or provider `needs_review`, `retry`, `error`, and `no_match` states are not automatically reopened by the C2 resolver or future batch-bridge planning.

**Reason:** The revised architecture should reduce provider dependence without discarding review decisions, retry ownership, terminal quarantine, provider boundaries, or previously persisted maintenance evidence. A new evidence source is not sufficient reason to silently bypass durable state.

**Consequence:** C2 remains production-inert and treats held durable states plus catalogue ambiguity as exception/review work. Any C3/C4 rule that deliberately reconsiders an old held state must be explicit, tested, additive and preserve unknown fields and source observations. Production catalogue persistence, freshness/checkpoint semantics, Worker allowlisting, provider adapters, backfill activation and the six-hour schedule remain separately reviewed and authorized steps.

