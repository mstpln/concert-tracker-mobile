'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../scripts/listening-catalogue-resolver');
const acquisition = require('../scripts/listening-catalogue-acquisition');
const persistence = require('../scripts/lib/listeningCataloguePersistence');
const {
  createMusicBrainzCatalogueAdapter,
  createListenBrainzBatchAdapter,
  MAX_LISTENBRAINZ_BATCH,
} = require('../scripts/lib/listeningCatalogueProviders');

const ARTIST = '12345678-1234-4234-8234-123456789abc';
const RELEASE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RELEASE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECORDING_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RECORDING_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function releasePayload({ offset = 0, total = 1, releaseMbid = RELEASE_A, recordingMbid = RECORDING_A, title = 'Synthetic Song' } = {}) {
  return {
    'release-count': total,
    'release-offset': offset,
    releases: [{
      id: releaseMbid,
      title: 'Synthetic Release',
      'release-group': { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      media: [{ tracks: [{ recording: { id: recordingMbid, title, 'artist-credit': [{ artist: { id: ARTIST } }] } }] }],
    }],
  };
}

function page(payload, expectedOffset = 0) {
  return resolver.parseMusicBrainzCataloguePage({ artistMbid: ARTIST, payload, expectedOffset });
}

test('C3 MusicBrainz adapter uses the two approved release browse scopes', async () => {
  const seen = [];
  const adapter = createMusicBrainzCatalogueAdapter({
    fetchImpl: async (url, options) => {
      seen.push({ url: new URL(String(url)), options });
      return new Response(JSON.stringify(releasePayload()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.equal((await adapter.releaseBrowse({ artistMbid: ARTIST, scope: 'release_artist' })).kind, 'ok');
  assert.equal((await adapter.releaseBrowse({ artistMbid: ARTIST, scope: 'release_track_artist' })).kind, 'ok');
  assert.equal(seen[0].url.searchParams.get('artist'), ARTIST);
  assert.equal(seen[0].url.searchParams.has('track_artist'), false);
  assert.equal(seen[1].url.searchParams.get('track_artist'), ARTIST);
  assert.equal(seen[1].url.searchParams.has('artist'), false);
  assert.equal(seen[0].url.searchParams.get('limit'), '100');
  assert.equal(seen[0].url.searchParams.get('offset'), '0');
  assert.equal(seen[0].url.searchParams.get('inc'), 'recordings release-groups artist-credits');
  assert.match(seen[0].options.headers['User-Agent'], /LiveVault|BANDMARKR/i);
});

test('C3 MusicBrainz adapter defers transient failures without hidden retry', async () => {
  let calls = 0;
  const adapter = createMusicBrainzCatalogueAdapter({
    fetchImpl: async () => {
      calls += 1;
      return new Response('busy', { status: 503 });
    },
    now: () => Date.parse('2026-08-11T00:00:00Z'),
  });
  const result = await adapter.releaseBrowse({ artistMbid: ARTIST, scope: 'release_artist' });
  assert.equal(calls, 1);
  assert.equal(result.kind, 'retry');
  assert.equal(result.reason, 'http_503');
  assert.ok(Date.parse(result.nextEligibleCheckAt) > Date.parse('2026-08-11T00:00:00Z'));
});

test('independent scope checkpoints become authoritative only after both complete', () => {
  const now = Date.parse('2026-08-11T00:00:00Z');
  let cache = acquisition.startArtistRefresh(acquisition.emptyCatalogue(), ARTIST, now);
  cache = acquisition.mergeScopePage(cache, 'release_artist', page(releasePayload()), now);
  assert.deepEqual(cache.artists[ARTIST].coverageScopes, ['release_artist']);
  assert.equal(cache.artists[ARTIST].complete, undefined);
  assert.equal(resolver.catalogueSnapshotComplete(cache.artists[ARTIST]), false);

  cache = acquisition.mergeScopePage(cache, 'release_track_artist', page(releasePayload({ releaseMbid: RELEASE_B, recordingMbid: RECORDING_B, title: 'Track-only Song' })), now);
  assert.deepEqual(cache.artists[ARTIST].coverageScopes, ['release_artist', 'release_track_artist']);
  assert.equal(cache.artists[ARTIST].complete, true);
  assert.equal(cache.artists[ARTIST].nextOffset, 2);
  assert.equal(cache.artists[ARTIST].totalCount, 2);
  assert.equal(resolver.catalogueSnapshotComplete(cache.artists[ARTIST]), true);
  assert.equal(acquisition.artistNeedsRefresh(cache, ARTIST, now + acquisition.CATALOGUE_FRESHNESS_MS - 1), false);
  assert.equal(acquisition.artistNeedsRefresh(cache, ARTIST, now + acquisition.CATALOGUE_FRESHNESS_MS), true);
});

test('cross-scope duplicate releases and recordings are assembled once', () => {
  const now = Date.parse('2026-08-11T00:00:00Z');
  let cache = acquisition.startArtistRefresh(acquisition.emptyCatalogue(), ARTIST, now);
  const same = page(releasePayload());
  cache = acquisition.mergeScopePage(cache, 'release_artist', same, now);
  cache = acquisition.mergeScopePage(cache, 'release_track_artist', same, now);
  const artist = cache.artists[ARTIST];
  assert.equal(artist.releaseMbids.length, 1);
  assert.equal(artist.recordings.length, 1);
  assert.equal(artist.recordings[0].releases.length, 1);
  acquisition.validateDurableCatalogue(cache);
});

test('acquisition persists every safe checkpoint and stops on provider retry', async () => {
  const writes = [];
  let calls = 0;
  const provider = {
    async releaseBrowse({ scope, offset }) {
      calls += 1;
      if (scope === 'release_artist') return { kind: 'ok', data: releasePayload({ offset, total: 1 }) };
      return { kind: 'retry', reason: 'http_503', nextEligibleCheckAt: '2026-08-11T01:00:00Z' };
    },
  };
  const usage = { reserve: async () => true, blockReason: () => null };
  const result = await acquisition.acquireArtistCatalogue({
    cache: acquisition.emptyCatalogue(),
    artistMbid: ARTIST,
    provider,
    usage,
    now: () => Date.parse('2026-08-11T00:00:00Z'),
    persistCheckpoint: async (cache) => writes.push(JSON.parse(JSON.stringify(cache))),
  });
  assert.equal(result.kind, 'retry');
  assert.equal(calls, 2);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].artists[ARTIST].scopeCheckpoints.release_artist.complete, true);
  assert.equal(writes[1].artists[ARTIST].complete, undefined);
});

test('catalogue persistence retries one unrelated ETag conflict but rejects same-artist conflict', async () => {
  const now = Date.parse('2026-08-11T00:00:00Z');
  let base = acquisition.startArtistRefresh(acquisition.emptyCatalogue(), ARTIST, now);
  const next = acquisition.mergeScopePage(base, 'release_artist', page(releasePayload()), now);
  const otherArtist = '99999999-9999-4999-8999-999999999999';
  const latest = JSON.parse(JSON.stringify(base));
  latest.artists[otherArtist] = { artistMbid: otherArtist, sourceEntity: 'release', recordings: [] };
  let writes = 0;
  const client = {
    async readJson() { return JSON.parse(JSON.stringify(latest)); },
    async writeJsonStrict(_path, value) {
      writes += 1;
      if (writes === 1) { const error = new Error('conflict'); error.code = 'ETAG_CONFLICT'; throw error; }
      Object.assign(latest, JSON.parse(JSON.stringify(value)));
    },
  };
  const result = await persistence.persistCatalogue(client, { base, next, artistMbid: ARTIST });
  assert.equal(result.conflicted, true);
  assert.ok(result.cache.artists[otherArtist]);
  assert.equal(result.cache.artists[ARTIST].scopeCheckpoints.release_artist.complete, true);

  const conflictingLatest = JSON.parse(JSON.stringify(base));
  conflictingLatest.artists[ARTIST].unexpectedConcurrentField = true;
  let attempts = 0;
  const conflictingClient = {
    async readJson() { return JSON.parse(JSON.stringify(conflictingLatest)); },
    async writeJsonStrict() { attempts += 1; const error = new Error('conflict'); error.code = 'ETAG_CONFLICT'; throw error; },
  };
  await assert.rejects(
    persistence.persistCatalogue(conflictingClient, { base, next, artistMbid: ARTIST }),
    (error) => error.code === 'CATALOGUE_ARTIST_CONFLICT',
  );
  assert.equal(attempts, 1);
});

test('dormant ListenBrainz adapter is bounded and uses one authenticated POST', async () => {
  let calls = 0;
  let body;
  const adapter = createListenBrainzBatchAdapter({
    tokenProvider: async () => 'synthetic-token',
    fetchImpl: async (_url, options) => {
      calls += 1;
      body = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, 'Token synthetic-token');
      return new Response(JSON.stringify([{ recording_mbid: RECORDING_A }]), { status: 200 });
    },
  });
  const result = await adapter.lookupBatch({ items: [{ artistName: 'Synthetic Artist', recordingName: 'Synthetic Song', releaseName: 'Synthetic Release' }] });
  assert.equal(result.kind, 'ok');
  assert.equal(calls, 1);
  assert.deepEqual(body.recordings[0], { artist_name: 'Synthetic Artist', recording_name: 'Synthetic Song', release_name: 'Synthetic Release' });
  assert.equal((await adapter.lookupBatch({ items: Array.from({ length: MAX_LISTENBRAINZ_BATCH + 1 }, () => ({ artistName: 'A', recordingName: 'B' })) })).kind, 'error');
  assert.equal(calls, 1);
});

test('C3 diagnostics are aggregate only', () => {
  const cache = acquisition.startArtistRefresh(acquisition.emptyCatalogue(), ARTIST, Date.parse('2026-08-11T00:00:00Z'));
  assert.deepEqual(acquisition.safeCatalogueDiagnostics(cache), { artists: 1, completeArtists: 0, partialArtists: 1, recordings: 0, releases: 0 });
  assert.doesNotMatch(JSON.stringify(acquisition.safeCatalogueDiagnostics(cache)), new RegExp(ARTIST));
});
