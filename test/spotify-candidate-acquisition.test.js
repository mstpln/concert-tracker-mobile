'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const acquisition = require('../scripts/spotify-candidate-acquisition');

function band(overrides = {}) {
  return {
    id: 'band-1',
    name: 'Synthetic Artist',
    userNote: 'preserve me',
    unknownFutureField: { keep: true },
    musicbrainz: {
      mbid: '11111111-2222-4333-8444-555555555555',
      status: 'confirmed',
      metadata: { artistName: 'Synthetic Artist', aliases: ['Synthetic'] },
      spotify: { status: 'unchecked', reviewCandidates: [] },
      unrelatedProvider: { future: true },
    },
    ...overrides,
  };
}

function fakeUsage({ callsAllowed = 100 } = {}) {
  let calls = 0;
  return {
    state: { spotify: { callsThisRun: 0 } },
    canCallSpotify() { return calls < callsAllowed; },
    async recordSpotifyCall() { calls += 1; this.state.spotify.callsThisRun += 1; },
    finishProviderIdentityRun(summary) { this.finished = summary; },
    async save() { this.saved = true; },
  };
}

test('single resolver match is converted to review-only candidate instead of confirmation', () => {
  const prior = { status: 'unchecked', reviewCandidates: [] };
  const record = acquisition.buildCandidateRecord(prior, [{
    id: 'spotify-1',
    artistName: 'Synthetic Artist',
    url: 'https://open.spotify.com/artist/spotify-1',
  }], '2026-08-06T05:00:00.000Z');

  assert.equal(record.status, 'needs_review');
  assert.equal(record.id, null);
  assert.equal(record.matchMethod, null);
  assert.deepEqual(record.reviewCandidates.map((candidate) => candidate.id), ['spotify-1']);
  assert.equal(record.candidateAcquisition.method, 'review_only');
});

test('candidate merge is additive, deterministic and idempotent', () => {
  const existing = [{ id: 'b', artistName: 'Old B', unknown: 'keep' }];
  const incoming = [
    { id: 'a', artistName: 'A' },
    { id: 'b', artistName: 'New B', popularity: 7 },
    { id: 'a', artistName: 'Duplicate A' },
  ];
  const once = acquisition.mergeCandidateLists(existing, incoming);
  const twice = acquisition.mergeCandidateLists(once, incoming);
  assert.deepEqual(once.map((candidate) => candidate.id), ['a', 'b']);
  assert.deepEqual(twice, once);
  assert.equal(once[1].artistName, 'New B');
});

test('manual decisions and confirmed identities are never overwritten', () => {
  const confirmed = band({ musicbrainz: { ...band().musicbrainz, spotify: { id: 'trusted', status: 'manual_confirmed' } } });
  const rejected = band({ id: 'band-2', musicbrainz: { ...band().musicbrainz, spotify: { status: 'manual_rejected' } } });
  const updates = [
    { bandId: 'band-1', priorFingerprint: acquisition.fingerprint(confirmed.musicbrainz.spotify), candidates: [{ id: 'candidate-1' }], acquiredAt: '2026-08-06T05:00:00.000Z' },
    { bandId: 'band-2', priorFingerprint: acquisition.fingerprint(rejected.musicbrainz.spotify), candidates: [{ id: 'candidate-2' }], acquiredAt: '2026-08-06T05:00:00.000Z' },
  ];
  const result = acquisition.mergeCandidateUpdates([confirmed, rejected], updates);
  assert.equal(result.applied, 0);
  assert.equal(result.bands[0].musicbrainz.spotify.id, 'trusted');
  assert.equal(result.bands[1].musicbrainz.spotify.status, 'manual_rejected');
});

test('stale rows are skipped and deleted bands are not recreated', () => {
  const current = band({ musicbrainz: { ...band().musicbrainz, spotify: { status: 'needs_review', reviewCandidates: [{ id: 'newer' }] } } });
  const updates = [
    { bandId: 'band-1', priorFingerprint: acquisition.fingerprint({ status: 'unchecked', reviewCandidates: [] }), candidates: [{ id: 'older' }], acquiredAt: '2026-08-06T05:00:00.000Z' },
    { bandId: 'deleted-band', priorFingerprint: acquisition.fingerprint(null), candidates: [{ id: 'ghost' }], acquiredAt: '2026-08-06T05:00:00.000Z' },
  ];
  const result = acquisition.mergeCandidateUpdates([current], updates);
  assert.equal(result.applied, 0);
  assert.equal(result.stale, 1);
  assert.equal(result.bands.length, 1);
  assert.deepEqual(result.bands[0].musicbrainz.spotify.reviewCandidates, [{ id: 'newer' }]);
});

test('successful acquisition preserves user-owned, unrelated and future fields', async () => {
  const initial = [band()];
  let reads = 0;
  let written = null;
  const usage = fakeUsage();
  const summary = await acquisition.runSpotifyCandidateAcquisition({
    readBands: async () => { reads += 1; return JSON.parse(JSON.stringify(initial)); },
    writeBands: async (_filename, value) => { written = value; },
    loadUsage: async () => usage,
    resolveArtistIdentity: async () => ({
      kind: 'confirmed',
      identity: {
        id: 'spotify-1',
        artistName: 'Synthetic Artist',
        url: 'https://open.spotify.com/artist/spotify-1',
      },
    }),
    now: '2026-08-06T05:00:00.000Z',
    log: () => {},
  });

  assert.equal(reads, 2);
  assert.equal(summary.bandsUpdated, 1);
  assert.equal(written[0].userNote, 'preserve me');
  assert.deepEqual(written[0].unknownFutureField, { keep: true });
  assert.deepEqual(written[0].musicbrainz.unrelatedProvider, { future: true });
  assert.equal(written[0].musicbrainz.spotify.status, 'needs_review');
  assert.equal(written[0].musicbrainz.spotify.id, null);
  assert.equal(usage.saved, true);
});

test('band cap bounds the run and no-candidate results do not write bands', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => band({ id: `band-${index + 1}` }));
  let resolves = 0;
  let writes = 0;
  const summary = await acquisition.runSpotifyCandidateAcquisition({
    readBands: async () => JSON.parse(JSON.stringify(rows)),
    writeBands: async () => { writes += 1; },
    loadUsage: async () => fakeUsage(),
    resolveArtistIdentity: async () => { resolves += 1; return { kind: 'no_match', identity: { status: 'no_match', reviewCandidates: [] } }; },
    bandCap: 2,
    log: () => {},
  });
  assert.equal(resolves, 2);
  assert.equal(summary.considered, 2);
  assert.equal(summary.noCandidate, 2);
  assert.equal(writes, 0);
});

test('eligibility excludes untrusted MusicBrainz rows and existing review candidates', () => {
  assert.equal(acquisition.candidateAcquisitionEligible(band()), true);
  assert.equal(acquisition.candidateAcquisitionEligible(band({ musicbrainz: { status: 'unchecked' } })), false);
  assert.equal(acquisition.candidateAcquisitionEligible(band({ musicbrainz: { ...band().musicbrainz, spotify: { status: 'needs_review', reviewCandidates: [{ id: 'existing' }] } } })), false);
});
