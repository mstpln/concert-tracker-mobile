# Listening Vault v78 rollout

This rollout is intentionally staged. Merging the application code does not authorize Worker deployment or production listening-history migration.

## Before production actions

1. Confirm PR QA passed on synthetic fixtures.
2. Merge only after the explicit instruction `Merge it`.
3. Refresh the installed PWA and verify v78 is active.
4. Deploy the merged `worker.js` manually to the existing Cloudflare Worker only after separate production authorization.
5. Do not change Worker bindings, tokens or routes beyond deploying the reviewed source.

## First private backup

1. Keep the existing local IndexedDB history intact.
2. Open Settings → Data → Listening history.
3. Use **Download backup** and retain the resulting `.json.gz` file privately.
4. Use **Back up to Cloudflare**.
5. Verify the displayed event count and date range match the local archive.
6. Do not remove or re-import local history during this verification.

The app creates an immutable content-addressed archive first, then conditionally updates `listening/manifest.json`. A failed manifest update leaves the prior manifest authoritative.

## Restore verification

Perform this only after separate approval because it reads production R2 listening data.

1. Use a separate test browser profile or device with no local listening history.
2. Connect it to the existing Worker with the browser credential.
3. Let the empty-device bootstrap restore, or use **Restore from Cloudflare**.
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
