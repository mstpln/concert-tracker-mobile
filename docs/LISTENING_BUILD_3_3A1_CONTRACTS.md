# Listening Build 3.3A1 contracts

## Scope

Build 3.3A1 audits BANDMARKR bands without a trusted Spotify artist identity and allows manual review only when exact candidates are already stored. Candidate acquisition is deferred to separately approved Build 3.3A2.

## Identity ownership

Durable Spotify artist identity and review decisions remain under `band.musicbrainz.spotify`. Audit counts are derived from local listening history and are not stored in source listening observations.

Trusted Spotify statuses are `confirmed` and `manual_confirmed`. Duplicate trusted Spotify artist IDs remain unresolved conflicts.

## Conservative listening association

Listening evidence maps to a band by an existing stable `bandId` or `localBandId`. Text fallback is allowed only when an exact normalized artist name belongs to exactly one stored band. Ambiguous names remain unmapped. No fuzzy matching is used.

## Manual review

Only exact stored `reviewCandidates` can be confirmed. No candidate is selected automatically. Confirmation uses `manual_confirmed`; rejection reuses `manual_rejected` and records the exact rejected candidate IDs while preserving candidate evidence.

Before writing, the app re-reads the latest `bands.json`, locates the band by stable ID, and merges only the nested Spotify provider record. Deleted bands are not recreated, and newer manual decisions are not replaced.

## Preservation

Review writes preserve stable IDs, user-owned fields, MusicBrainz and Ticketmaster identity, unknown future fields, source listening observations, canonical listening records, and duplicate-review decisions.

## Safety

Build 3.3A1 makes no Spotify or other provider requests, runs no production workflows, accesses no production R2 data in QA, and uses only synthetic browser fixtures. It does not acquire missing candidates, change listening totals, start preparation, or activate cleaned totals.

## Future 3.3A2 boundary

Candidate acquisition will be a separate bounded review-only design using existing provider ownership, UsageTracker, caps and pacing. It will require separate approval before implementation and separate authorization before any production provider run. It will never auto-confirm candidates.
