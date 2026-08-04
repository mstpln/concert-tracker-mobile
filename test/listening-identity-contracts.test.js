'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../listeningIdentityContracts.js');

function event(overrides = {}) {
  return {
    stableListenId: 'synthetic:1',
    source: 'listenbrainz',
    listenedAt: '2026-08-04T10:00:00.000Z',
    listenedDurationMs: 180000,
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Synthetic Track',
    ...overrides,
  };
}

test('uses additive identity and canonical envelopes without deleting provenance', () => {
  const source = event({
    localBandId: 'band-synthetic',
    musicbrainzArtistIds: ['11111111-2222-4333-8444-555555555555', '66666666-7777-4888-8999-aaaaaaaaaaaa'],
    musicbrainzRecordingId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    reviewedDecision: { action: 'keep_separate' },
    unknownFutureField: 'preserved-on-source',
  });
  const identity = contracts.identityEnvelope(source);
  const canonical = contracts.canonicalEnvelope(source);
  assert.equal(identity.bandId, 'band-synthetic');
  assert.equal(identity.artistMbid, '11111111-2222-4333-8444-555555555555');
  assert.deepEqual(identity.artistMbids, [
    '11111111-2222-4333-8444-555555555555',
    '66666666-7777-4888-8999-aaaaaaaaaaaa',
  ]);
  assert.equal(identity.recordingMbid, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.deepEqual(identity.reviewedDecision, { action: 'keep_separate' });
  assert.equal(canonical.sourceEventId, 'synthetic:1');
  assert.equal(source.unknownFutureField, 'preserved-on-source');
});

test('same-source exact IDs are level 1 duplicates', () => {
  const result = contracts.matchingEvidence(event(), event());
  assert.deepEqual(result, { tier: 1, outcome: 'exact_duplicate', method: 'provider_id', automatic: true });
});

test('exact recording MBID permits only the one-second timestamp boundary', () => {
  const left = event({ source: 'spotify_import', stableListenId: 'spotify:1', musicbrainzRecordingId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  const atBoundary = event({ stableListenId: 'listenbrainz:1', listenedAt: '2026-08-04T10:00:01.000Z', musicbrainzRecordingId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  const outsideBoundary = event({ stableListenId: 'listenbrainz:2', listenedAt: '2026-08-04T10:00:01.001Z', musicbrainzRecordingId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  assert.equal(contracts.matchingEvidence(left, atBoundary).tier, 2);
  assert.equal(contracts.matchingEvidence(left, outsideBoundary).outcome, 'unique');
});

test('exact Spotify track ID is level 3 and unknown duration does not block it', () => {
  const left = event({ source: 'spotify_import', stableListenId: 'spotify:1', spotifyTrackId: 'spotify-track', listenedDurationMs: 180000 });
  const right = event({ stableListenId: 'listenbrainz:1', spotifyTrackId: 'spotify-track', listenedDurationMs: null });
  assert.deepEqual(contracts.matchingEvidence(left, right), {
    tier: 3, outcome: 'exact_duplicate', method: 'spotify_id', automatic: true,
  });
});

test('trusted release and duration evidence remains non-automatic level 4', () => {
  const left = event({ source: 'spotify_import', stableListenId: 'spotify:1', musicbrainzReleaseId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  const right = event({ stableListenId: 'listenbrainz:1', musicbrainzReleaseId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', listenedDurationMs: 181500 });
  assert.deepEqual(contracts.matchingEvidence(left, right), {
    tier: 4, outcome: 'probable_duplicate', method: 'trusted_release_duration', automatic: false,
  });
});

test('title-only, cover, live and same-name evidence never silently merges', () => {
  for (const title of ['Synthetic Track', 'Synthetic Track (Live)', 'Synthetic Track - Remix']) {
    const result = contracts.matchingEvidence(
      event({ source: 'spotify_import', stableListenId: `spotify:${title}`, recordingTitle: title }),
      event({ stableListenId: `listenbrainz:${title}`, recordingTitle: title }),
    );
    assert.equal(result.automatic, false);
    assert.equal(result.outcome, 'ambiguous');
  }
});

test('reviewed decisions survive reruns and block automatic replacement', () => {
  const result = contracts.matchingEvidence(
    event({ reviewedDecision: { action: 'keep_separate' } }),
    event({ source: 'spotify_import', stableListenId: 'spotify:1' }),
  );
  assert.deepEqual(result, { tier: null, outcome: 'user_reviewed', method: 'manual', automatic: false });
});

test('safe audit summary contains counts and month categories but no listening text or raw timestamps', () => {
  const summary = contracts.safeAuditSummary([
    event({ source: 'spotify_import', stableListenId: 'spotify:1', spotifyTrackId: 'spotify-track' }),
    event({ stableListenId: 'listenbrainz:1', listenedAt: '2026-08-05T10:00:00Z', musicbrainzRecordingId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
    event({ source: 'private-user@example.com', stableListenId: 'private:1' }),
  ]);
  assert.equal(summary.eventCount, 3);
  assert.deepEqual(summary.sourceCounts, { spotify_import: 1, listenbrainz: 1, other: 1 });
  assert.equal(summary.firstDateCategory, '2026-08');
  assert.equal(summary.lastDateCategory, '2026-08');
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /Synthetic Artist|Synthetic Track|10:00:00|spotify-track|private-user@example.com/);
});

test('candidate audit reports only aggregate evidence tiers and expected reduction', () => {
  const pairs = [
    { left: event(), right: event() },
    {
      left: event({ source: 'spotify_import', stableListenId: 'spotify:2', spotifyTrackId: 'track-2' }),
      right: event({ stableListenId: 'listenbrainz:2', spotifyTrackId: 'track-2' }),
    },
    {
      left: event({ source: 'spotify_import', stableListenId: 'spotify:3' }),
      right: event({ stableListenId: 'listenbrainz:3' }),
    },
  ];
  const summary = contracts.safeCandidateSummary(pairs);
  assert.equal(summary.pairCount, 3);
  assert.equal(summary.byTier.level1, 1);
  assert.equal(summary.byTier.level3, 1);
  assert.equal(summary.byTier.level5, 1);
  assert.equal(summary.automaticCount, 2);
  assert.equal(summary.expectedCanonicalReduction, 2);
  assert.equal(summary.ambiguousCount, 1);
  assert.doesNotMatch(JSON.stringify(summary), /Synthetic Artist|Synthetic Track|spotify:|listenbrainz:/);
});

test('migration checkpoints are chunked resumable idempotent and bounded', () => {
  let checkpoint = contracts.createMigrationCheckpoint({ totalEvents: 250403, chunkSize: 1000 });
  assert.equal(checkpoint.cursor, 0);
  assert.equal(checkpoint.status, 'pending');

  const first = contracts.nextMigrationChunk(checkpoint);
  assert.deepEqual({ start: first.start, end: first.end, count: first.count, done: first.done }, {
    start: 0, end: 1000, count: 1000, done: false,
  });
  checkpoint = first.checkpoint;

  const resumed = contracts.nextMigrationChunk(checkpoint);
  assert.equal(resumed.start, 1000);
  assert.equal(resumed.end, 2000);
  assert.equal(resumed.checkpoint.processedEvents, 2000);

  const normalizedAgain = contracts.createMigrationCheckpoint(resumed.checkpoint);
  assert.deepEqual(normalizedAgain, resumed.checkpoint);
});

test('archive-scale migration planning stays bounded to deterministic chunks', () => {
  let checkpoint = contracts.createMigrationCheckpoint({ totalEvents: 250403, chunkSize: 1000 });
  let chunks = 0;
  let largestChunk = 0;
  let finalChunk = 0;

  while (checkpoint.status !== 'complete') {
    const next = contracts.nextMigrationChunk(checkpoint);
    chunks += 1;
    largestChunk = Math.max(largestChunk, next.count);
    finalChunk = next.count;
    checkpoint = next.checkpoint;
  }

  assert.equal(chunks, 251);
  assert.equal(largestChunk, 1000);
  assert.equal(finalChunk, 403);
  assert.equal(checkpoint.cursor, 250403);
  assert.equal(checkpoint.processedEvents, 250403);
});

test('migration integrity fails closed on source-count drift and supports rollback', () => {
  const safe = contracts.verifyMigrationIntegrity({
    totalEvents: 250403,
    cursor: 250403,
    sourceEventCountBefore: 250403,
    sourceEventCountAfter: 250403,
  });
  assert.equal(safe.ok, true);
  assert.equal(safe.complete, true);
  assert.equal(safe.rollbackSafe, true);

  const drifted = contracts.verifyMigrationIntegrity({
    totalEvents: 250403,
    cursor: 250403,
    sourceEventCountBefore: 250403,
    sourceEventCountAfter: 250402,
  });
  assert.equal(drifted.ok, false);
  assert.equal(drifted.sourceCountsMatch, false);
  assert.equal(drifted.rollbackSafe, false);
});
