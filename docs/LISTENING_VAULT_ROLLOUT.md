# Listening Vault v78 rollout

This rollout is intentionally staged. Merging the application code does not authorize Worker deployment or production listening-history migration.

## Before production actions

1. Confirm PR QA passed on synthetic fixtures.
2. Merge only after the explicit instruction `Merge it`.
3. Refresh the installed PWA and verify v78 is active.
4. Deploy the merged `worker.js` manually to the existing Cloudflare Worker only after separate production authorization.
5. Do not change Worker bindings, tokens or routes beyond deploying the reviewed source.

## Listening Settings UI

Normal Settings shows one Listening history component only. The large permanent Cloudflare backup/restore/download panel is intentionally not shown. Backup, migration and recovery functions remain available to controlled tooling without adding permanent UI noise.

The Settings injector is race-safe and removes any duplicate Listening history wrappers left in the current render. Existing IndexedDB history is not changed by this UI correction.

## First private backup

The first production archive upload is a controlled migration step, not a permanent user-facing Settings action.

1. Keep the existing local IndexedDB history intact.
2. Retain a private copy of the sanitized source archive before migration.
3. Validate the source event count and date range without printing artist or track content.
4. Upload the immutable content-addressed archive first.
5. Update `listening/manifest.json` only after the archive is durable.
6. Verify the manifest count, date range and SHA-256 against the source.
7. Do not remove or re-import local history during verification.

The app creates an immutable content-addressed archive first, then conditionally updates `listening/manifest.json`. A failed manifest update leaves the prior manifest authoritative.

## Restore verification

Perform this only after separate approval because it reads production R2 listening data.

1. Use a separate test browser profile or device with no local listening history.
2. Connect it to the existing Worker with the browser credential.
3. Let the empty-device bootstrap restore from Cloudflare.
4. Verify the event count, first date, last date and listening-stat parity without exposing artist or track content in screenshots or logs.
5. Keep the original device unchanged until verification succeeds.

## Rollback

- If Worker deployment fails, redeploy the previous merged Worker source.
- If archive upload fails, the local IndexedDB history remains unchanged.
- If manifest update fails, the previous manifest and archive remain authoritative.
- If restore fails, the existing local copy is preserved unless a complete verified replacement was committed.
- Do not delete immutable archive objects during the initial rollout.

## Production limitations

- No ListenBrainz synchronization is included.
- No automated background upload is included.
- No remote deletion endpoint is included.
- Album artwork repair and metadata sharing are deferred.
- Real archive content must never enter GitHub, public artifacts, QA fixtures, workflow logs or screenshots.
