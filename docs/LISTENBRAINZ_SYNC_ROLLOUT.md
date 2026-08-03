# ListenBrainz continuous sync rollout

## Scope

v80 adds an optional browser-side ListenBrainz connection for new listening events after the private Spotify-history baseline.

- The ListenBrainz user token is stored only in the browser's local storage.
- The browser validates the token directly with ListenBrainz.
- Sync requests only events newer than the latest locally stored listening event.
- Each run is bounded to 5,000 returned listens and saves nothing when that bound is exceeded.
- Exact timestamp, artist and track fingerprints prevent overlap duplicates with the Spotify archive.
- MusicBrainz recording, release and artist identifiers are retained when ListenBrainz supplies them.
- Missing track duration remains unknown; Live Vault does not invent listening time.

## Private storage

The historical Spotify archive remains unchanged:

- `listening/spotify-history/<sha256>.json.gz`

New ListenBrainz events are stored as immutable, content-addressed monthly chunks:

- `listening/listenbrainz/YYYY-MM/<sha256>.json.gz`

`listening/manifest.json` keeps the existing Spotify archive entry and adds an ordered `incrementals` array. A chunk is written before the manifest is conditionally updated. Existing chunks are never overwritten or automatically deleted.

## Deployment

The v80 pull request changes `worker.js`, so merging it to `main` after explicit approval triggers the connected Cloudflare Workers Build automatically. No manual Worker copy or deploy command is required.

Automatic deployment still does not authorize a real ListenBrainz connection, R2 migration, secret change, production workflow or deletion.

## Production activation

After the v80 app and Worker are deployed:

1. Confirm the Cloudflare build succeeded.
2. Open Live Vault Settings.
3. Enter the private ListenBrainz user token.
4. The app validates the token and performs the first incremental sync.
5. Confirm the stored listen count and latest date advance as expected.
6. Reload the app and confirm the new listens restore from the private vault.

The token must never be shared in chat, committed to GitHub, added to Cloudflare build variables or placed in screenshots.

## Rollback

- Disconnect ListenBrainz in Settings to stop future syncs on that device.
- A Worker rollback restores the previous route behavior but does not delete already written R2 chunks.
- The historical Spotify archive remains the recovery baseline.
- Incremental objects are immutable and can be ignored by restoring a previous manifest version.
