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
