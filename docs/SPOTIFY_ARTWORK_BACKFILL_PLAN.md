# Spotify listening artwork backfill plan

## Purpose

Backfill missing Spotify track, album and artwork metadata for listening records that already contain a trusted Spotify track ID.

This is a one-time maintenance operation outside the BANDMARKR product UI. It must not search by title or artist, alter source listening history, replace trusted Spotify identity, or run automatically.

The live execution remains separately gated because it calls Spotify and writes private production listening metadata.

## Current constraints

- Spotify Development Mode has already returned `429` with `reason: QUOTA_EXCEEDED` during the physical v103 test.
- Spotify no longer supports the Development Mode batch `GET /tracks?ids=...` endpoint. Track metadata must be fetched one ID at a time with `GET /tracks/{id}`.
- The exact Development Mode quota size and reset time are not published, so the backfill must be resumable across multiple quota windows.
- Spotify track relinking may return a different provider track ID. The original trusted Spotify track ID remains BANDMARKR's identity and metadata key.
- The Worker intentionally allows listening-object access only to browser/legacy roles. The existing GitHub automation token must not be broadened simply to make this maintenance task convenient.
- Production listening history and metadata remain private and must never be committed to GitHub or included in QA fixtures.

## Execution architecture

### 1. Private local maintenance runner

The preferred production execution path is a manual Node maintenance runner launched from a trusted local environment. Repository code may contain the runner, validation and tests, but real credentials and private checkpoint files stay outside source control.

The runner will obtain credentials only from environment variables or an equivalent local secret store. No Spotify token, client secret, Worker token or private endpoint is accepted as a command-line argument or written to logs.

GitHub Actions is not the default production executor. The current Worker role boundary forbids the automation role from reading or writing listening objects, and that boundary should remain intact. A future dedicated maintenance credential would require a separate reviewed Worker/security change and explicit production authorization.

### 2. Source discovery

At the start of an authorized run, the runner will:

1. Read the current private listening manifest and Spotify archive through the authenticated Worker.
2. Verify the archive checksum/schema using the same integrity expectations as the existing listening vault.
3. Read the current `listening/spotify-metadata.json` document and its ETag.
4. Extract only unique valid `spotifyTrackId` values from immutable source events.
5. Remove IDs that already have a valid metadata record.
6. Remove IDs already marked terminal-not-found in the private maintenance checkpoint.

The runner never sends listening timestamps, titles, artists, band IDs or source-event payloads to Spotify. Spotify receives only the exact trusted track ID already present in the source observation.

### 3. Private checkpoint

A private local checkpoint is created before the first provider request. It is stored under `.livevault-maintenance/`, which is excluded from Git.

The checkpoint contains only maintenance state needed to resume safely, for example:

- schema/version
- source archive fingerprint
- metadata ETag observed at planning time
- ordered pending trusted Spotify IDs
- completed IDs
- terminal 404 IDs
- locally staged metadata records not yet synchronized to R2
- request counters and timestamps
- stop reason such as `quota_exceeded`, `rate_limited`, `manual_stop` or `completed`

The checkpoint contains no OAuth token, client secret, Worker token, listening timestamps, track titles or user-entered data.

After every successful Spotify response, the returned metadata record is written to the local checkpoint before another Spotify request is made. This prevents already-completed provider calls from being repeated if the process stops before the next R2 synchronization.

### 4. Spotify authentication and requests

The catalog lookup uses Spotify Client Credentials because Get Track is public catalog metadata and does not require user-specific Spotify data.

Provider rules:

- request one track at a time: `GET /v1/tracks/{trustedId}?market=SE`;
- default pacing: at least 1,000 ms between track requests;
- initial live-run cap: 25 provider track requests per invocation;
- configurable cap may be raised later only after observing real quota behavior, with a hard maintenance ceiling of 100 per invocation;
- one bounded `Retry-After` wait for an ordinary 429;
- `QUOTA_EXCEEDED` stops the run immediately without consuming the current ID from the pending queue;
- 401 may refresh/reacquire the app access token once;
- 403 stops with a clear provider rejection;
- 404 is recorded as terminal-not-found for this backfill so it is not repeatedly requested every quota window;
- malformed successful responses fail closed;
- no title/artist fallback and no identity guessing.

The request count is recorded in the private checkpoint. Before production execution, the runner must also integrate with the project's provider-usage accounting rather than bypassing existing quota-safety conventions.

### 5. Track relinking and metadata identity

For a request of trusted source ID `A`, Spotify may return provider track ID `B`.

The stored record remains keyed by `A` and contains:

- `spotifyTrackId: A`
- `spotifyTrackUrl: https://open.spotify.com/track/A`
- album ID, album URL and artwork from Spotify's returned Track object
- returned provider ID `B` only as separate derived audit metadata when it differs from `A`

A relinked provider ID never creates a new listening identity and never replaces the source event's trusted Spotify ID.

### 6. R2 synchronization

Provider acquisition and R2 synchronization are separate checkpointed steps.

- Successful Spotify records are staged locally first.
- The runner rereads the latest production metadata before each R2 synchronization.
- Staged records are merged by trusted Spotify ID while preserving unknown existing record fields and unrelated records.
- Writes use the current ETag / conditional write semantics.
- On an ETag conflict, the runner rereads, remerges and may attempt one bounded write retry. It never overwrites a newer document blindly.
- A failed R2 synchronization does not discard locally staged provider results and does not cause those tracks to be fetched from Spotify again.
- Source listening archives and the listening manifest are never modified by the artwork backfill.

R2 synchronization should normally occur after a small group of staged successes and at every controlled stop/end. The exact sync batch can be tuned independently of Spotify pacing because the private checkpoint protects provider work between R2 writes.

### 7. Quota-window resume behavior

If a run starts with 25 pending IDs and Spotify allows only 12 before returning `QUOTA_EXCEEDED`:

1. metadata for the 12 completed requests is already in the private checkpoint;
2. those records are synchronized to R2 if possible;
3. the 13th ID remains pending;
4. the runner exits successfully as a controlled quota stop rather than retrying in a loop;
5. on a later manually authorized run, it rereads production metadata and resumes from the first still-unresolved pending ID.

There is no automatic polling for a Spotify quota reset and no scheduled background retry.

## Validation phases

### Phase A — pure core and synthetic tests

Build repository code that can:

- derive a deterministic missing-ID plan from synthetic source events and metadata;
- preserve a prior checkpoint across interruption;
- store relinked provider metadata under the requested trusted ID;
- mark 404 without removing unrelated data;
- leave the current ID pending on quota/rate-limit stop;
- merge staged records into a newer metadata document without losing unknown fields;
- prove reruns do not repeat already-completed IDs.

No network access is part of this phase.

### Phase B — synthetic I/O runner

Add a CLI shell around the tested core using only fictional local fixtures. Validate:

- checkpoint creation and resume;
- staged-record persistence before the next provider request;
- bounded request count and pacing hooks;
- simulated 401/403/404/429/500 responses;
- conditional-write conflict handling against a fake Worker;
- no credential values in output.

No live Spotify, production Worker or production R2 access is permitted.

### Phase C — production readiness review

Before the first live run:

- review the final diff and tests;
- confirm Spotify Client Credentials are still suitable for Get Track;
- confirm Worker listening-route role boundaries remain unchanged;
- verify the production runner cannot exceed the approved per-invocation cap;
- verify the checkpoint directory is ignored by Git;
- verify dry-run mode performs zero Spotify calls and zero R2 writes;
- define the exact production command without placing credentials in the command line;
- separately obtain explicit authorization for live Spotify calls and production metadata writes.

### Phase D — controlled production backfill

Only after explicit production authorization:

1. run dry-run inventory and report counts only;
2. run a very small first provider window;
3. inspect stop reason, request count and metadata writes;
4. repeat manually across available quota windows;
5. verify metadata coverage after each window;
6. stop permanently once every obtainable trusted ID is either represented in metadata or recorded as terminal-not-found.

## Completion criteria

The backfill is complete when:

- every unique trusted source Spotify track ID is classified as already present, successfully backfilled, or terminal 404;
- no source listening observation was modified;
- no relinked provider ID replaced BANDMARKR's trusted identity;
- no completed Spotify request was repeated because of an interruption or failed R2 write;
- final `listening/spotify-metadata.json` passes the existing Worker validator;
- a fresh app restore can use the resulting artwork metadata;
- the private maintenance checkpoint can be archived locally or deleted after final verification;
- no real listening data or credentials were committed to GitHub.

## Authorization boundary

Creating, reviewing and testing this machinery with synthetic data is approved development work.

The following remain separate production actions and are not authorized by the existence or merge of the maintenance code:

- calling Spotify with the real BANDMARKR application credentials for this historical backfill;
- reading the private production listening archive for the backfill run;
- writing `listening/spotify-metadata.json` in production;
- changing Worker roles, secrets or bindings;
- running a production GitHub workflow.
