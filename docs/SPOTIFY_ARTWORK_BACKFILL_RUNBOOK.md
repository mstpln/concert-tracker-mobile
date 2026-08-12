# Spotify album artwork maintenance runbook

This runbook is for the private listening-artwork maintenance operation used by v113. It is not an app feature, it does not run automatically, and it must not be used until the intended private-data/provider/write scope has been explicitly authorized.

## Supported entrypoint

Use `scripts/spotify-album-artwork-production.js` for any real execution.

It reads the verified private listening source, groups unresolved listens conservatively by trusted local BANDMARKR band identity plus normalized release title, chooses at most one exact trusted Spotify Track ID per unresolved safe album group, obtains Spotify album identity/artwork from that exact-track response, and conditionally writes only the representative track's metadata to `listening/spotify-metadata.json`.

Sibling listens reuse compatible album artwork in memory. Source listening observations are never rewritten. MusicBrainz and ListenBrainz are not used by this artwork runner.

Do not create or use a GitHub Actions workflow for this production maintenance operation. Private listening reads require the browser credential and must stay in a trusted local environment. The repository automation role is intentionally not the execution path for private listening maintenance.

## Secret handling

Real values stay in the trusted local environment only. Never place them in command-line arguments, GitHub issues, PR text, logs, screenshots or chat.

The production entrypoint reads these environment variables:

- `CF_WORKER_ENDPOINT`
- `CF_WORKER_BROWSER_TOKEN`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `LIVEVAULT_BACKFILL_CONFIRM`
- `LIVEVAULT_BACKFILL_WRITE_CONFIRM`

Private production listening reads, live Spotify calls, and required provider-usage accounting writes require this confirmation value:

`I_AUTHORIZE_PRIVATE_LISTENING_READS_LIVE_SPOTIFY_CALLS_AND_PROVIDER_USAGE_WRITES`

Production writes to `listening/spotify-metadata.json` additionally require:

`I_AUTHORIZE_PRODUCTION_SPOTIFY_METADATA_WRITES`

The runner also requires both `--execute` and `--write`. There is no provider-only staging mode in the v113 album-oriented entrypoint; each resolved representative record is durably checkpointed through a conditional metadata write before another album group is processed.

## Before any live invocation

1. Confirm the exact merged `main` commit and that the relevant PR validation was green.
2. Confirm Spotify Development Mode quota is available; do not repeatedly probe while quota exhaustion is known to be active.
3. Confirm the Worker browser credential and Spotify application credentials exist only in the trusted local environment.
4. Confirm the approved album-group cap for this invocation.
5. Confirm this invocation is separately authorized to read private listening data, call Spotify, update provider-usage accounting and write production listening metadata.
6. Confirm no other production data-writing maintenance is running concurrently.

## Controlled production invocation

For the first production proof, use a deliberately small cap:

```text
node scripts/spotify-album-artwork-production.js --execute --write --cap 3 --delay-ms 1000 --market SE
```

The runner enforces a minimum 1,000 ms delay between album-group track requests. The default cap is 25 album groups and the code hard ceiling is 100, but a smaller cap should be used for controlled tests.

Each invocation is manual and separately authorized. Do not automatically repeat a failed or completed invocation.

## What the runner does

Before provider work it:

- reads and validates the private listening source;
- reads the current `bands.json` and `listening/spotify-metadata.json`;
- creates the conservative album-oriented plan;
- limits provider work to the approved cap;
- rechecks current band ownership before provider work and before each persistence step.

For each selected safe unresolved album group it:

1. uses one exact trusted Spotify Track ID as the representative provider seed;
2. records the provider operation through `UsageTracker` before the request;
3. requests the exact Spotify track at the configured market;
4. requires a usable Spotify Album ID and HTTPS artwork URL before creating metadata;
5. refuses a provider album identity that conflicts with already-known album identity;
6. preserves unknown future metadata fields and provider ownership boundaries;
7. conditionally persists the representative record to `listening/spotify-metadata.json`;
8. rereads metadata after persistence to confirm the new ETag before continuing.

No sibling Track IDs receive fabricated provider records.

## Quota and error behavior

- Provider-usage guard refusal: stop before another Spotify request.
- Provider-usage accounting save failure: stop before the corresponding provider request.
- Spotify 429/rate-limit result: stop safely according to the existing exact-track request behavior; do not loop automatically.
- Spotify quota exhaustion: stop; do not repeatedly probe.
- 401/403 or other provider errors: stop safely; do not guess or silently retry.
- Exact 404/not found: leave that album group unresolved for this invocation without writing guessed metadata.
- Successful response without usable album artwork: write nothing for that group.
- Conflicting known/provider album identity: stop safely before the unsafe metadata update.
- `bands.json` changed after planning: stop safely and reload before continuing.
- Worker conditional-write or confirmation failure: stop safely; do not overwrite stale production metadata.

## Source and identity rules

The source reader verifies the private archive/incrementals before planning work. Only valid exact trusted Spotify Track IDs are sent to Spotify. Listening payloads, timestamps, artist search text and album search text are not sent to Spotify by this runner.

Album grouping is conservative:

- a current trusted local BANDMARKR band is required;
- a non-empty release title is required;
- edition qualifiers remain identity-significant;
- ambiguous band ownership fails closed;
- conflicting existing Spotify Album IDs fail closed;
- the same exact Spotify Track ID crossing multiple album groups fails closed.

## Usage accounting

Every real Spotify token/track provider operation in this entrypoint is guarded through the existing project `UsageTracker` before the request is made. The album-group cap and 1,000 ms pacing are additional limits; they do not replace project-level provider accounting.

Aggregate provider usage may therefore change even if no artwork record is ultimately written. Track IDs, credentials and private listening payloads are not added to `apiUsage.json`.

## Verification after a controlled run

Record the aggregate summary returned by the runner:

- source events;
- safe album groups;
- ambiguous album groups;
- unsafe events;
- album groups already reusable without a provider call;
- provider album groups planned and attempted;
- provider album groups resolved;
- groups with no usable artwork;
- representative records added;
- MusicBrainz calls (must be 0);
- ListenBrainz calls (must be 0).

Then verify the affected artwork in the production app on the relevant listening surfaces. Do not expose private track/listening details in public logs or PR text.

## Scheduling boundary

Do not add scheduling until the controlled production proof has succeeded and the desired cadence has been explicitly approved. Any future scheduled design must preserve the private-listening credential boundary rather than moving private reads into a generic GitHub automation role by assumption.
