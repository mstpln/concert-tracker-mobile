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

**Decision:** Keep release identity, provider observations, baselines and lifecycle state under each band’s existing `structuredResearch.releases` structure. Do not add `releases.json`, a Releases screen, a discography browser, song lists or navigation.

**Reason:** Release data is research identity and deduplication state, not a new user-managed collection. Per-band storage preserves stable ownership and supports the existing coordinated-write model.

**Consequence:** Four lifecycle stages are supported: Album Announced, New Single, Upcoming Release and Out Today. Upcoming Release applies only to album/EP records with a full date exactly seven days away, and is suppressed for 14 days after Album Announced. Singles never receive Upcoming Release. New Single exposes Spotify only with a trusted direct release URL. Artwork is optional and compact, with a local placeholder.

## 2026-07-22 — Release baselines are conservative

**Decision:** Provider baselines are never reset automatically; historical catalogues, first baselines and partial/resumed baselines remain silent.

**Reason:** Alerts must describe genuinely newly observed releases, not replay a back catalogue or promote incomplete provider data.

**Consequence:** Existing generic structured album alerts remain compatible and render safely, while lifecycle state is additive and preserves user-owned and unknown fields.

## 2026-08-01 — ListenBrainz is the listening-history direction

**Decision:** Future personal listening events come from ListenBrainz. MusicBrainz artist identity is the preferred bridge to stable local bands; Spotify is optional trusted metadata/artwork enrichment only and is not the listening-history source.

**Reason:** ListenBrainz provides an open event model compatible with the app's existing MusicBrainz identity backbone without requiring Spotify personal-account history.

**Consequence:** Phase 1 exposes a normalized provider-neutral event interface and deterministic synthetic events only. It adds no account controls, provider calls, production listening file, Worker allowlist entry, R2 write, migration or fabricated production history.

## 2026-08-01 — Listening and concert statistics share one Stats destination

**Decision:** Bottom navigation is Concerts, Dates, Bands, Stats, Alerts. Stats contains Listening and Concerts subtabs, with Listening default; the existing concert statistics remain intact under Concerts.

**Reason:** The app needs one primary statistics destination while keeping listening facts separate from concert-history facts.

**Consequence:** My Concerts links separately to Stats/Listening and Stats/Concerts. Dates, My Bands and Alerts retain their existing content and behavior.

## 2026-08-01 — Band profiles add a fifth Listening tab

**Decision:** Band Detail tabs are Concerts, Alerts, News, Listening, Data. Concerts remains the default; listening rankings can deep-link to Listening using stable `bandId`.

**Reason:** Artist-specific listening analysis belongs with the artist but must not be mixed into concert content.

**Consequence:** The existing hero and four prior tab contents stay unchanged, five-tab keyboard behavior is preserved, and Bands is active in bottom navigation throughout Band Detail.

## 2026-08-01 — Listening periods and movement use shared deterministic rules

**Decision:** Three months is current date minus three calendar months and uses weekly buckets; one year is current date minus one calendar year and uses monthly buckets; All time begins at the earliest event and uses yearly buckets. Current windows are start-inclusive/end-exclusive with the resolved current instant included. Movement compares the immediately preceding equivalent period and shows Up, Down, New or nothing; All time omits movement.

**Reason:** Every listening surface must agree on boundaries, totals, ranks and charts.

**Consequence:** `listeningStats.js` is the single pure calculation layer for all pages. Phase 1 QA uses one fixed clock and `listeningFixtures.js` as the sole synthetic ListenBrainz-shaped source; UI renderers do not duplicate calculations.
