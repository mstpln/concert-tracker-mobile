# BANDMARKR Final Automation Audit

Date: 2026-08-14

This document is the current maintenance model for BANDMARKR automation after Data Automation Builds 1-8 and General App Updates 1-5. GitHub `main` remains authoritative. This audit does not authorize provider calls, production workflow runs, scheduler activation, deployment, secret changes, R2 writes, or production-data changes.

## 1. Current automation model

### Scheduled GitHub Actions

| Automation | Schedule | Providers / role | Safety boundary |
| --- | --- | --- | --- |
| Structured concert and release research | Monday, Wednesday, Friday at 01:00 UTC | Ticketmaster, setlist.fm, Spotify, bounded MusicBrainz work | `live-vault-data-writes` concurrency group, DAB7 persisted scheduler lease, UsageTracker caps/pacing, conditional Worker writes |
| Focused web concert research | 1st and 15th at 02:00 UTC | Tavily, Groq, Open-Meteo geocoding | same concurrency group and scheduler lease; no Ticketmaster or Spotify credentials |

There is no production GitHub schedule for listening maintenance. `.github/workflows/listening-maintenance-dry-run.yml` is manual and synthetic only.

### Browser / trusted-local automation

- ListenBrainz remains device-driven: startup due check, six-hour active-use timer, foreground-resume due check, plus manual **Sync now**.
- Spotify listening artwork has a trusted-local DAB8 scheduler gate, but the repository does not install or activate a host scheduler. A real trusted-host schedule remains a separately authorized operational action.
- GAU3 manual-band enrichment is browser-side and bounded. It is not a replacement for a server-side provider scheduler.
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
- Browser, automation, data-maintenance, and read-only smoke credentials remain separate roles. Values must never appear in source, logs, screenshots, docs, PR text, or QA artifacts.
- Whole-document production writes use conditional ETag/create-only semantics. The shared Worker client supports one bounded reread/merge retry for ordinary ownership-aware writes and a strict fail-on-conflict path for lease/safety state.

## 6. Workflow hardening found by this audit

The audit found three manual provider workflows that had drifted from the repository's established workflow-hardening rules:

- `musicbrainz.yml`
- `provider-identity-backfill.yml`
- `setlist-insights-backfill.yml`

They used unsupported `queue: max` concurrency syntax and floating `actions/checkout@v4` / `actions/setup-node@v4` references. The audit removes the unsupported field, uses the same reviewed immutable action SHAs as the scheduled workflows, and expands `scripts/qa-workflows.js` so these rules are checked for all current provider Node workflows and production writers.

No provider cap, schedule, credential scope, data schema, PWA behavior, or production route is changed by that correction.

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
3. Whether GAU3 + DAB5 fully supersede the older future-band identity-automation proposal or whether a separate automatic candidate-acquisition lane is still wanted.
4. Removal of remaining routine maintenance buttons only after their automatic replacements are physically verified.
5. GitHub Actions currently emits a Node.js 20 deprecation warning for the pinned v4 checkout/setup/upload actions and force-runs those action internals on Node.js 24. BANDMARKR's application/QA runtime remains Node.js 20. Updating action majors or the repository runtime is a separate CI/toolchain review and should not be hidden inside this audit.

## 9. Final audit conclusion

The current automation architecture has one coherent safety model: scheduled provider work is narrow and serialized; manual provider work remains explicitly gated; provider calls are bounded and paced; Spotify shares persisted backoff; MusicBrainz is demand-driven; writes are conditional; provider/source ownership remains separated; and private listening work stays outside public QA and ordinary GitHub provider workflows.

The workflow drift listed in section 6 is the only repository-level automation-hardening defect identified by this audit that should be corrected immediately. The items in section 8 are intentionally separate future builds or toolchain follow-ups, not hidden incompleteness in the current automation safety model.
