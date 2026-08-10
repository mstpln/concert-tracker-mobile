'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../scripts/listening-catalogue-resolver');

const ARTIST = '11111111-1111-4111-8111-111111111111';
const RECORDING = '22222222-2222-4222-8222-222222222222';
const RECORDING_2 = '33333333-3333-4333-8333-333333333333';
const RELEASE = '44444444-4444-4444-8444-444444444444';
const RELEASE_GROUP = '55555555-5555-4555-8555-555555555555';

function band() {
  return {
    id: 'band-1',
    name: 'Synthetic Artist',
    musicbrainz: {
      mbid: ARTIST,
      status: 'manual_confirmed',
      spotify: { id: 'SyntheticSpotifyArtist1', status: 'manual_confirmed' },
    },
  };
}

function event(overrides = {}) {
  return {
    stableListenId: 'listen-1',
    bandId: 'band-1',
    artistCreditName: 'Synthetic Artist',
    recordingTitle: 'Exact Song',
    releaseTitle: 'Exact Album',
    spotifyTrackId: 'SyntheticSpotifyTrack1',
    source: 'spotify_import',
    ...overrides,
  };
}

function cache(recordings = []) {
  return {
    kind: resolver.CACHE_KIND,
    schemaVersion: resolver.CACHE_SCHEMA_VERSION,
    futureRoot: { keep: true },
    artists: {
      [ARTIST]: {
        artistMbid: ARTIST,
        futureArtistField: { keep: true },
        recordings,
      },
    },
  };
}

function recording(overrides = {}) {
  return {
    recordingMbid: RECORDING,
    title: 'Exact Song',
    artistMbids: [ARTIST],
    releases: [{
      releaseMbid: RELEASE,
      releaseGroupMbid: RELEASE_GROUP,
      title: 'Exact Album',
      futureReleaseField: { keep: true },
    }],
    futureRecordingField: { keep: true },
    ...overrides,
  };
}

test('strong artist + track + one release becomes tier B without changing the legacy Spotify planner state', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  assert.equal(evidence.items[0].evidenceTier, 'B');
  assert.equal(evidence.items[0].releaseLookupName, 'Exact Album');
  assert.equal(evidence.items[0].status, 'needs_spotify');
  assert.equal(evidence.tierCounts.B, 1);
});

test('missing or conflicting release evidence becomes tier C rather than being guessed', () => {
  const missing = resolver.buildCatalogueEvidence({ bands: [band()], events: [event({ releaseTitle: null })] });
  assert.equal(missing.items[0].evidenceTier, 'C');
  assert.equal(missing.items[0].releaseLookupName, null);

  const conflicting = resolver.buildCatalogueEvidence({
    bands: [band()],
    events: [
      event(),
      event({ stableListenId: 'listen-2', releaseTitle: 'Different Album' }),
    ],
  });
  assert.equal(conflicting.items[0].evidenceTier, 'C');
  assert.equal(conflicting.items[0].releaseLookupConflict, true);
  assert.equal(conflicting.items[0].releaseLookupName, null);
});

test('existing recording identity remains tier A and never requires catalogue resolution', () => {
  const evidence = resolver.buildCatalogueEvidence({
    bands: [band()],
    events: [event({ spotifyTrackId: null, musicbrainzRecordingId: RECORDING, musicbrainzArtistIds: [ARTIST] })],
  });
  assert.equal(evidence.items[0].evidenceTier, 'A');
  const result = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: cache([]) });
  assert.equal(result.results[0].status, 'complete');
  assert.equal(result.counts.alreadyComplete, 1);
});

test('tier B resolves only one exact artist + recording + release candidate', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const result = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: cache([recording()]) });
  assert.equal(result.results[0].status, 'resolved');
  assert.equal(result.results[0].musicbrainzRecordingMbid, RECORDING);
  assert.equal(result.results[0].reason, 'catalogue_exact_recording_release');
  assert.equal(result.results[0].evidenceClass, 'deterministic_local_match');
});

test('version qualifiers remain identity-significant under exact normalization', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const result = resolver.resolveCatalogueEvidence({
    evidence,
    catalogueCache: cache([recording({ title: 'Exact Song (Live)' })]),
  });
  assert.equal(result.results[0].status, 'unresolved');
  assert.equal(result.results[0].reason, 'catalogue_no_match');
});

test('tier B release mismatch stays unresolved and never manufactures release identity', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const result = resolver.resolveCatalogueEvidence({
    evidence,
    catalogueCache: cache([recording({ releases: [{ releaseMbid: RELEASE, title: 'Other Album' }] })]),
  });
  assert.equal(result.results[0].status, 'unresolved');
  assert.equal(result.results[0].reason, 'catalogue_release_mismatch');
  assert.equal(Object.hasOwn(result.results[0], 'releaseMbid'), false);
});

test('multiple compatible recording MBIDs remain ambiguous', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const result = resolver.resolveCatalogueEvidence({
    evidence,
    catalogueCache: cache([
      recording(),
      recording({ recordingMbid: RECORDING_2 }),
    ]),
  });
  assert.equal(result.results[0].status, 'ambiguous');
  assert.equal(result.results[0].reason, 'multiple_compatible_recordings');
});

test('tier C may resolve only a unique exact-title recording for the trusted artist', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event({ releaseTitle: null })] });
  const unique = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: cache([recording()]) });
  assert.equal(unique.results[0].status, 'resolved');
  assert.equal(unique.results[0].reason, 'catalogue_unique_recording_title');

  const ambiguous = resolver.resolveCatalogueEvidence({
    evidence,
    catalogueCache: cache([recording(), recording({ recordingMbid: RECORDING_2 })]),
  });
  assert.equal(ambiguous.results[0].status, 'ambiguous');
});

test('trusted MusicBrainz artist boundary rejects same-title recordings by another artist', () => {
  const OTHER_ARTIST = '66666666-6666-4666-8666-666666666666';
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const result = resolver.resolveCatalogueEvidence({
    evidence,
    catalogueCache: cache([recording({ artistMbids: [OTHER_ARTIST] })]),
  });
  assert.equal(result.results[0].status, 'unresolved');
  assert.equal(result.results[0].reason, 'catalogue_no_match');
});

test('unresolved eligible items become bounded tier D batch-bridge candidates', () => {
  const evidence = resolver.buildCatalogueEvidence({
    bands: [band()],
    events: [
      event(),
      event({ stableListenId: 'listen-2', spotifyTrackId: 'SyntheticSpotifyTrack2', recordingTitle: 'Second Song', releaseTitle: null }),
    ],
  });
  const local = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: cache([]) });
  const batch = resolver.planListenBrainzBatchBridge({ evidence, localResults: local, maxItems: 1 });
  assert.equal(batch.count, 1);
  assert.equal(batch.items[0].evidenceTier, 'D');
  assert.equal(batch.items[0].trustedMusicbrainzArtistMbid, ARTIST);
  assert.equal(batch.skipped.overflow, 1);
});

test('locally resolved and ambiguous items are excluded from the ListenBrainz batch bridge', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const resolved = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: cache([recording()]) });
  const resolvedBatch = resolver.planListenBrainzBatchBridge({ evidence, localResults: resolved });
  assert.equal(resolvedBatch.count, 0);
  assert.equal(resolvedBatch.skipped.resolvedLocally, 1);

  const ambiguous = resolver.resolveCatalogueEvidence({
    evidence,
    catalogueCache: cache([recording(), recording({ recordingMbid: RECORDING_2 })]),
  });
  const ambiguousBatch = resolver.planListenBrainzBatchBridge({ evidence, localResults: ambiguous });
  assert.equal(ambiguousBatch.count, 0);
  assert.equal(ambiguousBatch.skipped.ambiguous, 1);
});

test('cache validation is fail-closed but does not mutate unknown future fields', () => {
  const input = cache([recording()]);
  const before = structuredClone(input);
  assert.equal(resolver.validateCatalogueCache(input), input);
  assert.deepEqual(input, before);

  const invalid = cache([recording({ recordingMbid: 'not-an-mbid' })]);
  assert.throws(() => resolver.validateCatalogueCache(invalid), /Invalid catalogue recording identity/);

  const duplicate = cache([recording(), recording()]);
  assert.throws(() => resolver.validateCatalogueCache(duplicate), /Duplicate catalogue recording identity/);
});

test('invalid evidence items fail closed instead of being marked complete', () => {
  const result = resolver.resolveFromCatalogue(null, cache([]));
  assert.equal(result.status, 'exception');
  assert.equal(result.reason, 'invalid_evidence_item');
});

test('aggregate diagnostics expose counts only', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const local = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: cache([]) });
  const batch = resolver.planListenBrainzBatchBridge({ evidence, localResults: local });
  const diagnostics = resolver.safeResolverDiagnostics({ evidence, localResults: local, batchPlan: batch });
  const serialized = JSON.stringify(diagnostics);
  assert.equal(diagnostics.tiers.B, 1);
  assert.equal(diagnostics.tiers.D, 1);
  assert.doesNotMatch(serialized, /Synthetic Artist|Exact Song|SyntheticSpotifyTrack1|11111111/);
});
