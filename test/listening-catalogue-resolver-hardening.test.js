'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../scripts/listening-catalogue-resolver');

const ARTIST = '11111111-1111-4111-8111-111111111111';
const RECORDING = '22222222-2222-4222-8222-222222222222';
const RELEASE = '44444444-4444-4444-8444-444444444444';
const RELEASE_GROUP = '55555555-5555-4555-8555-555555555555';
const OTHER_ARTIST = '66666666-6666-4666-8666-666666666666';
const RELEASE_2 = '77777777-7777-4777-8777-777777777777';

function minimalEvidence(tier = 'B') {
  return {
    schemaVersion: 1,
    tierCounts: { A: 0, B: tier === 'B' ? 1 : 0, C: tier === 'C' ? 1 : 0, D: 0, E: 0 },
    items: [{
      trackKey: 'spotify:SyntheticSpotifyTrack1',
      evidenceTier: tier,
      status: 'needs_spotify',
      trustedMusicbrainzArtistMbid: ARTIST,
      artistLookupName: 'Synthetic Artist',
      recordingLookupName: 'Exact Song',
      normalizedRecordingTitle: 'exact song',
      releaseLookupName: tier === 'B' ? 'Exact Album' : null,
      normalizedReleaseTitle: tier === 'B' ? 'exact album' : null,
      routingHoldReason: null,
    }],
  };
}

function recording(overrides = {}) {
  return {
    recordingMbid: RECORDING,
    title: 'Exact Song',
    artistMbids: [ARTIST],
    releases: [{ releaseMbid: RELEASE, releaseGroupMbid: RELEASE_GROUP, title: 'Exact Album' }],
    ...overrides,
  };
}

function completeCache(recordings = []) {
  return {
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    artists: {
      [ARTIST]: { artistMbid: ARTIST, recordings },
    },
  };
}

function completePage() {
  return {
    schemaVersion: resolver.CATALOGUE_PAGE_SCHEMA_VERSION,
    sourceEntity: 'release',
    artistMbid: ARTIST,
    offset: 0,
    releaseCount: 1,
    releaseMbids: [RELEASE],
    nextOffset: 1,
    totalCount: 1,
    complete: true,
    recordings: [recording()],
  };
}

test('forged tier A evidence cannot claim an incomplete item is already complete', () => {
  const item = { ...minimalEvidence('B').items[0], evidenceTier: 'A' };
  const outcome = resolver.resolveFromCatalogue(item, null);
  assert.equal(outcome.status, 'exception');
  assert.equal(outcome.reason, 'invalid_tier_a_evidence');
});

test('durable routing hold outranks otherwise complete source identity', () => {
  const bands = [{
    id: 'band-1',
    name: 'Synthetic Artist',
    musicbrainz: { mbid: ARTIST, status: 'manual_confirmed' },
  }];
  const events = [{
    stableListenId: 'listen-1',
    bandId: 'band-1',
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Exact Song',
    spotifyTrackId: 'SyntheticSpotifyTrack1',
    musicbrainzRecordingId: RECORDING,
    musicbrainzArtistIds: [ARTIST],
  }];
  const trackIdentities = {
    kind: 'livevault-track-identities',
    schemaVersion: 1,
    records: {
      'spotify:SyntheticSpotifyTrack1': {
        workKey: 'spotify:SyntheticSpotifyTrack1',
        spotifyTrackId: 'SyntheticSpotifyTrack1',
        localBandId: 'band-1',
        status: 'needs_review',
        providers: {},
      },
    },
  };
  const evidence = resolver.buildCatalogueEvidence({ bands, events, trackIdentities });
  assert.equal(evidence.items[0].status, 'complete');
  assert.equal(evidence.items[0].routingHoldReason, 'durable_identity_needs_review');
  assert.equal(evidence.items[0].evidenceTier, 'E');
  const local = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: completeCache([recording()]) });
  assert.equal(local.results[0].status, 'exception');
  assert.equal(local.results[0].reason, 'durable_identity_needs_review');
});

test('malformed explicitly MusicBrainz-owned release evidence cannot downgrade to text-only matching', () => {
  const bands = [{
    id: 'band-1',
    name: 'Synthetic Artist',
    musicbrainz: { mbid: ARTIST, status: 'manual_confirmed' },
  }];
  const events = [{
    stableListenId: 'listen-1',
    bandId: 'band-1',
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Exact Song',
    releaseTitle: 'Exact Album',
    spotifyTrackId: 'SyntheticSpotifyTrack1',
    musicbrainzReleaseId: 'not-an-mbid',
  }];
  const evidence = resolver.buildCatalogueEvidence({ bands, events });
  assert.equal(evidence.items[0].sourceReleaseEvidenceMalformed, true);
  assert.equal(evidence.items[0].sourceMusicbrainzReleaseMbid, null);
  assert.equal(evidence.items[0].evidenceTier, 'E');
  const local = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: completeCache([recording()]) });
  assert.equal(local.results[0].status, 'exception');
});

test('batch bridge rejects a stale local result from a different evidence tier', () => {
  const evidence = minimalEvidence('B');
  const catalogueCache = completeCache([]);
  const localResults = resolver.resolveCatalogueEvidence({ evidence, catalogueCache });
  localResults.results[0].evidenceTier = 'C';
  assert.throws(
    () => resolver.planListenBrainzBatchBridge({ evidence, catalogueCache, localResults }),
    /Stale catalogue resolution results/,
  );
});

test('batch bridge rejects results produced from an older catalogue snapshot', () => {
  const evidence = minimalEvidence('B');
  const oldCache = completeCache([]);
  const stale = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: oldCache });
  assert.equal(stale.results[0].reason, 'catalogue_no_match');

  const currentCache = completeCache([recording()]);
  assert.throws(
    () => resolver.planListenBrainzBatchBridge({ evidence, catalogueCache: currentCache, localResults: stale }),
    /Stale catalogue resolution results/,
  );
  const currentPlan = resolver.planListenBrainzBatchBridge({ evidence, catalogueCache: currentCache });
  assert.equal(currentPlan.count, 0);
  assert.equal(currentPlan.skipped.resolvedLocally, 1);
});

test('local result validation requires an explicit known evidence tier and status', () => {
  assert.throws(() => resolver.validateLocalResults({
    schemaVersion: 1,
    results: [{ trackKey: 'synthetic', status: 'unresolved' }],
  }), /Invalid catalogue resolution result/);
  assert.throws(() => resolver.validateLocalResults({
    schemaVersion: 1,
    results: [{ trackKey: 'synthetic', evidenceTier: 'B', status: 'future_status' }],
  }), /Invalid catalogue resolution result/);
});

test('release-browse checkpoints are independent of normalized recording count', () => {
  const cache = {
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    artists: {
      [ARTIST]: {
        artistMbid: ARTIST,
        sourceEntity: 'release',
        nextOffset: 2,
        totalCount: 3,
        complete: false,
        releaseMbids: [RELEASE, RELEASE_2],
        recordings: [recording({ releases: [] })],
      },
    },
  };
  assert.equal(resolver.validateCatalogueCache(cache), cache);
  assert.equal(resolver.catalogueSnapshotComplete(cache.artists[ARTIST]), false);
});

test('catalogue checkpoint metadata fails closed when incomplete or tied to an unsupported source entity', () => {
  const incomplete = {
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    artists: {
      [ARTIST]: { artistMbid: ARTIST, nextOffset: 1, recordings: [] },
    },
  };
  assert.throws(() => resolver.validateCatalogueCache(incomplete), /checkpoint/);

  const unsupported = {
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    artists: {
      [ARTIST]: { artistMbid: ARTIST, sourceEntity: 'recording', recordings: [] },
    },
  };
  assert.throws(() => resolver.validateCatalogueCache(unsupported), /source entity/);
});

test('incomplete paginated catalogues cannot resolve or widen into ListenBrainz fallback', () => {
  const evidence = minimalEvidence('B');
  const catalogueCache = {
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    artists: {
      [ARTIST]: {
        artistMbid: ARTIST,
        sourceEntity: 'release',
        nextOffset: 1,
        totalCount: 2,
        complete: false,
        releaseMbids: [RELEASE],
        recordings: [recording()],
      },
    },
  };
  const local = resolver.resolveCatalogueEvidence({ evidence, catalogueCache });
  assert.equal(local.results[0].status, 'unresolved');
  assert.equal(local.results[0].reason, 'catalogue_incomplete');
  const batch = resolver.planListenBrainzBatchBridge({ evidence, catalogueCache, localResults: local });
  assert.equal(batch.count, 0);
  assert.equal(batch.skipped.notUnresolvedLocally, 1);
});

test('missing catalogue is not treated as exhausted catalogue work for fallback', () => {
  const evidence = minimalEvidence('C');
  const local = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: null });
  assert.equal(local.results[0].reason, 'catalogue_missing');
  const batch = resolver.planListenBrainzBatchBridge({ evidence, catalogueCache: null, localResults: local });
  assert.equal(batch.count, 0);
  assert.equal(batch.skipped.notUnresolvedLocally, 1);
});

test('catalogue row merge preserves unknown fields while enriching compatible release context', () => {
  const existing = recording({
    futureRecordingField: { keep: true },
    releases: [{
      releaseMbid: RELEASE,
      title: 'Exact Album',
      futureReleaseField: { keep: true },
    }],
  });
  const incoming = recording({
    incomingFutureField: { keep: true },
    releases: [{
      releaseMbid: RELEASE,
      releaseGroupMbid: RELEASE_GROUP,
      title: 'Exact Album',
      incomingReleaseField: { keep: true },
    }],
  });
  const merged = resolver.mergeRecordingRows(existing, incoming);
  assert.deepEqual(merged.futureRecordingField, { keep: true });
  assert.deepEqual(merged.incomingFutureField, { keep: true });
  assert.deepEqual(merged.releases[0].futureReleaseField, { keep: true });
  assert.deepEqual(merged.releases[0].incomingReleaseField, { keep: true });
  assert.equal(merged.releases[0].releaseGroupMbid, RELEASE_GROUP);
});

test('fallback only accepts current local no-match or release-mismatch exhaustion reasons', () => {
  const evidence = minimalEvidence('B');
  const noMatchCache = completeCache([]);
  const noMatch = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: noMatchCache });
  assert.equal(noMatch.results[0].reason, 'catalogue_no_match');
  assert.equal(resolver.planListenBrainzBatchBridge({ evidence, catalogueCache: noMatchCache, localResults: noMatch }).count, 1);

  for (const reason of ['catalogue_missing', 'catalogue_incomplete', 'future_unresolved_reason']) {
    const forged = structuredClone(noMatch);
    forged.results[0].reason = reason;
    assert.throws(
      () => resolver.planListenBrainzBatchBridge({ evidence, catalogueCache: noMatchCache, localResults: forged }),
      /Stale catalogue resolution results/,
    );
  }
});

test('unknown future provider ownership fails closed instead of being silently bypassed', () => {
  const routing = resolver.durableRoutingState({
    status: 'unresolved',
    providers: { futureprovider: { status: 'metadata' } },
  });
  assert.equal(routing.held, true);
  assert.equal(routing.reason, 'durable_provider_unknown_provider');
});

test('catalogue cache rejects recordings outside the enclosing trusted artist boundary', () => {
  const cache = {
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    artists: {
      [ARTIST]: {
        artistMbid: ARTIST,
        recordings: [recording({ artistMbids: [OTHER_ARTIST] })],
      },
    },
  };
  assert.throws(() => resolver.validateCatalogueCache(cache), /outside artist boundary/);
});

test('trusted source release MBID is authoritative over text variation for the same edition', () => {
  const item = {
    ...minimalEvidence('B').items[0],
    sourceMusicbrainzReleaseMbid: RELEASE,
    normalizedReleaseTitle: 'spotify wording differs',
  };
  assert.equal(resolver.releaseMatchesEvidence({
    releaseMbid: RELEASE,
    title: 'MusicBrainz Canonical Title',
  }, item), true);
});

test('checkpoint-less snapshots cannot be extended by paginated page merges', () => {
  const snapshot = {
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    artists: {
      [ARTIST]: { artistMbid: ARTIST, recordings: [recording()] },
    },
  };
  assert.throws(
    () => resolver.mergeCataloguePage(snapshot, completePage()),
    /checkpoint-less catalogue snapshot/,
  );
});

test('release coverage rejects a repeated release across otherwise sequential pages', () => {
  const firstPage = {
    ...completePage(),
    totalCount: 2,
    complete: false,
  };
  const first = resolver.mergeCataloguePage(null, firstPage);
  const repeatedSecondPage = {
    ...completePage(),
    offset: 1,
    nextOffset: 2,
    totalCount: 2,
    complete: true,
  };
  assert.throws(
    () => resolver.mergeCataloguePage(first, repeatedSecondPage),
    /release repeated across pages/,
  );
});

test('checkpointed cache rejects recording release relations outside processed release coverage', () => {
  const malformed = {
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    artists: {
      [ARTIST]: {
        artistMbid: ARTIST,
        sourceEntity: 'release',
        nextOffset: 1,
        totalCount: 1,
        complete: true,
        releaseMbids: [RELEASE],
        recordings: [recording({
          releases: [{ releaseMbid: RELEASE_2, title: 'Uncounted Album' }],
        })],
      },
    },
  };
  assert.throws(
    () => resolver.validateCatalogueCache(malformed),
    /references an uncounted release/,
  );
});
