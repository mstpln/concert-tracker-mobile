# Spotify artwork backfill runbook

This runbook is for the one-time private listening-artwork maintenance operation. It is not an app feature, it does not run automatically, and it must not be used until live Spotify calls and the intended production data access/write scope have been explicitly authorized.

## Supported entrypoint

Use `scripts/spotify-artwork-backfill-production.js` for any real execution. It wraps the tested backfill engine with the project's `UsageTracker`, reads the verified private listening archive plus all verified ListenBrainz incrementals, and uses conditional writes for `listening/spotify-metadata.json`.

Do not create a GitHub Actions workflow for this maintenance operation. The existing automation role is intentionally forbidden from private listening objects.

## Secret handling

Real values stay in the trusted local environment only. Never place them in command-line arguments, GitHub issues, PR text, logs, screenshots or chat.

The production entrypoint reads these environment variables:

- `CF_WORKER_ENDPOINT`
- `CF_WORKER_BROWSER_TOKEN`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `LIVEVAULT_BACKFILL_CONFIRM`

The runner maps the already-authorized local Worker credential to the existing `UsageTracker` client only inside the process. It does not commit or print the credential.

The confirmation value is intentionally fixed in source so an invocation must opt into the maintenance operation explicitly:

`I_UNDERSTAND_THIS_CALLS_SPOTIFY_AND_CAN_WRITE_PRIVATE_LISTENING_METADATA`

## Before any live invocation

1. Confirm PR review and tests are green on the exact commit being used.
2. Confirm the Spotify Development Mode quota is available; do not repeatedly probe while `QUOTA_EXCEEDED` is known to be active.
3. Confirm `.livevault-maintenance/` is ignored by Git.
4. Confirm the private Worker credential and Spotify application credentials exist only in the local secret environment.
5. Confirm the approved request cap. The initial production cap is 25 track requests per invocation and the hard code ceiling is 100.
6. Confirm whether the invocation is provider-only staging or is also authorized to write `listening/spotify-metadata.json`.

## Inventory-only dry run

The separate network-free dry-run tool remains the safest first check because it consumes fictional/local input and cannot call Spotify or production storage:

```text
node scripts/spotify-artwork-backfill-dry-run.js <synthetic-events.json> <synthetic-metadata.json>
```

Production inventory requires reading private production listening data and therefore remains a production action even when no Spotify call or R2 write is made.

## Provider-only controlled invocation

After explicit authorization for private production reads plus live Spotify calls, but without production metadata-write authorization, use the production entrypoint without `--write`:

```text
node scripts/spotify-artwork-backfill-production.js --execute --cap 25
```

Successful provider results are staged in the ignored local checkpoint. They are not written to `listening/spotify-metadata.json` until a later separately authorized `--write` invocation.

## Controlled invocation with metadata synchronization

Only after explicit authorization to write production listening metadata:

```text
node scripts/spotify-artwork-backfill-production.js --execute --write --cap 25
```

The runner rereads the latest metadata and uses ETag/create-only conditions. An ETag conflict fails closed. Staged provider results remain in the local checkpoint so Spotify does not need to be called again merely because synchronization failed.

## Quota and error behavior

- `QUOTA_EXCEEDED`: stop immediately. The current track remains pending.
- ordinary HTTP 429: stop and report the provider rate-limit state; do not loop indefinitely.
- 401/403: stop; do not guess that reconnecting the user account will fix application-credential behavior.
- 404: classify that trusted ID as terminal-not-found so later quota windows do not spend another request on it.
- malformed 200 response: fail closed; do not create metadata.
- Worker ETag conflict: fail closed; reread on the next controlled invocation.
- process interruption: completed provider results already checkpointed remain staged and are not re-requested.

## Source and identity rules

The production source reader verifies SHA-256 and manifest counts for the immutable Spotify archive and every ListenBrainz incremental object before planning work.

Only valid trusted `spotifyTrackId` values are sent to Spotify. No titles, artist names, timestamps or listening payloads are sent to the provider.

When Spotify relinks requested ID `A` to returned ID `B`, metadata stays keyed by `A`. Album/artwork may come from the returned Track object; `B` is retained only as derived provider audit metadata.

## Usage accounting

Every real Spotify token/track provider operation in the supported production entrypoint is guarded through the existing project `UsageTracker` before the request is made. The maintenance cap of 25/100 and 1,000 ms track pacing are additional limits; they do not replace the project-level provider accounting.

The usage state is saved on both successful and failed invocations. No track IDs or credentials are added to `apiUsage.json`.

## Completion

Repeat only by explicit manual invocation across available Spotify quota windows. Completion requires all unique trusted Spotify IDs to be either present in metadata or classified terminal-not-found, with no source-event edits and no unresolved staged records in the checkpoint.

After final verification, the private checkpoint may be archived or deleted locally. It must never be committed.
