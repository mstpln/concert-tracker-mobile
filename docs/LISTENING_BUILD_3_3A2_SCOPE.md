# Listening Build 3.3A2 scope

## Purpose

Build 3.3A2 acquires review candidates for BANDMARKR bands that Build 3.3A1 reports as **Candidate acquisition required**.

The build is candidate acquisition only. It does not redesign Settings, auto-confirm identities, change listening totals, add Toplist, add artwork, or activate any production provider workflow.

## Current foundation

Build 3.3A1 is merged as v94 through PR #73, merge commit `a37453ed01b9b1a69f412fda9bf10449f1fba3af`.

It already provides:

- a deterministic local audit of unresolved Spotify artist identities;
- listening-impact counts based on active canonical listening events;
- explicit review of already-stored candidates;
- manual confirmation and rejection under `band.musicbrainz.spotify`;
- stale-row, stale-candidate and conditional-write protection;
- no provider calls from the browser review UI.

## Proposed acquisition boundary

Candidate acquisition should run through the existing structured research pipeline, not directly from the browser.

The acquisition job may inspect only bands that:

- lack a trusted Spotify artist identity;
- are not already manually confirmed;
- are not protected by a newer manual decision;
- are eligible under the existing MusicBrainz and Spotify provider ownership rules;
- are selected by a bounded explicit run plan.

The job may write only candidate evidence under `band.musicbrainz.spotify.reviewCandidates` and closely related provider-owned acquisition metadata.

It must not set `confirmed`, `manual_confirmed`, or any equivalent trusted status.

## Candidate evidence

Each stored candidate should preserve enough provider evidence for review, including where available:

- Spotify artist ID;
- canonical Spotify artist name;
- exact Spotify artist URL;
- provider genres;
- image metadata suitable for later identity-backed artwork work;
- follower or popularity metadata only when already returned by the approved endpoint and useful for review;
- acquisition timestamp;
- acquisition source and method;
- stable MusicBrainz linkage evidence used to request or validate the candidate;
- a deterministic candidate rank or reason without presenting it as confidence-based auto-approval.

Unknown future fields and existing candidate evidence must be preserved.

## Matching rules

The acquisition process must prefer false negatives over incorrect identity assignments.

Allowed candidate paths should be limited to reviewed deterministic evidence, such as:

1. an existing trusted MusicBrainz artist identity with an exact Spotify relationship;
2. an existing exact Spotify artist ID already present in trusted source evidence;
3. a bounded provider lookup whose returned candidate is stored for manual review only.

Name-only similarity must never create a trusted identity. Ambiguous, same-name, tribute, cover, parody and unrelated artists remain review-only or unresolved.

Rejected candidate IDs must not be silently reintroduced unless there is new provider evidence and the reason is preserved.

## Usage and pacing

All provider calls must continue through `UsageTracker` and the existing Spotify client and configuration.

The build must define and test:

- a hard per-run band cap;
- a hard per-run Spotify-call cap;
- existing daily and monthly quota enforcement;
- provider pacing;
- timeout handling;
- no hidden generic retries;
- deterministic continuation after a bounded run;
- aggregate-only logs with no secrets or personal listening payloads.

The exact caps must be approved during implementation review and must not be weakened to make tests pass.

## Write safety

Before writing `bands.json`, the workflow must:

- reread the latest document;
- locate each band by stable ID;
- preserve user-owned fields, unrelated providers and unknown future fields;
- preserve manual confirmations and manual rejections;
- avoid recreating deleted bands;
- merge only provider-owned Spotify acquisition fields;
- use the existing ETag conditional-write path;
- fail safely on unresolved write conflicts.

Candidate replacement requires an explicit rule. The default should be additive deduplication by Spotify artist ID while preserving previously reviewed evidence.

## Review UI

Build 3.3A2 should reuse the v94 Settings → Review section.

After a later data refresh, rows with newly stored candidates become reviewable through the existing explicit actions:

- **Use this artist**;
- **None of these**;
- **Decide later**.

No automatic confirmation, bulk-confirm action, search link, provider call, or Settings redesign is included.

## QA and validation

Automated validation must use only synthetic bands, synthetic provider responses and the QA fake backend.

Required coverage includes:

- trusted MusicBrainz relationship returns one candidate;
- ambiguous relationship returns multiple review candidates without confirmation;
- no result leaves the band unresolved;
- same-name and tribute candidates remain untrusted;
- rejected candidates are not reintroduced without new evidence;
- existing manual decisions are preserved;
- deleted bands are not recreated;
- unrelated and unknown fields survive;
- per-run and provider caps are enforced;
- pacing and attempted-call accounting remain correct;
- timeout, malformed response, quota exhaustion and write conflict fail safely;
- rerunning is idempotent and creates no duplicate candidates;
- no production Worker, R2 data or live provider is used by QA.

## Production boundary

Merging implementation does not authorize a production acquisition run.

A real provider run requires separate explicit authorization after:

- implementation PR review;
- exact-head CI success;
- final cap and call-volume review;
- confirmation that the production workflow scope is candidate acquisition only.

Production output must remain review candidates. The user must still confirm every identity manually.

## Non-goals

Build 3.3A2 does not include:

- automatic Spotify artist confirmation;
- listening-history remapping;
- canonical-listen changes;
- visible listening-total changes;
- Toplist or global Top Tracks;
- trusted track or album links;
- artwork rendering;
- recording grouping;
- selected-year genre correction;
- Settings information-architecture or visual redesign;
- production execution as part of merge.

## Recommended implementation sequence

1. Audit the existing Spotify, MusicBrainz, UsageTracker and research orchestration paths.
2. Define the bounded acquisition plan and provider-owned candidate schema.
3. Add pure candidate normalization and merge helpers with unit tests.
4. Add bounded orchestration with synthetic provider fixtures.
5. Add conditional `bands.json` write integration through the QA fake backend.
6. Verify that the existing v94 review UI consumes acquired candidates without UI expansion.
7. Update continuity documents and generated build facts only when implementation changes them.
8. Open a separate implementation PR. Do not merge or run production acquisition without explicit authorization.
