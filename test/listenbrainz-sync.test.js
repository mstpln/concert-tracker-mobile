'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const listenbrainz = require('../listenbrainzSync.js');
const historyV2 = require('../listeningHistoryV2.js');
const incremental = require('../listeningIncrementalVault.js');

test('normalizes ListenBrainz listens without inventing missing duration', () => {
  const event = listenbrainz.normalizeListen({
    listened_at: 1785751200,
    recording_msid: '11111111-2222-4333-8444-555555555555',
    track_metadata: {
      artist_name: 'Synthetic Artist',
      track_name: 'Synthetic Track',
      release_name: 'Synthetic Album',
      additional_info: {
        recording_mbid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        artist_mbids: ['12345678-1234-4123-8123-123456789abc'],
      },
    },
  });
  assert.equal(event.source, 'listenbrainz');
  assert.equal(event.listenedDurationMs, null);
  assert.equal(event.spotifyTrackId, null);
  assert.match(event.stableListenId, /^listenbrainz:/);
  assert.equal(event.musicbrainzArtistIds.length, 1);
});

test('retains validated ListenBrainz URL, release-group and CAA evidence', () => {
  const event = listenbrainz.normalizeListen({
    listened_at: 1785751200,
    track_metadata: {
      artist_name: 'Synthetic Artist',
      track_name: 'Synthetic Track',
      additional_info: {
        recording_mbid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        release_group_mbid: '12345678-1234-4123-8123-123456789abc',
        caa_id: '12345',
        caa_release_mbid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        url_rels: ['https://open.spotify.com/track/TrustedSynthetic1', 'http://unsafe.example/track'],
      },
    },
  });
  assert.deepEqual(event.listenbrainzUrlRels, ['https://open.spotify.com/track/TrustedSynthetic1']);
  assert.equal(event.musicbrainzReleaseGroupId, '12345678-1234-4123-8123-123456789abc');
  assert.equal(event.listenbrainzCaaId, '12345');
  assert.equal(event.listenbrainzCaaReleaseMbid, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  const sanitized = historyV2.sanitizeEvent(event);
  assert.deepEqual(sanitized.listenbrainzUrlRels, event.listenbrainzUrlRels);
  assert.equal(sanitized.musicbrainzReleaseGroupId, event.musicbrainzReleaseGroupId);
});

test('provider-neutral sanitizer preserves Spotify rules and accepts ListenBrainz identity', () => {
  const listen = historyV2.sanitizeEvent({
    stableListenId: 'listenbrainz:1:test',
    listenedAt: '2026-08-03T08:00:00Z',
    listenedDurationMs: null,
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Synthetic Track',
    source: 'listenbrainz',
    musicbrainzRecordingId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  });
  assert.equal(listen.source, 'listenbrainz');
  assert.equal(listen.listenedDurationMs, null);
  assert.equal(listen.musicbrainzRecordingId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

  assert.equal(historyV2.sanitizeEvent({
    stableListenId: 'spotify:invalid', listenedAt: '2026-08-03T08:00:00Z',
    listenedDurationMs: 10000, artistCreditName: 'Artist', recordingTitle: 'Track',
    spotifyTrackId: 'track', source: 'spotify_import',
  }), null);
});

test('fetches only newer listens and uses bounded paging', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({ payload: { listens: [{
        listened_at: 1785751201,
        recording_msid: '11111111-2222-4333-8444-555555555555',
        track_metadata: { artist_name: 'Synthetic Artist', track_name: 'Synthetic Track', additional_info: { duration_ms: 180000 } },
      }] } }),
    };
  };
  const events = await listenbrainz.fetchNewListens({
    userName: 'synthetic-user', token: 'synthetic-token', afterMs: 1785751200000, fetchImpl,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].listenedDurationMs, 180000);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /count=100/);
  assert.match(calls[0], /min_ts=1785751200/);
});

test('ListenBrainz auto-sync due gate keeps the existing six-hour boundary', () => {
  const lastSync = Date.parse('2026-08-12T00:00:00.000Z');
  const saved = new Date(lastSync).toISOString();
  assert.equal(listenbrainz.isAutoSyncDue(saved, lastSync + listenbrainz.AUTO_SYNC_INTERVAL_MS - 1), false);
  assert.equal(listenbrainz.isAutoSyncDue(saved, lastSync + listenbrainz.AUTO_SYNC_INTERVAL_MS), true);
});

test('ListenBrainz auto sync does no work while fresh and runs once when due', async () => {
  const previousStorage = globalThis.localStorage;
  const previousQa = globalThis.__LIVEVAULT_QA_SYNTHETIC_LISTENING__;
  const lastSync = Date.parse('2026-08-12T00:00:00.000Z');
  let stored = JSON.stringify({
    token: 'synthetic-token',
    userName: 'synthetic-user',
    lastSyncAt: new Date(lastSync).toISOString(),
  });
  globalThis.localStorage = {
    getItem: () => stored,
    setItem: (_key, value) => { stored = value; },
  };
  delete globalThis.__LIVEVAULT_QA_SYNTHETIC_LISTENING__;
  let calls = 0;
  try {
    assert.equal(await listenbrainz.autoSyncIfDue({
      nowMs: lastSync + listenbrainz.AUTO_SYNC_INTERVAL_MS - 1,
      sync: async () => { calls += 1; },
    }), false);
    assert.equal(calls, 0);
    assert.equal(await listenbrainz.autoSyncIfDue({
      nowMs: lastSync + listenbrainz.AUTO_SYNC_INTERVAL_MS,
      sync: async () => { calls += 1; },
    }), true);
    assert.equal(calls, 1);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
    if (previousQa === undefined) delete globalThis.__LIVEVAULT_QA_SYNTHETIC_LISTENING__;
    else globalThis.__LIVEVAULT_QA_SYNTHETIC_LISTENING__ = previousQa;
  }
});

test('foreground resume rechecks ListenBrainz only after the document becomes visible', async () => {
  const previousDocument = globalThis.document;
  const listeners = new Map();
  const document = {
    visibilityState: 'hidden',
    addEventListener(type, listener) { listeners.set(type, listener); },
  };
  globalThis.document = document;
  let checks = 0;
  try {
    assert.equal(listenbrainz.observeForegroundSync(async () => { checks += 1; }), true);
    const listener = listeners.get('visibilitychange');
    assert.equal(typeof listener, 'function');

    listener();
    await Promise.resolve();
    assert.equal(checks, 0);

    document.visibilityState = 'visible';
    listener();
    await Promise.resolve();
    assert.equal(checks, 1);

    assert.equal(listenbrainz.observeForegroundSync(async () => { checks += 1; }), false);
    assert.equal(listeners.size, 1);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  const source = fs.readFileSync('listenbrainzSync.js', 'utf8');
  assert.match(source, /observeForegroundSync\(\);/);
});

test('builds deterministic month-scoped incremental payloads', () => {
  globalThis.LiveVaultSpotifyHistory = { sanitizeEvent: historyV2.sanitizeEvent };
  const payload = incremental.buildPayload('2026-08', [{
    stableListenId: 'listenbrainz:1:test', listenedAt: '2026-08-03T08:00:00Z',
    listenedDurationMs: 180000, artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Track',
    source: 'listenbrainz',
  }]);
  assert.equal(payload.kind, 'livevault-listening-incremental');
  assert.equal(payload.month, '2026-08');
  assert.equal(payload.summary.eventCount, 1);
});

test('excludes Spotify overlap before creating a durable incremental chunk', () => {
  globalThis.LiveVaultSpotifyHistory = { sanitizeEvent: historyV2.sanitizeEvent };
  const existing = [{
    stableListenId: 'spotify:1', listenedAt: '2026-08-03T08:00:00Z',
    listenedDurationMs: 180000, artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Track',
    spotifyTrackId: 'spotify-track', source: 'spotify_import',
  }];
  const incoming = [
    {
      stableListenId: 'listenbrainz:overlap', listenedAt: '2026-08-03T08:00:00Z',
      listenedDurationMs: 180000, artistCreditName: 'Synthetic Artist', recordingTitle: 'Synthetic Track',
      source: 'listenbrainz',
    },
    {
      stableListenId: 'listenbrainz:new', listenedAt: '2026-08-03T08:04:00Z',
      listenedDurationMs: 180000, artistCreditName: 'Synthetic Artist', recordingTitle: 'Another Track',
      source: 'listenbrainz',
    },
  ];
  const accepted = incremental.filterNewEvents(incoming, existing);
  assert.deepEqual(accepted.map((event) => event.stableListenId), ['listenbrainz:new']);
});

test('worker exposes only explicit bounded ListenBrainz object paths', () => {
  const worker = fs.readFileSync('worker.js', 'utf8');
  assert.match(worker, /LISTENBRAINZ_ARCHIVE_PATTERN/);
  assert.match(worker, /listening\\\/listenbrainz/);
  assert.match(worker, /incrementals\.length>10000/);
  assert.match(worker, /maintenanceListeningAllowed/);
  assert.match(worker, /role==='data-maintenance'/);
  assert.doesNotMatch(worker, /listenbrainz\/\.\*/);
});

test('public QA strips every private v80 listening module', () => {
  const build = fs.readFileSync('scripts/build-qa.js', 'utf8');
  for (const file of ['listeningHistoryV2.js', 'listeningIncrementalVault.js', 'listenbrainzSync.js']) {
    assert.match(build, new RegExp(`replace\\('<script src="${file.replace('.', '\\.')}"><\\/script>', ''\\)`));
  }
});

test('incremental restore waits until the base Spotify archive bootstrap has run', () => {
  const source = fs.readFileSync('listeningIncrementalVault.js', 'utf8');
  assert.match(source, /setTimeout\?\.\(async \(\) =>/);
  assert.match(source, /2500/);
});
