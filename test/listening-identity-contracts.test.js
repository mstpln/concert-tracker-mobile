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
    musicbrainzRecordingId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    reviewedDecision: { action: 'keep_separate' },
    unknownFutureField: 'preserved-on-source',
  });
  const identity = contracts.identityEnvelope(source);
  const canonical = contracts.canonicalEnvelope(source);
  assert.equal(identity.bandId, 'band-synthetic');
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
  ]);
  assert.equal(summary.eventCount, 2);
  assert.deepEqual(summary.sourceCounts, { spotify_import: 1, listenbrainz: 1 });
  assert.equal(summary.firstDateCategory, '2026-08');
  assert.equal(summary.lastDateCategory, '2026-08');
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /Synthetic Artist|Synthetic Track|10:00:00|spotify-track/);
});
