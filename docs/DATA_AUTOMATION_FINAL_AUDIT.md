# BANDMARKR Final Automation Audit

Date: 2026-08-16

This document is the current maintenance model for BANDMARKR automation after Data Automation Builds 1-8 and General App Updates 1-5. GitHub `main` remains authoritative. This audit does not authorize provider calls, production workflow runs, scheduler activation, deployment, secret changes, R2 writes, or production-data changes.

## 1. Current automation model

### Scheduled GitHub Actions

| Automation | Schedule | Providers / role | Safety boundary |
| --- | --- | --- | --- |
| Structured concert, release and missing artist-image research | Monday, Wednesday, Friday at 01:00 UTC | Ticketmaster, setlist.fm, Spotify, bounded MusicBrainz work | `live-vault-data-writes` concurrency group, DAB7 persisted scheduler lease, UsageTracker caps/pacing, conditional Worker writes; image work is last and capped at ten bands |
| Focused web concert research | 1st and 15th at 02:00 UTC | Tavily, Groq, Open-Meteo geocoding | same concurrency group and scheduler lease; no Ticketmaster or Spotify credentials |

There is no production GitHub schedule for listening maintenance. `.github/workflows/listening-maintenance-dry-run.yml` is manual and synthetic only.

### Browser / trusted-local automation

- ListenBrainz remains device-driven: startup due check, six-hour active-use timer, foreground-resume due check, plus manual **Sync now**.
- Spotify listening artwork has a trusted-local DAB8 scheduler gate, but the repository does not install or activate a host scheduler. A real trusted-host schedule remains a separately authorized operational action.
- GAU3 manual-band enrichment remains browser-side and bounded. v134 adds a separate exact-ID missing-image lane to the existing structured server scheduler without adding a schedule.
- GAU5 listening preparation is local, chunked and resumable. It never activates cleaned totals automatically.

## 2. Manual production/provider workflows

The following remain deliberately manual and main-only where they can affect production state:

- MusicBrainz artist identity backfill.
- Provider artist identity backfill.
- Spotify candidate acquisition.
- Live-performance rarity/setlist-insights backfill.
- Approved provider-identity application.
- Release-feed cleanup.
- Production smoke remains manual and read-only.

Provider-using manual workflows share the production write serialization boundary where applicable. Provider workflows use the DAB7 scheduler lease so an independently started provider process cannot overlap another supported provider process from the same observed `apiUsage.json` state.

## 3. Provider limits and pacing

Current project safety settings are centralized in `scripts/lib/config.js` and enforced by `scripts/lib/usageTracker.js` or the provider-specific safety layer.

| Provider | Current BANDMARKR envelope |
| --- | --- |
| Ticketmaster | 650/run; daily backstop at half of the configured 5,000/day allowance; at least 600 ms between request starts |
| Tavily | 180/run; 900/month project cap; at least 500 ms between request starts |
| Groq | 250/run, 800/day; 150,000 safe tokens/day; 6,000 safe tokens/minute; at least 2,500 ms between requests |
| setlist.fm | 200/run, 1,200/day; at least 600 ms between request starts |
| Spotify | defensive 4,000/run and 6,000/day UsageTracker ceilings for the shared Node provider layer, plus DAB6 persisted rate/quota circuit; individual maintenance paths may impose stricter limits |
| MusicBrainz | 5/run in scheduled structured research; at least 2,000 ms between requests; demand-driven scheduling rather than fixed full-catalogue polling |
| Open-Meteo geocoding | scheduled fallback only; at least 150 ms between request starts and exact city/country fail-closed acceptance |
| ListenBrainz browser sync | pages of 100, at most 50 pages per sync; six-hour due gate; provider 429 reset information is surfaced to the user |

Changing any of these limits or pacing rules is outside this audit and requires a separate reviewed change.

## 4. Retry and failure model

- Node-side provider requests receive the shared 30-second default timeout unless a provider supplies its own bounded abort signal.
- Provider failures do not create guessed data.
- Ticketmaster, Tavily, Groq and setlist.fm attempts are counted at the point where the provider would count the request.
- DAB4 distinguishes definitive setlist/Spotify no-match outcomes from transient provider failures; transient failures remain retryable and do not advance success markers.
- DAB5 makes scheduled MusicBrainz work demand-driven and fair while retaining the five-call run cap and two-second pacing.
- DAB6 persists Spotify rate-limit/quota state across Node invocations. A usable `Retry-After` is honored with a safety margin; otherwise a conservative rate-limit block is used. Explicit quota exhaustion opens the project cooldown rather than triggering repeated probes.
- DAB7 serializes independent provider processes with a fail-closed persisted lease. Malformed, active, conflicting, or overlong lease state prevents provider work.
- Persistence, ETag/concurrency, integrity, authorization, or ownership failures remain global stops where continuing could make data unsafe.

## 5. Ownership and persistence boundaries

- `bands.json`, `concerts.json`, `news.json`, and `apiUsage.json` remain core Worker/R2 documents.
- Listening source observations are immutable provider facts. Enrichment never rewrites Spotify or ListenBrainz source observations.
- `listening/track-identities.json` is derived BANDMARKR identity state; reviewed decisions and unknown fields are preserved.
- `listening/musicbrainz-catalogue.json` is rebuildable MusicBrainz-derived catalogue cache, not source listening data.
- `listening/spotify-metadata.json` is Spotify-owned presentation metadata, separate from recording identity and source observations.
- `listening/band-activity.json` is a narrow browser-produced scheduling aggregate containing stable band IDs and exclusive activity counts only. Automation has GET-only access to this object and no access to raw listening history.
- The band-activity schema is `kind: livevault-listening-band-activity`, `schemaVersion: 1`, aggregate `generatedAt`, `catalogueFingerprint`, `mappedListenCount`, `sourceLastListenedAt`, and a `records` object keyed by stable band ID. Each record repeats only its band ID and the four exclusive `fourteenDays`, `threeMonths`, `oneYear`, and `allTime` buckets; a bucket contains only `listenCount` and `lastListenedAt`. Zero counts require null timestamps, bucket totals must reconcile to the aggregate total, and the newest bucket timestamp must reconcile to `sourceLastListenedAt`.
- Browser, automation, data-maintenance, and read-only smoke credentials remain separate roles. Values must never appear in source, logs, screenshots, docs, PR text, or QA artifacts.
- Whole-document production writes use conditional ETag/create-only semantics. The shared Worker client supports one bounded reread/merge retry for ordinary ownership-aware writes and a strict fail-on-conflict path for lease/safety state.

## 6. Workflow hardening and Node toolchain

The audit found three manual provider workflows that had drifted from the repository's established workflow-hardening rules:

- `musicbrainz.yml`
- `provider-identity-backfill.yml`
- `setlist-insights-backfill.yml`

They used unsupported `queue: max` concurrency syntax and floating action references. The correction removes the unsupported field and standardizes current Node-running workflows on reviewed immutable action SHAs.

The related Node toolchain follow-up is also resolved in this branch. BANDMARKR project scripts now target Node 22 consistently in `package.json`, `package-lock.json`, generated build state, PR QA, Full PWA QA, production smoke, and current provider workflows. Checkout, setup-node, and upload-artifact references used by the updated workflows are pinned to reviewed immutable current commits rather than floating tags. `scripts/qa-workflows.js` enforces Node 22 and the reviewed checkout/setup pins for PR QA, Full PWA QA, production smoke, and current provider Node workflows.

This is a CI/toolchain correction only. It does not change provider caps, schedules, pacing, credential scope, data schema, PWA behavior, Worker routes, production data, or application version. `APP_VERSION` and `CACHE_NAME_LITERAL` remain synchronized at v121.

## 7. Retired and intentionally inactive paths

- The Spotify-first historical listening production/bulk entrypoints remain importable for regression tests but refuse direct CLI execution and point operators to the C4 catalogue-first path.
- Listening-maintenance GitHub scheduling remains inactive; the existing workflow is synthetic dry-run only.
- DAB8 provides a trusted-local artwork scheduler gate but intentionally does not install or activate a host scheduler.
- Destructive release-feed cleanup remains manual only.
- QA and production smoke remain non-scheduled.

## 8. Deliberately outstanding architecture and follow-up risks

These are separate future product/architecture decisions and are not silently implemented by the final audit:

1. Server-side scheduled ListenBrainz ingestion / listening maintenance without the PWA being open.
2. Scheduled weather-data cutover from the current browser weather fetch path.
3. The first production artist-image rollout remains separately authorized and must validate the aggregate boundary and ten-band result before any later run processes the remaining backlog; ambiguous identities remain user-reviewed.
4. Removal of remaining routine maintenance buttons only after their automatic replacements are physically verified.

The former GitHub Actions Node.js 20 deprecation/toolchain warning is no longer an outstanding architecture item in this branch: project scripts and updated workflows are aligned on Node 22 with reviewed immutable action pins. This change does not authorize running production smoke or any provider-writing workflow.

## 9. Final audit conclusion

The current automation architecture has one coherent safety model: scheduled provider work is narrow and serialized; manual provider work remains explicitly gated; provider calls are bounded and paced; Spotify shares persisted backoff; MusicBrainz is demand-driven; writes are conditional; provider/source ownership remains separated; raw private listening stays outside public QA and GitHub provider workflows, and only the validated aggregate-only activity boundary is readable by scheduled automation.

The workflow drift and Node toolchain inconsistency identified during this audit are corrected in the open audit PR. The items remaining in section 8 are intentionally separate future product/architecture decisions, not hidden incompleteness in the current automation safety model.
