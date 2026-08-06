'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../listeningStats');
require('../listeningStatsV81');
const toplist = require('../toplistStatsV96');

const listen = (id, title, at, duration, extra = {}) => ({
  id,
  recordingTitle: title,
  artistCreditName: 'Alpha',
  localBandId: 'a',
  listenedAt: at,
  listenedAtMs: Date.parse(at),
  listenedDurationMs: duration,
  ...extra,
});

test('Toplist exposes the same four listening timeframes', () => {
  assert.deepEqual(Object.keys(stats.TIMEFRAMES), ['twoWeeks', 'threeMonths', 'oneYear', 'allTime']);
});

test('trusted recording identities group listens and rank by count before known duration', () => {
  const values = [
    listen('one', 'Shared', '2026-08-01T10:00:00Z', 60000, { musicbrainzRecordingId: 'mb-1' }),
    listen('two', 'Shared', '2026-08-02T10:00:00Z', null, { musicbrainzRecordingId: 'mb-1' }),
    listen('three', 'Long', '2026-08-03T10:00:00Z', 3600000, { spotifyTrackId: 'sp-2' }),
  ];
  const ranked = toplist.rankTracks(values);
  assert.equal(ranked[0].recordingKey, 'mbid:mb-1');
  assert.equal(ranked[0].listenCount, 2);
  assert.equal(ranked[0].durationMs, 60000);
  assert.equal(ranked[1].recordingKey, 'spotify:sp-2');
});

test('untrusted same-title versions remain separate instead of text collapsing', () => {
  const values = [
    listen('studio-event', 'Signal', '2026-08-01T10:00:00Z', 180000),
    listen('live-event', 'Signal', '2026-08-02T10:00:00Z', 240000, { releaseTitle: 'Signal Live' }),
  ];
  const ranked = toplist.rankTracks(values);
  assert.equal(ranked.length, 2);
  assert.ok(ranked.every((item) => item.listenCount === 1));
  assert.ok(ranked.every((item) => item.trustedIdentity === false));
});

test('movement compares trusted identities and is omitted for all-time or unresolved recordings', () => {
  const previous = toplist.rankTracks([
    listen('previous-a', 'A', '2026-07-01T10:00:00Z', 60000, { stableRecordingId: 'a' }),
    listen('previous-b', 'B', '2026-07-01T11:00:00Z', 120000, { stableRecordingId: 'b' }),
  ]);
  const current = toplist.rankTracks([
    listen('current-a-1', 'A', '2026-08-01T10:00:00Z', 60000, { stableRecordingId: 'a' }),
    listen('current-a-2', 'A', '2026-08-02T10:00:00Z', null, { stableRecordingId: 'a' }),
    listen('current-b', 'B', '2026-08-01T11:00:00Z', 120000, { stableRecordingId: 'b' }),
    listen('unresolved', 'C', '2026-08-03T10:00:00Z', 60000),
  ]);
  const rolling = toplist.withMovement(current, previous, 'threeMonths');
  assert.equal(rolling.find((item) => item.recordingKey === 'recording:a').movement?.kind, 'up');
  assert.equal(rolling.find((item) => item.trustedIdentity === false).movement, null);
  assert.ok(toplist.withMovement(current, previous, 'allTime').every((item) => item.movement === null));
});
