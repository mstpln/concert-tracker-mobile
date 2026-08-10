'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../scripts/listening-catalogue-resolver');

const ARTIST = '11111111-1111-4111-8111-111111111111';
const RECORDING = '22222222-2222-4222-8222-222222222222';

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

test('forged tier A evidence cannot claim an incomplete item is already complete', () => {
  const item = { ...minimalEvidence('B').items[0], evidenceTier: 'A' };
  const outcome = resolver.resolveFromCatalogue(item, null);
  assert.equal(outcome.status, 'exception');
  assert.equal(outcome.reason, 'invalid_tier_a_evidence');
});

test('batch bridge rejects a stale local result from a different evidence tier', () => {
  const evidence = minimalEvidence('B');
  const localResults = {
    schemaVersion: 1,
    results: [{
      trackKey: evidence.items[0].trackKey,
      evidenceTier: 'C',
      status: 'unresolved',
      reason: 'catalogue_missing',
    }],
  };
  const plan = resolver.planListenBrainzBatchBridge({ evidence, localResults });
  assert.equal(plan.count, 0);
  assert.equal(plan.skipped.notUnresolvedLocally, 1);
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
        recordings: [{
          recordingMbid: RECORDING,
          title: 'Exact Song',
          artistMbids: [ARTIST],
          releases: [],
        }],
      },
    },
  };
  assert.equal(resolver.validateCatalogueCache(cache), cache);
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
