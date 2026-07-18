# LiveVault Durable Decisions

## 2026-07-18 — GitHub and QA operating model

**Decision:** GitHub `main` is authoritative; chats are work sessions, not project history. QA uses synthetic data and public QA previews may be reachable because they contain no real data.  
**Reason:** Enables durable webview-first work without production exposure.  
**Consequence:** State/build documents and Git history are maintained; merge needs explicit user approval.

## 2026-07-18 — Concert data integrity

**Decision:** Stable concert IDs and user-owned/unknown fields survive all provider enrichment. Ticketmaster has precedence only for confident matches; exact event matching also requires same band and date.  
**Reason:** Avoid destructive false merges and preserve personal data.  
**Consequence:** Different dates are not reschedules; ambiguous/different event records remain separate.

## 2026-07-18 — Product structure and exclusions

**Decision:** Band profiles use Concerts, Alerts, News, Data (Concerts default); bottom navigation is Concerts, Dates, Bands, Alerts. Cancellation/reschedule/freshness conflict features are out of scope.  
**Reason:** Keep navigation concise and research claims conservative.  
**Consequence:** Do not reintroduce excluded review/badge concepts without explicit reconsideration.

## 2026-07-18 — Security

**Decision:** Owned-ticket PDFs remain private behind authenticated Worker routes; smoke checks use a separate read-only token and sanitized aggregates.  
**Reason:** A QA check must not expose personal records.  
**Consequence:** Read-only tokens cannot access raw JSON, tickets, or writes.
