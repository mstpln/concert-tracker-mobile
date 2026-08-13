# DAB8 — trusted-local Spotify album artwork scheduler

## Status

DAB8 adds the scheduler gate for the existing album-oriented Spotify listening-artwork maintenance path. It does not install, enable or run a production schedule by itself.

The execution boundary remains trusted local. Private listening objects require the browser credential, so DAB8 does not create a GitHub Actions workflow and does not broaden the Worker automation role.

## Goal

The v114 album-artwork priority is intentionally cumulative rather than a bulk-backfill objective. DAB8 turns that priority into one bounded daily maintenance opportunity while preserving the existing provider and private-data safety layers.

A trusted local scheduler may wake the DAB8 command more frequently than once per day. The command itself keeps a private local due marker and performs production work only when at least 24 hours have elapsed since the previous attempted scheduled run.

## Scheduled command

The supported scheduler entrypoint is:

```text
node scripts/spotify-album-artwork-scheduler.js --execute-scheduled
```

Defaults:

- due interval: 24 hours;
- Spotify album-group cap: 25;
- Spotify track-request pacing: at least 1,000 ms;
- Spotify market: `SE`;
- private due state: `.livevault-maintenance/spotify-album-artwork-schedule.json`.

The scheduler wrapper does not install cron, launchd, systemd, Task Scheduler or another host scheduler. Host installation and activation are separate operational actions because the repository cannot safely assume which trusted machine will own the private credentials.

## Authorization boundary

Scheduled production execution requires the dedicated environment confirmation:

```text
LIVEVAULT_ARTWORK_SCHEDULE_CONFIRM=I_AUTHORIZE_SCHEDULED_PRIVATE_LISTENING_READS_LIVE_SPOTIFY_CALLS_PROVIDER_USAGE_AND_METADATA_WRITES
```

The existing private runtime secrets are still required in the trusted local environment:

- `CF_WORKER_ENDPOINT`
- `CF_WORKER_BROWSER_TOKEN`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

The DAB8 wrapper translates the dedicated schedule authorization into the existing album-maintenance execution and metadata-write gates only for the scheduled child invocation. The existing manual production entrypoint and its manual authorization contract remain unchanged.

Merging DAB8 does not authorize setting the schedule confirmation, installing a host scheduler, performing a private production read, calling Spotify, writing provider usage, writing listening metadata or deploying anything. Those remain separate production actions.

## Due-state contract

The schedule marker is local-only and remains under the already ignored `.livevault-maintenance/` directory. It is never stored in GitHub, R2 or a public QA artifact.

Schema v1 contains:

- `schemaVersion`;
- `lastAttemptAt` when a due scheduled invocation was admitted;
- `lastCompletedAt` after a successful admitted invocation;
- `lastOutcome` as `completed` or `failed`.

Unknown future fields are preserved. Malformed JSON, an unsupported schema, invalid timestamps or an unknown outcome fail closed before production work.

The due gate is based on `lastAttemptAt`, not only successful completion. This prevents a host wake loop from repeatedly probing a failing provider or retrying a failed maintenance run every few minutes. A failed admitted invocation therefore waits for the next daily opportunity. The DAB6 persisted Spotify circuit remains authoritative for provider cooldowns, and the DAB7 persisted scheduler lease remains authoritative for cross-environment exclusion.

The local state is written before the existing production runner starts. If that local checkpoint cannot be persisted, provider work does not start.

## Existing safety layers retained

After the DAB8 due and authorization gates pass, the existing `scripts/spotify-album-artwork-production.js` path remains authoritative. DAB8 does not reimplement album grouping or provider behavior.

The scheduled run therefore retains:

- v114 ordering by latest valid listen, listen count, distinct trusted Spotify Track IDs and stable group key;
- removal of already reusable album groups before the provider cap;
- conservative album grouping and ambiguity quarantine;
- exact trusted Spotify Track ID provider seeds only;
- at most 25 album groups by default and a hard existing ceiling of 100;
- at least 1,000 ms between album-group track requests;
- UsageTracker accounting before provider requests;
- the DAB6 shared persisted Spotify circuit;
- the DAB7 shared cross-environment provider lease;
- conditional `listening/spotify-metadata.json` writes and ETag confirmation;
- current-band ownership checks before provider work and persistence;
- immutable source listening observations;
- zero MusicBrainz and ListenBrainz artwork calls;
- aggregate-only command summaries.

## Host wake-up model

DAB8 deliberately separates repository behavior from host scheduling. A trusted machine can invoke the command on a regular wake-up cadence, for example hourly or daily, and the 24-hour due gate prevents more than one admitted scheduled attempt per interval.

The host scheduler must provide the required private environment without putting secrets into source control or command-line arguments. DAB8 does not include a credential file, scheduler installation script or OS-specific service definition because those are machine-specific production configuration.

## Validation

Automated tests use injected synthetic runners and state only. They verify:

- the 24-hour default and exact due boundary;
- 25-group default cap and existing 100-group hard ceiling;
- at-least-1,000-ms pacing;
- private state-path confinement;
- malformed schedule state fail-closed behavior;
- zero production work while fresh;
- dedicated scheduled authorization before runner invocation;
- correct bridging into the existing production execution/write gates;
- unknown local state-field preservation;
- failure checkpointing that prevents hot-loop retries.

No automated DAB8 test reads private production listening data, calls Spotify, writes production R2/Worker data, installs a scheduler, deploys or runs a production workflow.

## Version

DAB8 adds Node/trusted-local operational scheduling around the existing v114 album-maintenance path. It does not change the browser PWA shell or service worker. `APP_VERSION`, `CACHE_NAME_LITERAL` and deterministic build-state facts therefore remain synchronized at v115.
