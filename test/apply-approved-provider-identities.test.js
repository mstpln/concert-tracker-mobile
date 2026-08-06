'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APPROVED_IDENTITIES,
  applyApprovedIdentities,
  runApprovedProviderIdentityUpdate,
} = require('../scripts/apply-approved-provider-identities');

function band(mapping, extra = {}) {
  return {
    id: `band-${mapping.spotifyId}`,
    name: mapping.name,
    favorite: true,
    unknownFutureField: { preserved: true },
    musicbrainz: {
      existingUnknown: 'keep',
      spotify: {
        reviewCandidates: [{ id: mapping.spotifyId, providerExtra: 'keep' }],
        spotifyUnknown: 'keep',
      },
    },
    ...extra,
  };
}

test('applies all five approved identities and preserves unrelated and unknown fields', () => {
  const source = APPROVED_IDENTITIES.map((mapping) => band(mapping));
  source.push({ id: 'other', name: 'Other Band', notes: 'untouched' });
  const result = applyApprovedIdentities(source, APPROVED_IDENTITIES, { reviewedAt: '2026-08-06T07:00:00.000Z' });
  assert.equal(result.matched, 5);
  assert.equal(result.changed, 5);
  assert.equal(result.bands.at(-1), source.at(-1));
  for (const mapping of APPROVED_IDENTITIES) {
    const updated = result.bands.find((item) => item.name === mapping.name);
    assert.equal(updated.musicbrainz.mbid, mapping.musicbrainzId);
    assert.equal(updated.musicbrainz.status, 'manual_confirmed');
    assert.equal(updated.musicbrainz.spotify.id, mapping.spotifyId);
    assert.equal(updated.musicbrainz.spotify.status, 'manual_confirmed');
    assert.equal(updated.musicbrainz.spotify.url, `https://open.spotify.com/artist/${mapping.spotifyId}`);
    assert.deepEqual(updated.unknownFutureField, { preserved: true });
    assert.equal(updated.musicbrainz.existingUnknown, 'keep');
    assert.equal(updated.musicbrainz.spotify.spotifyUnknown, 'keep');
    assert.equal(updated.musicbrainz.spotify.reviewCandidates[0].providerExtra, 'keep');
  }
});

test('fails closed when a target name is absent or duplicated', () => {
  const source = APPROVED_IDENTITIES.map((mapping) => band(mapping));
  assert.throws(() => applyApprovedIdentities(source.slice(1)), /exactly one band/);
  assert.throws(() => applyApprovedIdentities([...source, { ...source[0], id: 'duplicate' }]), /exactly one band/);
});

test('fails closed on an existing conflicting confirmed identity', () => {
  const source = APPROVED_IDENTITIES.map((mapping, index) => band(mapping, index === 0 ? {
    musicbrainz: {
      mbid: '00000000-0000-0000-0000-000000000000',
      status: 'manual_confirmed',
      spotify: {},
    },
  } : {}));
  assert.throws(() => applyApprovedIdentities(source), /conflicts with an existing confirmed identity/);
});

test('fails closed when an approved provider ID is confirmed on another band', () => {
  const source = APPROVED_IDENTITIES.map((mapping) => band(mapping));
  source.push({
    id: 'other',
    name: 'Other Band',
    musicbrainz: {
      mbid: APPROVED_IDENTITIES[0].musicbrainzId,
      status: 'manual_confirmed',
      spotify: { id: APPROVED_IDENTITIES[0].spotifyId, status: 'manual_confirmed' },
    },
  });
  assert.throws(() => applyApprovedIdentities(source), /already confirmed on another band/);
});

test('is idempotent and does not write when all identities already match', async () => {
  const prepared = applyApprovedIdentities(
    APPROVED_IDENTITIES.map((mapping) => band(mapping)),
    APPROVED_IDENTITIES,
    { reviewedAt: '2026-08-06T07:00:00.000Z' },
  ).bands;
  let writes = 0;
  const summary = await runApprovedProviderIdentityUpdate({
    readBands: async () => prepared,
    writeBandsStrict: async () => { writes += 1; },
    reviewedAt: '2026-08-06T08:00:00.000Z',
    log: () => {},
  });
  assert.deepEqual(summary, { matched: 5, changed: 0 });
  assert.equal(writes, 0);
});

test('writes exactly once through the strict conditional writer', async () => {
  let writes = 0;
  let written;
  const summary = await runApprovedProviderIdentityUpdate({
    readBands: async () => APPROVED_IDENTITIES.map((mapping) => band(mapping)),
    writeBandsStrict: async (filename, data) => {
      writes += 1;
      assert.equal(filename, 'bands.json');
      written = data;
    },
    reviewedAt: '2026-08-06T07:00:00.000Z',
    log: () => {},
  });
  assert.deepEqual(summary, { matched: 5, changed: 5 });
  assert.equal(writes, 1);
  assert.equal(written.length, 5);
});

test('production workflow remains manual, main-only, least-privilege and serialized', () => {
  const source = fs.readFileSync('.github/workflows/apply-approved-provider-identities.yml', 'utf8');
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /schedule:/);
  assert.match(source, /APPLY_APPROVED_IDENTITIES/);
  assert.match(source, /github\.ref == 'refs\/heads\/main'/);
  assert.match(source, /contents: read/);
  assert.match(source, /group: live-vault-data-writes/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /CF_WORKER_TOKEN/);
  assert.doesNotMatch(source, /SPOTIFY_CLIENT_SECRET|MUSICBRAINZ/);
});
