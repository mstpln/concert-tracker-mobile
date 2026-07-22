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

## 2026-07-18 — Band profiles use four tabs

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
