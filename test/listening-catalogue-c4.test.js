'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const c4 = require('../scripts/listening-catalogue-backfill-c4');
const resolver = require('../scripts/listening-catalogue-resolver');
const acquisition = require('../scripts/listening-catalogue-acquisition');

const ARTIST = '12345678-1234-4234-8234-123456789abc';
const RECORDING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RELEASE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function band() {
  return {
    id: 'band-1',
    name: 'Synthetic Artist',
    musicbrainz: { mbid: ARTIST, status: 'manual_confirmed' },
  };
}

function event(id = 'TrackOne', overrides = {}) {
  return {
    stableListenId: `listen-${id}`,
    bandId: 'band-1',
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Synthetic Song',
    releaseTitle: 'Synthetic Release',
    spotifyTrackId: id,
    source: 'spotify_import',
    ...overrides,
  };
}

function pagePayload() {
  return {
    'release-count': 1,
    'release-offset': 0,
    releases: [{
      id: RELEASE,
      title: 'Synthetic Release',
      'release-group': { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      media: [{ tracks: [{ recording: { id: RECORDING, title: 'Synthetic Song', 'artist-credit': [{ artist: { id: ARTIST } }] } }] }],
    }],
  };
}

function completeCache(now = Date.parse('2026-08-11T00:00:00Z')) {
  let cache = acquisition.startArtistRefresh(acquisition.emptyCatalogue(), ARTIST, now);
  const page = resolver.parseMusicBrainzCataloguePage({ artistMbid: ARTIST, payload: pagePayload(), expectedOffset: 0 });
  cache = acquisition.mergeScopePage(cache, 'release_artist', page, now);
  cache = acquisition.mergeScopePage(cache, 'release_track_artist', page, now);
  return cache;
}

function heldIdentity(trackKey) {
  return {
    kind: 'livevault-track-identities',
    schemaVersion: 1,
    updatedAt: '2026-08-11T00:00:00.000Z',
    records: {
      [trackKey]: {
        workKey: trackKey,
        localBandId: 'band-1',
        spotifyTrackId: trackKey.replace('spotify:', ''),
        status: 'needs_review',
        updatedAt: '2026-08-11T00:00:00.000Z',
        nextEligibleCheckAt: null,
        providers: { musicbrainz: { status: 'needs_review', reason: 'synthetic_hold', checkedAt: '2026-08-11T00:00:00.000Z' } },
      },
    },
  };
}

test('C4 groups many tracks by one trusted artist and plans zero Spotify core calls', () => {
  const plan = c4.buildC4Plan({ bands: [band()], events: [event('TrackOne'), event('TrackTwo')] });
  assert.equal(plan.counts.catalogueArtists, 1);
  assert.equal(plan.counts.catalogueEligibleTracks, 2);
  assert.equal(plan.artistGroups[0].trackCount, 2);
  assert.equal(c4.safePlanSummary(plan).spotifyCoreCallsPlanned, 0);
});

test('C4 preserves durable holds outside catalogue routing', () => {
  const trackKey = 'spotify:TrackOne';
  const plan = c4.buildC4Plan({ bands: [band()], events: [event('TrackOne')], trackIdentities: heldIdentity(trackKey) });
  assert.equal(plan.counts.heldTracks, 1);
  assert.equal(plan.counts.catalogueEligibleTracks, 0);
  assert.equal(plan.evidence.items[0].evidenceTier, 'E');
});

test('one authoritative artist catalogue resolves multiple historical track keys locally', () => {
  const events = [event('TrackOne'), event('TrackTwo')];
  const plan = c4.buildC4Plan({ bands: [band()], events });
  const cache = completeCache();
  const local = c4.currentLocalResults(plan, cache);
  assert.equal(local.counts.resolved, 2);
  const applied = c4.applyLocalResolutions({ plan, localResults: local, now: '2026-08-11T01:00:00.000Z' });
  assert.equal(applied.resolved, 2);
  assert.equal(applied.trackIdentities.records['spotify:TrackOne'].musicbrainzRecordingId, RECORDING);
  assert.equal(applied.trackIdentities.records['spotify:TrackTwo'].musicbrainzRecordingId, RECORDING);
});

test('one reusable catalogue can resolve more than 500 historical work items in one pass', () => {
  const events = Array.from({ length: 601 }, (_, index) => event(`SyntheticTrack${index + 1}`));
  const plan = c4.buildC4Plan({ bands: [band()], events });
  assert.equal(plan.counts.catalogueArtists, 1);
  assert.equal(plan.counts.catalogueEligibleTracks, 601);
  const cache = completeCache();
  const local = c4.currentLocalResults(plan, cache);
  assert.equal(local.counts.resolved, 601);
  const applied = c4.applyLocalResolutions({ plan, localResults: local, now: '2026-08-11T01:00:00.000Z' });
  assert.equal(applied.resolved, 601);
  assert.equal(Object.keys(applied.trackIdentities.records).length, 601);
});

test('ListenBrainz widening happens only after authoritative catalogue exhaustion', () => {
  const missEvent = event('TrackOne', { recordingTitle: 'Missing Song' });
  const plan = c4.buildC4Plan({ bands: [band()], events: [missEvent] });
  const complete = completeCache();
  const local = c4.currentLocalResults(plan, complete);
  assert.equal(local.results[0].reason, 'catalogue_no_match');
  const batch = c4.buildListenBrainzBatch({ plan, catalogueCache: complete, localResults: local });
  assert.equal(batch.count, 1);

  const partial = acquisition.startArtistRefresh(acquisition.emptyCatalogue(), ARTIST, Date.parse('2026-08-11T00:00:00Z'));
  const partialLocal = c4.currentLocalResults(plan, partial);
  const partialBatch = c4.buildListenBrainzBatch({ plan, catalogueCache: partial, localResults: partialLocal });
  assert.equal(partialBatch.count, 0);
});

test('ListenBrainz batch mapping requires exact cardinality and unique correlation', () => {
  const batchPlan = {
    items: [
      { trackKey: 'a', artistName: 'Synthetic Artist', recordingName: 'Same Song', releaseName: 'Release A' },
      { trackKey: 'b', artistName: 'Synthetic Artist', recordingName: 'Same Song', releaseName: 'Release B' },
    ],
  };
  assert.throws(
    () => c4.mapListenBrainzBatch({ batchPlan, data: [{ artist_credit_name: 'Synthetic Artist', recording_name: 'Same Song' }] }),
    /cardinality/,
  );
  assert.throws(
    () => c4.mapListenBrainzBatch({ batchPlan, data: [
      { artist_credit_name: 'Synthetic Artist', recording_name: 'Same Song' },
      { artist_credit_name: 'Synthetic Artist', recording_name: 'Same Song', release_name: 'Release B' },
    ] }),
    /cannot be correlated uniquely/,
  );
  assert.throws(
    () => c4.mapListenBrainzBatch({ batchPlan, data: [
      { artist_credit_name: 'Synthetic Artist', recording_name: 'Same Song', release_name: 'Release B' },
      { artist_credit_name: 'Synthetic Artist', recording_name: 'Same Song', release_name: 'Release B' },
    ] }),
    /more than once/,
  );
  const mapped = c4.mapListenBrainzBatch({ batchPlan, data: [
    { artist_credit_name: 'Synthetic Artist', recording_name: 'Same Song', release_name: 'Release B' },
    { artist_credit_name: 'Synthetic Artist', recording_name: 'Same Song', release_name: 'Release A' },
  ] });
  assert.equal(mapped.size, 2);
  assert.equal(mapped.get('a').release_name, 'Release A');
  assert.equal(mapped.get('b').release_name, 'Release B');
});

test('unmappable ListenBrainz response cannot create durable no-match or guessed identity', () => {
  const missEvents = [
    event('TrackOne', { recordingTitle: 'Missing Song', releaseTitle: 'Release A' }),
    event('TrackTwo', { recordingTitle: 'Missing Song', releaseTitle: 'Release B' }),
  ];
  const plan = c4.buildC4Plan({ bands: [band()], events: missEvents });
  const cache = completeCache();
  const local = c4.currentLocalResults(plan, cache);
  const batchPlan = c4.buildListenBrainzBatch({ plan, catalogueCache: cache, localResults: local });
  assert.equal(batchPlan.count, 2);
  const before = { kind: 'livevault-track-identities', schemaVersion: 1, updatedAt: null, records: {} };
  assert.throws(
    () => c4.applyListenBrainzBatch({
      plan,
      batchPlan,
      data: [{ artist_credit_name: 'Synthetic Artist', recording_name: 'Missing Song' }],
      trackIdentities: before,
      now: '2026-08-11T01:00:00.000Z',
    }),
    /cardinality/,
  );
  assert.deepEqual(before.records, {});
  assert.equal(before.updatedAt, null);
});

test('C4 aggregate diagnostics exclude track, artist, title and URL data', () => {
  const diagnostics = c4.aggregateRunDiagnostics({
    providerCalls: { musicbrainz: 12, listenbrainz: 2 },
    localResolved: 50,
    listenbrainz: { resolved: 4, noMatch: 2, needsReview: 1, error: 0 },
    deferredProviders: ['musicbrainz'],
    haltReason: 'provider_deferred:musicbrainz',
  });
  const text = JSON.stringify(diagnostics);
  assert.equal(diagnostics.providerCalls.spotify, 0);
  for (const forbidden of ['trackKey', 'artistMbid', 'artistName', 'recordingTitle', 'releaseTitle', 'https://']) {
    assert.equal(text.includes(forbidden), false);
  }
});
