# DAB8 — trusted-local Spotify album artwork scheduler

## Status

DAB8 adds a trusted-local scheduler gate around the existing album-oriented Spotify listening-artwork maintenance path. It does not install, enable or run a production schedule by itself.

Private listening objects continue to require the browser credential. DAB8 therefore does not move artwork maintenance into GitHub Actions and does not broaden the Worker automation role.

## Scheduled command

The supported scheduler entrypoint is:

```text
node scripts/spotify-album-artwork-scheduler.js --execute-scheduled
```

The scheduled safety envelope is intentionally smaller and slower than the lower-level manual runner:

- default and minimum due interval: **4 hours**;
- scheduled album-group cap: **5** per admitted run;
- Spotify track-request pacing: at least **5,000 ms**;
- rolling provider ceiling: **30 Spotify track lookups in any preceding 24-hour window**;
- Spotify market: `SE` by default;
- private schedule state: exactly `.livevault-maintenance/spotify-album-artwork-schedule.json`.

The manual album runner retains its separate 100-group hard ceiling and 1,000-ms minimum pacing. DAB8 never exposes those larger/faster manual limits to scheduled execution. A scheduled invocation may lower its five-group cap or lengthen its interval/pacing, but cannot exceed the scheduled envelope.

The schedule-state path is intentionally fixed so independent host commands cannot manufacture separate allowances.

## Authorization boundary

Scheduled production execution requires the dedicated environment confirmation:

```text
LIVEVAULT_ARTWORK_SCHEDULE_CONFIRM=I_AUTHORIZE_SCHEDULED_PRIVATE_LISTENING_READS_LIVE_SPOTIFY_CALLS_PROVIDER_USAGE_AND_METADATA_WRITES
```

The trusted local environment must also provide the existing private runtime secrets:

- `CF_WORKER_ENDPOINT`
- `CF_WORKER_BROWSER_TOKEN`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

DAB8 translates its dedicated authorization into the existing album-maintenance execution/write gates only for the admitted scheduled child invocation. The manual production entrypoint and its authorization contract remain unchanged.

Merging DAB8 does not authorize setting this confirmation, installing or activating a host scheduler, performing private production reads, calling Spotify, writing provider usage or artwork metadata, running a production workflow, deploying, or modifying production data.

## Schedule state and due gate

The schedule marker is local-only under the already ignored `.livevault-maintenance/` directory. Schema v1 tracks the admitted/completed outcome, whether unresolved provider work remained, a caught-up listening-manifest fingerprint, and rolling provider reservations. Unknown future fields are preserved. Malformed JSON, unsupported schema, invalid timestamps/outcomes/reservations, or an alternate state path fail closed.

A fresh wake performs no lease acquisition and no provider/full-history work. The ordinary due gate is based on `lastAttemptAt`, so an admitted failure waits until the next four-hour opportunity rather than hot-looping.

When a previous run proved the artwork plan fully caught up, DAB8 stores the source listening-manifest fingerprint. At a later due wake it may read only that private manifest and, if the fingerprint is unchanged, record an `idle_unchanged` maintenance checkpoint without acquiring the provider lease, reading full listening history, or calling Spotify. A changed fingerprint falls through to normal provider admission.

## Provider admission and rolling budget

A due provider candidate configures the existing Worker/UsageTracker environment and acquires the DAB7 persisted cross-environment provider lease. Under that lease DAB8 rereads local schedule state and rechecks due status, preventing overlapping local wakes from both admitting the same opportunity.

A busy DAB7 lease returns a safe `deferred` result and does not advance `lastAttemptAt`. Before provider work, DAB8 calculates reservations strictly inside the preceding rolling 24-hour window. At most 30 Spotify track lookups may be reserved in that window. If no budget remains, the run defers without provider work.

For an admitted run, DAB8 reserves up to the smaller of the five-group scheduled cap and remaining rolling budget, then durably writes `lastAttemptAt` before full private-history/provider work. After a successful child run, the reservation is reconciled down to the actual number of attempted Spotify track lookups. A failed admitted run keeps its conservative reservation and records failure.

The existing album production runner normally acquires DAB7 itself. DAB8 invokes it inside the already-held scheduler lease and bypasses only the redundant nested acquisition, so there is one lease owner across admission and provider work.

## Terminal album outcomes

Permanent exact-track outcomes are durably checkpointed in `listening/spotify-metadata.json`:

- `exact_track_not_found`;
- `exact_track_has_no_usable_artwork`.

A suppression is bound to the stable album-group key and exact representative Spotify Track ID. Valid suppressions are excluded from later provider plans, preventing the four-hour scheduler from repeatedly spending calls on the same terminal result. Unknown metadata fields are preserved. A later successful exact representative record clears the matching suppression.

Transient/rate/quota/provider failures are not converted into terminal suppressions. They continue through the existing DAB6 Spotify circuit and fail-safe behavior.

## Existing safety layers retained

The lower-level album production runner remains authoritative for actual artwork work. DAB8 retains:

- v114 ordering by latest valid listen, listen count, distinct trusted Spotify Track IDs and stable group key;
- removal of reusable and terminally suppressed groups before provider selection;
- conservative album grouping and ambiguity quarantine;
- exact trusted Spotify Track ID provider seeds only;
- UsageTracker accounting;
- the DAB6 shared persisted Spotify circuit;
- the DAB7 cross-environment provider lease;
- conditional `listening/spotify-metadata.json` writes and ETag confirmation;
- current-band ownership checks before provider work and persistence;
- provider ownership boundaries and unknown-field preservation;
- immutable source listening observations;
- zero MusicBrainz and ListenBrainz artwork calls;
- aggregate-only command summaries.

## Host wake-up model

DAB8 separates repository behavior from host scheduling. A trusted machine may wake the command regularly; the command itself enforces the four-hour minimum and rolling 30-lookups-per-24-hours ceiling.

The repository does not include scheduler installation/activation, a credential file, or an OS-specific service definition. Host configuration is a separate production action.

## Validation

Automated QA uses synthetic fixtures only. Coverage verifies the four-hour/five-group/five-second envelope, rolling 24-hour reservation budget, fixed state path, fail-closed state validation, zero-work fresh wakes, caught-up manifest fast path, busy-lease deferral, due recheck under lease, reservation-before-provider-work, reconciliation to actual lookups, authorization bridging, and preservation of future local fields.

Album-runner tests cover conservative grouping, exact-track-only provider seeds, existing-artwork reuse, ownership changes, conditional persistence, and production authorization. Terminal suppression checkpointing is part of the same metadata path and must remain covered by focused synthetic tests.

No automated DAB8 test reads production listening data, calls live Spotify, writes production R2/Worker data, installs a scheduler, deploys, or runs a production workflow.

## Version

DAB8 changes trusted-local Node operational plumbing rather than the browser PWA shell. `APP_VERSION`, `CACHE_NAME_LITERAL` and deterministic build-state facts remain synchronized at **v115**.
