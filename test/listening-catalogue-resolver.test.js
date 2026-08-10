'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const resolver = require('../scripts/listening-catalogue-resolver');

const ARTIST = '11111111-1111-4111-8111-111111111111';
const RECORDING = '22222222-2222-4222-8222-222222222222';
const RECORDING_2 = '33333333-3333-4333-8333-333333333333';
const RELEASE = '44444444-4444-4444-8444-444444444444';
const RELEASE_GROUP = '55555555-5555-4555-8555-555555555555';
const OTHER_ARTIST = '66666666-6666-4666-8666-666666666666';
const RELEASE_2 = '77777777-7777-4777-8777-777777777777';

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

function musicBrainzRecording(overrides = {}) {
  return {
    id: RECORDING,
    title: 'Exact Song',
    'artist-credit': [{ artist: { id: ARTIST, name: 'Synthetic Artist' } }],
    ...overrides,
  };
}

function musicBrainzRelease(overrides = {}) {
  const recordings = overrides.recordings || [musicBrainzRecording()];
  const release = {
    id: RELEASE,
    title: 'Exact Album',
    'release-group': { id: RELEASE_GROUP, title: 'Exact Album' },
    media: [{
      position: 1,
      tracks: recordings.map((value, index) => ({
        id: `track-${index + 1}`,
        position: index + 1,
        recording: value,
      })),
    }],
    futureReleaseField: { keep: true },
    ...overrides,
  };
  delete release.recordings;
  return release;
}

function musicBrainzPage({ offset = 0, total = 1, releases = [musicBrainzRelease()] } = {}) {
  return {
    'release-offset': offset,
    'release-count': total,
    releases,
    futurePageField: { keep: true },
  };
}

function identityRecord(status, providers = {}) {
  const workKey = 'spotify:SyntheticSpotifyTrack1';
  return {
    kind: 'livevault-track-identities',
    schemaVersion: 1,
    records: {
      [workKey]: {
        workKey,
        spotifyTrackId: 'SyntheticSpotifyTrack1',
        localBandId: 'band-1',
        status,
        providers,
        futureField: { keep: true },
      },
    },
  };
}

test('strong artist + track + one release becomes tier B without changing the legacy Spotify planner state', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  assert.equal(evidence.items[0].evidenceTier, 'B');
  assert.equal(evidence.items[0].releaseLookupName, 'Exact Album');
  assert.equal(evidence.items[0].status, 'needs_spotify');
  assert.equal(evidence.tierCounts.B, 1);
});

test('exact Spotify track URLs are derived locally with zero provider dependency', () => {
  assert.equal(
    resolver.spotifyTrackUrlFromId('SyntheticSpotifyTrack1'),
    'https://open.spotify.com/track/SyntheticSpotifyTrack1',
  );
  assert.equal(resolver.spotifyTrackUrlFromId('bad/id'), null);
  assert.equal(resolver.spotifyTrackUrlFromId(''), null);
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  assert.equal(evidence.items[0].spotifyTrackUrl, 'https://open.spotify.com/track/SyntheticSpotifyTrack1');
});

test('missing or conflicting release text becomes tier C rather than being guessed', () => {
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

test('trusted source release identity strengthens tier B and must match the exact catalogue release', () => {
  const evidence = resolver.buildCatalogueEvidence({
    bands: [band()],
    events: [event({ releaseTitle: null, musicbrainzReleaseId: RELEASE })],
  });
  assert.equal(evidence.items[0].evidenceTier, 'B');
  assert.equal(evidence.items[0].sourceMusicbrainzReleaseMbid, RELEASE);

  const exact = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: cache([recording()]) });
  assert.equal(exact.results[0].status, 'resolved');
  assert.equal(exact.results[0].reason, 'catalogue_exact_recording_release_identity');

  const wrongEdition = resolver.resolveCatalogueEvidence({
    evidence,
    catalogueCache: cache([recording({ releases: [{ releaseMbid: RELEASE_2, title: 'Exact Album' }] })]),
  });
  assert.equal(wrongEdition.results[0].status, 'unresolved');
  assert.equal(wrongEdition.results[0].reason, 'catalogue_release_mismatch');
});

test('generic future releaseMbid is not silently claimed as MusicBrainz-owned evidence', () => {
  const evidence = resolver.buildCatalogueEvidence({
    bands: [band()],
    events: [event({ releaseTitle: null, releaseMbid: RELEASE })],
  });
  assert.equal(evidence.items[0].sourceMusicbrainzReleaseMbid, null);
  assert.equal(evidence.items[0].evidenceTier, 'C');
});

test('conflicting trusted source release identities are quarantined as tier E', () => {
  const evidence = resolver.buildCatalogueEvidence({
    bands: [band()],
    events: [
      event({ musicbrainzReleaseId: RELEASE }),
      event({ stableListenId: 'listen-2', musicbrainzReleaseId: RELEASE_2 }),
    ],
  });
  assert.equal(evidence.items[0].sourceReleaseIdentityConflict, true);
  assert.equal(evidence.items[0].evidenceTier, 'E');
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

test('durable terminal and retry states remain held from catalogue and bridge automation', () => {
  for (const status of ['needs_review', 'retry', 'error', 'no_match']) {
    const trackIdentities = identityRecord(status);
    const before = structuredClone(trackIdentities);
    const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()], trackIdentities });
    assert.equal(evidence.items[0].evidenceTier, 'E');
    assert.equal(evidence.items[0].routingHoldReason, `durable_identity_${status}`);
    const catalogueCache = cache([recording()]);
    const local = resolver.resolveCatalogueEvidence({ evidence, catalogueCache });
    assert.equal(local.results[0].status, 'exception');
    assert.equal(local.results[0].reason, `durable_identity_${status}`);
    const batch = resolver.planListenBrainzBatchBridge({ evidence, catalogueCache, localResults: local });
    assert.equal(batch.count, 0);
    assert.equal(batch.skipped.notUnresolvedLocally, 1);
    assert.deepEqual(trackIdentities, before);
  }
});

test('provider-level terminal retry and unknown states remain held even when root status is unresolved', () => {
  for (const status of ['needs_review', 'retry', 'error', 'no_match', 'future_status']) {
    const trackIdentities = identityRecord('unresolved', {
      musicbrainz: { status, reason: 'synthetic', checkedAt: '2026-08-10T00:00:00.000Z' },
    });
    const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()], trackIdentities });
    assert.equal(evidence.items[0].evidenceTier, 'E');
    assert.equal(
      evidence.items[0].routingHoldReason,
      status === 'future_status' ? 'durable_provider_musicbrainz_unknown_status' : `durable_provider_musicbrainz_${status}`,
    );
  }
});

test('malformed provider containers and entries fail closed into held evidence', () => {
  const malformedContainer = identityRecord('unresolved');
  malformedContainer.records['spotify:SyntheticSpotifyTrack1'].providers = [];
  const containerEvidence = resolver.buildCatalogueEvidence({
    bands: [band()], events: [event()], trackIdentities: malformedContainer,
  });
  assert.equal(containerEvidence.items[0].evidenceTier, 'E');

  const malformedEntry = identityRecord('unresolved', { musicbrainz: {} });
  const entryEvidence = resolver.buildCatalogueEvidence({
    bands: [band()], events: [event()], trackIdentities: malformedEntry,
  });
  assert.equal(entryEvidence.items[0].evidenceTier, 'E');
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

test('malformed tier B evidence cannot fall back to title-only resolution', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const item = { ...evidence.items[0], normalizedReleaseTitle: null, sourceMusicbrainzReleaseMbid: null };
  const result = resolver.resolveFromCatalogue(item, cache([recording()]));
  assert.equal(result.status, 'exception');
  assert.equal(result.reason, 'invalid_tier_b_release_evidence');
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
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  assert.throws(
    () => resolver.resolveCatalogueEvidence({
      evidence,
      catalogueCache: cache([recording({ artistMbids: [OTHER_ARTIST] })]),
    }),
    /outside artist boundary/,
  );
});

test('MusicBrainz catalogue pages normalize supported release-browse pagination without provider side effects', () => {
  const firstPayload = musicBrainzPage({
    total: 2,
    releases: [musicBrainzRelease({
      recordings: [
        musicBrainzRecording(),
        musicBrainzRecording({ id: RECORDING_2, title: 'Second Song' }),
      ],
    })],
  });
  const before = structuredClone(firstPayload);
  const first = resolver.parseMusicBrainzCataloguePage({ artistMbid: ARTIST, payload: firstPayload, expectedOffset: 0 });
  assert.deepEqual(firstPayload, before);
  assert.equal(first.sourceEntity, 'release');
  assert.equal(first.releaseCount, 1);
  assert.equal(first.recordings.length, 2);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.totalCount, 2);
  assert.equal(first.complete, false);
  assert.equal(first.recordings[0].releases[0].releaseMbid, RELEASE);

  const initial = resolver.mergeCataloguePage(null, first);
  assert.equal(initial.artists[ARTIST].nextOffset, 1);
  assert.equal(initial.artists[ARTIST].recordings.length, 2);
  assert.equal(initial.artists[ARTIST].complete, false);

  const secondRelease = musicBrainzRelease({
    id: RELEASE_2,
    title: 'Second Album',
    'release-group': { id: RELEASE_GROUP },
    recordings: [musicBrainzRecording()],
  });
  const second = resolver.parseMusicBrainzCataloguePage({
    artistMbid: ARTIST,
    payload: musicBrainzPage({ offset: 1, total: 2, releases: [secondRelease] }),
    expectedOffset: 1,
  });
  const completed = resolver.mergeCataloguePage(initial, second);
  assert.equal(completed.artists[ARTIST].recordings.length, 2);
  assert.equal(completed.artists[ARTIST].recordings.find((row) => row.recordingMbid === RECORDING).releases.length, 2);
  assert.equal(completed.artists[ARTIST].nextOffset, 2);
  assert.equal(completed.artists[ARTIST].complete, true);
});

test('MusicBrainz release browsing ignores valid other-artist tracks but fails closed on malformed provider rows', () => {
  const mixed = resolver.parseMusicBrainzCataloguePage({
    artistMbid: ARTIST,
    payload: musicBrainzPage({ releases: [musicBrainzRelease({
      recordings: [
        musicBrainzRecording(),
        musicBrainzRecording({ id: RECORDING_2, 'artist-credit': [{ artist: { id: OTHER_ARTIST } }] }),
      ],
    })] }),
  });
  assert.equal(mixed.recordings.length, 1);
  assert.equal(mixed.recordings[0].recordingMbid, RECORDING);

  assert.throws(
    () => resolver.parseMusicBrainzCataloguePage({
      artistMbid: ARTIST,
      payload: musicBrainzPage({ releases: [musicBrainzRelease({ recordings: [{ id: RECORDING, title: 'Broken' }] })] }),
    }),
    /artist credit/,
  );
});

test('MusicBrainz catalogue pagination and total-count drift fail closed', () => {
  assert.throws(
    () => resolver.parseMusicBrainzCataloguePage({ artistMbid: ARTIST, payload: musicBrainzPage({ offset: 1 }), expectedOffset: 0 }),
    /pagination/,
  );
  assert.throws(
    () => resolver.parseMusicBrainzCataloguePage({ artistMbid: ARTIST, payload: musicBrainzPage({ total: 2, releases: [] }) }),
    /pagination/,
  );

  const first = resolver.parseMusicBrainzCataloguePage({ artistMbid: ARTIST, payload: musicBrainzPage({ total: 2 }) });
  const initial = resolver.mergeCataloguePage(null, first);
  const changedTotal = resolver.parseMusicBrainzCataloguePage({
    artistMbid: ARTIST,
    payload: musicBrainzPage({
      offset: 1,
      total: 3,
      releases: [musicBrainzRelease({ id: RELEASE_2 })],
    }),
    expectedOffset: 1,
  });
  assert.throws(() => resolver.mergeCataloguePage(initial, changedTotal), /total count changed/);
});

test('duplicate provider releases fail closed while repeated recordings across releases merge safely', () => {
  assert.throws(
    () => resolver.parseMusicBrainzCataloguePage({
      artistMbid: ARTIST,
      payload: musicBrainzPage({ total: 2, releases: [musicBrainzRelease(), musicBrainzRelease()] }),
    }),
    /Duplicate MusicBrainz release identity/,
  );

  const page = resolver.parseMusicBrainzCataloguePage({
    artistMbid: ARTIST,
    payload: musicBrainzPage({
      total: 2,
      releases: [
        musicBrainzRelease(),
        musicBrainzRelease({ id: RELEASE_2, title: 'Second Album' }),
      ],
    }),
  });
  assert.equal(page.recordings.length, 1);
  assert.equal(page.recordings[0].releases.length, 2);
});

test('catalogue cache rejects duplicate recording and release rows', () => {
  const duplicateRelease = cache([recording({
    releases: [
      { releaseMbid: RELEASE, title: 'Exact Album' },
      { releaseMbid: RELEASE, title: 'Exact Album Duplicate' },
    ],
  })]);
  assert.throws(() => resolver.validateCatalogueCache(duplicateRelease), /Duplicate catalogue release identity/);

  const duplicateRecording = cache([recording(), recording()]);
  assert.throws(() => resolver.validateCatalogueCache(duplicateRecording), /Duplicate catalogue recording identity/);
});

test('catalogue checkpoints reject inconsistent completion state', () => {
  assert.deepEqual(
    resolver.normalizeCatalogueCheckpoint({ artistMbid: ARTIST, nextOffset: 1, totalCount: 2, complete: false }),
    { schemaVersion: 1, artistMbid: ARTIST, nextOffset: 1, totalCount: 2, complete: false },
  );
  assert.throws(
    () => resolver.normalizeCatalogueCheckpoint({ artistMbid: ARTIST, nextOffset: 1, totalCount: 2, complete: true }),
    /Invalid catalogue checkpoint/,
  );
});

test('unresolved eligible items become bounded tier D batch-bridge candidates', () => {
  const evidence = resolver.buildCatalogueEvidence({
    bands: [band()],
    events: [
      event(),
      event({ stableListenId: 'listen-2', spotifyTrackId: 'SyntheticSpotifyTrack2', recordingTitle: 'Second Song', releaseTitle: null }),
    ],
  });
  const catalogueCache = cache([]);
  const local = resolver.resolveCatalogueEvidence({ evidence, catalogueCache });
  const batch = resolver.planListenBrainzBatchBridge({ evidence, catalogueCache, localResults: local, maxItems: 1 });
  assert.equal(batch.count, 1);
  assert.equal(batch.items[0].evidenceTier, 'D');
  assert.equal(batch.items[0].trustedMusicbrainzArtistMbid, ARTIST);
  assert.equal(batch.skipped.overflow, 1);
});

test('batch bridge recomputes current catalogue state and rejects stale supplied results', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const catalogueCache = cache([]);
  const currentPlan = resolver.planListenBrainzBatchBridge({ evidence, catalogueCache });
  assert.equal(currentPlan.count, 1);

  const local = resolver.resolveCatalogueEvidence({ evidence, catalogueCache });
  local.results = [];
  assert.throws(
    () => resolver.planListenBrainzBatchBridge({ evidence, catalogueCache, localResults: local }),
    /Stale catalogue resolution results/,
  );
});

test('locally resolved and ambiguous items are excluded from the ListenBrainz batch bridge', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const resolvedCache = cache([recording()]);
  const resolved = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: resolvedCache });
  const resolvedBatch = resolver.planListenBrainzBatchBridge({ evidence, catalogueCache: resolvedCache, localResults: resolved });
  assert.equal(resolvedBatch.count, 0);
  assert.equal(resolvedBatch.skipped.resolvedLocally, 1);

  const ambiguousCache = cache([recording(), recording({ recordingMbid: RECORDING_2 })]);
  const ambiguous = resolver.resolveCatalogueEvidence({ evidence, catalogueCache: ambiguousCache });
  const ambiguousBatch = resolver.planListenBrainzBatchBridge({ evidence, catalogueCache: ambiguousCache, localResults: ambiguous });
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
});

test('invalid and duplicate evidence documents fail closed', () => {
  assert.throws(
    () => resolver.resolveCatalogueEvidence({ evidence: null, catalogueCache: cache([]) }),
    /Invalid catalogue evidence/,
  );
  const result = resolver.resolveFromCatalogue(null, cache([]));
  assert.equal(result.status, 'exception');
  assert.equal(result.reason, 'invalid_evidence_item');

  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  evidence.items.push(structuredClone(evidence.items[0]));
  assert.throws(() => resolver.validateEvidenceDocument(evidence), /Duplicate catalogue evidence item/);
});

test('invalid local result statuses cannot be treated as unresolved work', () => {
  assert.throws(
    () => resolver.validateLocalResults({
      schemaVersion: 1,
      results: [{ trackKey: 'synthetic-key', evidenceTier: 'B', status: 'future_status' }],
    }),
    /Invalid catalogue resolution result/,
  );
});

test('aggregate diagnostics expose counts only', () => {
  const evidence = resolver.buildCatalogueEvidence({ bands: [band()], events: [event()] });
  const catalogueCache = cache([]);
  const local = resolver.resolveCatalogueEvidence({ evidence, catalogueCache });
  const batch = resolver.planListenBrainzBatchBridge({ evidence, catalogueCache, localResults: local });
  const diagnostics = resolver.safeResolverDiagnostics({ evidence, localResults: local, batchPlan: batch });
  const serialized = JSON.stringify(diagnostics);
  assert.equal(diagnostics.tiers.B, 1);
  assert.equal(diagnostics.tiers.D, 1);
  assert.doesNotMatch(serialized, /Synthetic Artist|Exact Song|SyntheticSpotifyTrack1|11111111/);
});
