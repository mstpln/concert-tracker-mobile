'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runner = require('../scripts/spotify-album-artwork-production');

const bands = [{ id: 'band-a', name: 'Synthetic Artist' }];

function event(trackId, releaseTitle = 'Synthetic Album') {
  return {
    stableListenId: `listen-${trackId}`,
    artistCreditName: 'Synthetic Artist',
    recordingTitle: `Track ${trackId}`,
    releaseTitle,
    spotifyTrackId: trackId,
    source: 'spotify_import',
  };
}

function metadataRecord(trackId, albumId = 'Album123') {
  return {
    spotifyTrackId: trackId,
    spotifyTrackUrl: `https://open.spotify.com/track/${trackId}`,
    spotifyAlbumId: albumId,
    spotifyAlbumUrl: `https://open.spotify.com/album/${albumId}`,
    artworkUrl: 'https://images.example.test/album.jpg',
    fetchedAt: '2026-08-11T12:00:00.000Z',
    source: 'spotify_exact_track_id',
  };
}

function spotifyTrack(trackId, albumId = 'Album123') {
  return {
    id: trackId,
    external_urls: { spotify: `https://open.spotify.com/track/${trackId}` },
    album: {
      id: albumId,
      external_urls: { spotify: `https://open.spotify.com/album/${albumId}` },
      images: [{ url: 'https://images.example.test/album.jpg', width: 640, height: 640 }],
    },
  };
}

function emptyMetadata() {
  return { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, updatedAt: null, records: {} };
}

function fakeUsage() {
  return { saveCalls: 0, async save() { this.saveCalls += 1; } };
}

test('argument parsing keeps conservative album-group cap and pacing', () => {
  const options = runner.parseArgs(['--execute', '--write', '--cap', '999', '--delay-ms', '1', '--market', 'se']);
  assert.equal(options.execute, true);
  assert.equal(options.write, true);
  assert.equal(options.cap, 100);
  assert.equal(options.delayMs, 1000);
  assert.equal(options.market, 'SE');
});

test('three sibling tracks require one exact Spotify track lookup and persist only its representative record', async () => {
  let remote = emptyMetadata();
  let etag = 'etag-1';
  let providerTrackCalls = 0;
  let writes = 0;
  let tokenCalls = 0;
  const trackedCallOptions = [];
  const usage = fakeUsage();

  const result = await runner.runAlbumArtwork({
    cap: 25,
    delayMs: 1000,
    loadSource: async () => ({ events: [event('TrackA'), event('TrackB'), event('TrackC')], counts: { totalEvents: 3 } }),
    readBands: async () => ({ value: bands }),
    readMetadata: async () => ({ metadata: remote, etag, missing: false }),
    writeMetadata: async ({ value }) => { remote = JSON.parse(JSON.stringify(value)); etag = `etag-${writes + 2}`; writes += 1; return { etag }; },
    getToken: async () => { tokenCalls += 1; return 'synthetic-token'; },
    fetchTrack: async ({ id }) => { providerTrackCalls += 1; return { kind: 'ok', track: spotifyTrack(id) }; },
    trackProviderCall: async (_usage, operation, options) => {
      trackedCallOptions.push(options);
      return operation();
    },
    usageFactory: async () => usage,
    sleepImpl: async () => {},
    now: () => '2026-08-11T12:00:00.000Z',
  });

  assert.equal(tokenCalls, 1);
  assert.equal(providerTrackCalls, 1);
  assert.equal(writes, 1);
  assert.deepEqual(trackedCallOptions, [{ allowSuccess: false }, undefined]);
  assert.equal(result.providerAlbumGroupsResolved, 1);
  assert.equal(result.representativeRecordsAdded, 1);
  assert.equal(result.musicbrainzCalls, 0);
  assert.equal(result.listenbrainzCalls, 0);
  assert.deepEqual(Object.keys(remote.records), ['TrackA']);
  assert.equal(remote.records.TrackA.spotifyAlbumId, 'Album123');
  assert.equal(remote.records.TrackA.source, 'spotify_exact_track_id');
  assert.match(remote.records.TrackA.albumGroupKey, /^album:/);
});

test('already-known compatible album artwork makes the group zero-call and zero-write', async () => {
  const remote = { ...emptyMetadata(), records: { TrackB: metadataRecord('TrackB') } };
  let providerTrackCalls = 0;
  let writes = 0;
  let tokenCalls = 0;

  const result = await runner.runAlbumArtwork({
    loadSource: async () => ({ events: [event('TrackA'), event('TrackB'), event('TrackC')], counts: { totalEvents: 3 } }),
    readBands: async () => ({ value: bands }),
    readMetadata: async () => ({ metadata: remote, etag: 'etag-1', missing: false }),
    writeMetadata: async () => { writes += 1; throw new Error('should not write'); },
    getToken: async () => { tokenCalls += 1; return 'synthetic-token'; },
    fetchTrack: async () => { providerTrackCalls += 1; throw new Error('should not call provider'); },
    trackProviderCall: async (_usage, operation) => operation(),
    usageFactory: async () => fakeUsage(),
  });

  assert.equal(result.reusedAlbumGroups, 1);
  assert.equal(result.providerAlbumGroupsPlanned, 0);
  assert.equal(tokenCalls, 0);
  assert.equal(providerTrackCalls, 0);
  assert.equal(writes, 0);
});

test('conflicting known album IDs fail closed without provider work', async () => {
  const remote = {
    ...emptyMetadata(),
    records: {
      TrackA: metadataRecord('TrackA', 'AlbumOne'),
      TrackB: metadataRecord('TrackB', 'AlbumTwo'),
    },
  };
  let providerTrackCalls = 0;

  const result = await runner.runAlbumArtwork({
    loadSource: async () => ({ events: [event('TrackA'), event('TrackB')], counts: { totalEvents: 2 } }),
    readBands: async () => ({ value: bands }),
    readMetadata: async () => ({ metadata: remote, etag: 'etag-1', missing: false }),
    writeMetadata: async () => { throw new Error('should not write'); },
    getToken: async () => 'synthetic-token',
    fetchTrack: async () => { providerTrackCalls += 1; throw new Error('should not call provider'); },
    trackProviderCall: async (_usage, operation) => operation(),
    usageFactory: async () => fakeUsage(),
  });

  assert.equal(result.ambiguousAlbumGroups, 1);
  assert.equal(result.providerAlbumGroupsPlanned, 0);
  assert.equal(providerTrackCalls, 0);
});

test('band changes after planning stop before the exact track provider lookup', async () => {
  let bandReads = 0;
  let providerTrackCalls = 0;

  await assert.rejects(() => runner.runAlbumArtwork({
    loadSource: async () => ({ events: [event('TrackA')], counts: { totalEvents: 1 } }),
    readBands: async () => {
      bandReads += 1;
      return { value: bandReads === 1 ? bands : [{ id: 'band-a', name: 'Changed Artist' }] };
    },
    readMetadata: async () => ({ metadata: emptyMetadata(), etag: 'etag-1', missing: false }),
    writeMetadata: async () => { throw new Error('should not write'); },
    getToken: async () => 'synthetic-token',
    fetchTrack: async () => { providerTrackCalls += 1; return { kind: 'ok', track: spotifyTrack('TrackA') }; },
    trackProviderCall: async (_usage, operation) => operation(),
    usageFactory: async () => fakeUsage(),
  }), /bands changed after planning/);

  assert.equal(providerTrackCalls, 0);
});

test('production CLI refuses before network access without the exact authorization gates', async () => {
  let fetchCalls = 0;
  await assert.rejects(() => runner.runProductionCli({
    argv: ['--execute', '--write'],
    env: {},
    fetchImpl: async () => { fetchCalls += 1; throw new Error('network should not be reached'); },
    log: () => {},
  }), /authorization|Missing required environment variable/i);
  assert.equal(fetchCalls, 0);
});
