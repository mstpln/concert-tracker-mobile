# Spotify listening artwork backfill plan

## Purpose

Backfill missing Spotify track, album and artwork metadata for listening records that already contain a trusted Spotify track ID.

This is one-time maintenance outside the BANDMARKR product UI. It never searches by title or artist, never alters source listening history, never replaces trusted Spotify identity, and never runs automatically.

## Current constraints

- Spotify Development Mode returned `429` with `reason: QUOTA_EXCEEDED` during the physical v103 test.
- The removed Development Mode batch track endpoint is not used. Metadata is fetched one trusted ID at a time with `GET /tracks/{id}`.
- The exact Development Mode quota size and reset time are not published, so progress must survive multiple manual quota windows.
- Spotify track relinking may return a different provider ID. The requested trusted ID remains BANDMARKR's identity and metadata key.
- The Worker intentionally allows listening-object access only to browser/legacy roles. The GitHub automation role remains barred from private listening objects.
- Production listening history, metadata and maintenance checkpoints remain private and never enter GitHub or QA fixtures.

## Implemented architecture

### 1. Manual local production entrypoint

Real execution is supported only through `scripts/spotify-artwork-backfill-production.js` from a trusted local environment. The lower-level engine refuses direct production execution so it cannot accidentally bypass the production authorization or `UsageTracker` wrapper.

GitHub Actions is not used for this maintenance operation and no Worker role is broadened.

### 2. Verified private source read

On an explicitly authorized production run the source reader:

1. reads `listening/manifest.json` through the authenticated Worker;
2. accepts only the exact content-addressed Spotify-history and ListenBrainz path formats already used by the Worker;
3. requires the content hash embedded in each path to equal the descriptor SHA-256;
4. downloads and decompresses the immutable base Spotify archive and every ListenBrainz incremental object;
5. verifies each decompressed object's SHA-256, supported payload kind/source and manifest event count;
6. combines the source events only in process memory;
7. extracts unique syntactically valid trusted `spotifyTrackId` values.

Spotify receives only those exact trusted IDs. Titles, artists, timestamps, band IDs and source-event payloads are never sent to Spotify.

### 3. Private local checkpoint

The checkpoint must remain inside ignored `.livevault-maintenance/`. The production entrypoint rejects any checkpoint path outside that directory.

Its allowlisted schema contains only:

- schema version;
- the current logical batch of planned trusted Spotify IDs;
- remaining IDs;
- terminal 404 IDs;
- staged metadata records not yet synchronized;
- aggregate request count;
- stop reason.

Checkpoint records are normalized before production use. Arbitrary top-level or record fields are dropped, and structurally invalid checkpoints fail closed before provider work starts. Credentials, listening timestamps, titles and other source-event payloads are never stored there.

Each successful provider result or terminal 404 is checkpointed before the next track request. A fully completed logical batch with unsynchronized staged records is not expanded into another provider batch until those records are synchronized.

### 4. Spotify authentication and requests

The catalog lookup uses Spotify Client Credentials for public track metadata.

Provider rules:

- request one exact track at a time: `GET /v1/tracks/{trustedId}?market=SE`;
- default maximum: 25 track requests per manual invocation;
- hard logical ceiling: 100;
- minimum 1,000 ms between track requests;
- every token/track provider operation is checked and recorded through the existing project `UsageTracker` before the request;
- `QUOTA_EXCEEDED`: stop immediately and leave the current ID pending;
- ordinary 429: stop and retain any `Retry-After` value for operator feedback; no hidden retry loop;
- 401/403: stop conservatively;
- 404: mark the trusted ID terminal-not-found so later quota windows do not spend another request on it;
- malformed successful response: fail closed;
- no title/artist fallback and no identity guessing.

The maintenance 25/100 limits and 1,000 ms pacing are additional controls; they do not replace `UsageTracker`.

### 5. Track relinking and metadata identity

If trusted requested ID `A` returns provider track ID `B`, the stored metadata remains keyed by `A`:

- `spotifyTrackId: A`
- canonical track URL for `A`
- album ID, album URL and artwork from the returned provider Track object when valid
- `B` retained only as `spotifyProviderResolvedTrackId` plus `spotifyProviderRelinked: true`

A relinked provider ID never creates or replaces listening identity.

### 6. Conditional metadata synchronization

Successful provider records are staged locally before production metadata synchronization.

When `--write` has been separately authorized, the runner:

1. rereads the latest `listening/spotify-metadata.json` and ETag;
2. merges staged records by the trusted requested ID while preserving unrelated records, unknown future production fields and existing per-record fields;
3. writes only with `If-Match` or create-only `If-None-Match: *`;
4. stops on an ETag conflict without an automatic write retry;
5. retains staged provider results in the private checkpoint when synchronization fails, so they do not need to be fetched from Spotify again.

The source archives and listening manifest are never modified by the backfill.

### 7. Separate production authorization gates

The supported production entrypoint has two explicit gates.

The first gate covers all actions unavoidable in a provider-only invocation:

- reading private production listening data;
- making live Spotify backfill calls;
- writing aggregate Spotify provider accounting to production `apiUsage.json` through `UsageTracker`.

The second, additional gate is required only for `--write` and covers writes to `listening/spotify-metadata.json`.

Merging the maintenance code authorizes neither gate.

## Quota-window behavior

For a 25-track logical batch, if Spotify permits 12 requests and then returns `QUOTA_EXCEEDED`:

1. the first 12 successful results have already been checkpointed;
2. the 13th ID remains pending;
3. no automatic polling or retry occurs;
4. on a later manually authorized invocation, the same logical batch resumes from the first still-pending ID;
5. already staged or synchronized IDs are not re-requested.

Provider-only staging deliberately pauses after a full logical batch until those staged records are synchronized, preventing unbounded local accumulation and accidental extra quota use.

## Validation

Synthetic coverage verifies:

- deterministic missing-ID planning and 25/100 caps;
- resumable logical batches with no repeated completed IDs;
- provider-only staged batches do not silently expand;
- relinked metadata remains keyed by the requested trusted ID;
- terminal 404 behavior;
- quota, ordinary 429, 401/403 and malformed-response stop paths;
- per-track checkpoint persistence hooks and pacing;
- strict content-addressed source path, SHA-256 and event-count validation;
- checkpoint allowlisting and path confinement;
- conditional `If-Match` / create-only metadata writes and ETag conflict failure;
- preservation of unrelated and unknown production metadata fields;
- UsageTracker accounting before provider calls;
- separate provider/read/usage-write and listening-metadata-write authorization gates;
- no credentials or trusted track IDs in aggregate command output.

All automated tests use synthetic data only. They do not call live Spotify or production storage.

## Completion criteria

The backfill is complete when:

- every unique trusted source Spotify track ID is represented in metadata or classified terminal 404;
- no staged metadata remains in the private checkpoint;
- no source listening observation was modified;
- no relinked provider ID replaced the trusted identity;
- no completed provider request was repeated because of interruption or synchronization failure;
- final `listening/spotify-metadata.json` passes the existing Worker validator;
- no real listening data or credentials were committed to GitHub.

After final verification, the ignored private checkpoint may be archived or deleted locally.

## Authorization boundary

Creating, reviewing and testing this machinery with synthetic data is approved development work.

The following remain separate production actions and are **not** authorized by the existence or merge of this code:

- private production listening reads for the backfill;
- live Spotify calls with the real BANDMARKR application credentials;
- production `apiUsage.json` writes required for provider accounting;
- production `listening/spotify-metadata.json` writes;
- Worker role, secret or binding changes;
- production GitHub workflow execution.
