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
