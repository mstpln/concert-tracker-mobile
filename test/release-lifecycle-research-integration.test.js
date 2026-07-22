'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const structured = require('../scripts/lib/structuredResearch');
const { processStructuredResearch } = require('../scripts/research');

const now = '2027-07-01T12:00:00.000Z';
const usage = () => ({ canCallMusicbrainz: () => true, recordMusicbrainzAttempt: async () => {}, canCallSpotify: () => true, recordSpotifyCall: async () => {}, canCallTicketmaster: () => true, recordTicketmasterCall: async () => {}, note() {} });
const rawAlbum = { id: 'new-album', title: 'A New Album', 'primary-type': 'Album', 'first-release-date': '2027-08-01' };
function subject(extra = {}) {
  return { id: 'band-1', name: 'Synthetic Band', userNotes: 'keep', musicbrainz: { status: 'manual_confirmed', mbid: 'artist-1', metadata: { artistName: 'Synthetic Band', lastSuccessfulAt: now } },
    structuredResearch: { releases: { musicbrainz: { ...structured.blankProviderBaseline(), status: 'complete', knownKeys: [structured.releaseKey({ musicbrainzReleaseGroupMbid: 'old', title: 'Old', type: 'Album', releaseDate: '2020-01-01', releaseDatePrecision: 'day' })] }, spotify: structured.blankProviderBaseline(), observations: [] } }, ...extra };
}
function localStore(bands, news = []) {
  const state = { bands, news, bandWrites: 0, newsWrites: 0 };
  return { state,
    readBands: async () => state.bands,
    writeBands: async (_name, value) => { state.bands = value; state.bandWrites++; },
    readNews: async () => state.news,
    writeNews: async (_name, value) => { state.news = value; state.newsWrites++; },
  };
}
function options(store, overrides = {}) {
  return { bands: store.state.bands, news: store.state.news, usage: usage(), enabled: true, now,
    fetchArtistMetadata: async () => ({ kind: 'skipped' }), resolveSpotify: async () => ({}), resolveTicketmaster: async () => ({}),
    fetchReleaseGroups: async () => ({ kind: 'ok', releaseGroups: [rawAlbum], count: 1, offset: 0 }),
    listSpotifyReleases: async () => ({ kind: 'skipped' }), getSpotifyTracks: async () => ({ kind: 'skipped' }),
    readBands: store.readBands, writeBands: store.writeBands, readNews: store.readNews, writeNews: store.writeNews, ...overrides };
}

test('completed baseline adds canonical lifecycle state and one album-announced alert', async () => {
  const store = localStore([subject()]);
  await processStructuredResearch(options(store));
  const canonical = store.state.bands[0].structuredResearch.releases.canonical;
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].lifecycleEligible, true);
  assert.equal(store.state.news.filter((item) => item.lifecycleStage === 'album_announced').length, 1);
  assert.ok(canonical[0].lifecycle.album_announced.alertId);
  assert.equal(store.state.bands[0].userNotes, 'keep');
});

test('first and partial baselines populate canonical records without planning lifecycle alerts', async () => {
  const initial = subject({ structuredResearch: { releases: { musicbrainz: structured.blankProviderBaseline(), spotify: structured.blankProviderBaseline() } } });
  const first = localStore([initial]);
  await processStructuredResearch(options(first));
  assert.equal(first.state.news.length, 0);
  assert.equal(first.state.bands[0].structuredResearch.releases.canonical[0].lifecycleEligible, false);

  const partial = localStore([initial]);
  await processStructuredResearch(options(partial, { fetchReleaseGroups: async () => ({ kind: 'ok', releaseGroups: [rawAlbum], count: 2, offset: 0 }) }));
  assert.equal(partial.state.news.length, 0);
  assert.equal(partial.state.bands[0].structuredResearch.releases.canonical[0].lifecycleEligible, false);
});

test('refresh preserves canonical lifecycle and unknown fields, and a rerun is idempotent', async () => {
  const prior = subject({ structuredResearch: { releases: { musicbrainz: { ...structured.blankProviderBaseline(), status: 'complete', knownKeys: [structured.releaseKey({ musicbrainzReleaseGroupMbid: 'old', title: 'Old', type: 'Album', releaseDate: '2020-01-01', releaseDatePrecision: 'day' }), structured.releaseKey(structured.musicbrainzRelease(rawAlbum, 'artist-1'))] }, spotify: structured.blankProviderBaseline(), canonical: [{ ...structured.musicbrainzRelease(rawAlbum, 'artist-1'), canonicalReleaseId: 'mbid:new-album:album', lifecycleEligible: true, lifecycle: { album_announced: { alertId: 'saved-alert', generatedAt: now } }, futureField: { keep: true } }] } } });
  const store = localStore([prior], [{ id: 'saved-alert', lifecycleStage: 'album_announced', saved: true, notes: 'keep' }]);
  await processStructuredResearch(options(store));
  const saved = store.state.bands[0].structuredResearch.releases.canonical[0];
  assert.deepEqual(saved.futureField, { keep: true });
  assert.equal(saved.lifecycle.album_announced.alertId, 'saved-alert');
  const newsCount = store.state.news.length;
  await processStructuredResearch(options(store));
  assert.equal(store.state.news.length, newsCount);
});

test('matching MusicBrainz and Spotify observations produce one canonical release and one logical lifecycle alert', async () => {
  const b = subject({ musicbrainz: { status: 'manual_confirmed', mbid: 'artist-1', metadata: { artistName: 'Synthetic Band', lastSuccessfulAt: now }, spotify: { status: 'confirmed', id: 'spotify-artist' } }, structuredResearch: { releases: { musicbrainz: { ...structured.blankProviderBaseline(), status: 'complete', knownKeys: [] }, spotify: { ...structured.blankProviderBaseline(), status: 'complete', knownKeys: [] } } } });
  const store = localStore([b]);
  await processStructuredResearch(options(store, { listSpotifyReleases: async () => ({ kind: 'ok', items: [{ id: 'spotify-album', name: 'A New Album', album_type: 'album', release_date: '2027-08-01', release_date_precision: 'day', artists: [{ id: 'spotify-artist' }], external_urls: { spotify: 'https://open.spotify.com/album/spotify-album' } }], total: 1, offset: 0 }) }));
  assert.equal(store.state.bands[0].structuredResearch.releases.canonical.length, 1);
  assert.equal(store.state.news.filter((item) => item.lifecycleStage === 'album_announced').length, 1);
});

test('a completed Spotify baseline creates only a trusted new-single alert and preserves the latest band document', async () => {
  const stale = subject({ musicbrainz: { status: 'manual_confirmed', mbid: 'artist-1', metadata: { artistName: 'Synthetic Band', lastSuccessfulAt: now }, spotify: { status: 'confirmed', id: 'spotify-artist' } }, structuredResearch: { releases: { musicbrainz: structured.blankProviderBaseline(), spotify: { ...structured.blankProviderBaseline(), status: 'complete', knownKeys: [] } } } });
  const latest = { ...stale, userNotes: 'newer user note', futureUserField: { preserve: true } };
  const store = localStore([latest]);
  await processStructuredResearch(options(store, { bands: [stale], fetchReleaseGroups: async () => ({ kind: 'skipped' }), listSpotifyReleases: async () => ({ kind: 'ok', items: [{ id: 'single-1', name: 'New Single', album_type: 'single', release_date: '2027-08-01', release_date_precision: 'day', artists: [{ id: 'spotify-artist' }], external_urls: { spotify: 'https://open.spotify.com/album/single-1' } }], total: 1, offset: 0 }) }));
  assert.deepEqual(store.state.news.map((item) => item.lifecycleStage), ['new_single']);
  assert.equal(store.state.bands[0].futureUserField.preserve, true);
  assert.equal(store.state.bands[0].userNotes, 'newer user note');
});
