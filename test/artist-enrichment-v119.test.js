'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const gau3 = require('../providerIdentityState').artistEnrichment;
const security = require('../securityHardening');

function spotifyBand(overrides = {}) {
  return {
    id: 'synthetic-band',
    name: 'Synthetic Band',
    photoUrl: null,
    bio: null,
    favourite: true,
    muted: false,
    notes: 'keep me',
    futureField: { keep: true },
    musicbrainz: {
      mbid: 'synthetic-mbid',
      status: 'confirmed',
      spotify: {
        id: 'spotify-artist-1',
        status: 'confirmed',
        images: [
          { url: 'https://images.example/artist-640.jpg', width: 640, height: 640 },
          { url: 'https://images.example/artist-320.jpg', width: 320, height: 320 },
        ],
      },
    },
    ...overrides,
  };
}

test('confirmed Spotify identity supplies visible artwork when no manual or official image exists', () => {
  const band = spotifyBand();
  assert.equal(gau3.visibleArtistImageUrl(band), 'https://images.example/artist-640.jpg');
});

test('candidate-only Spotify identity never supplies trusted artwork', () => {
  const band = spotifyBand({ musicbrainz: { status: 'confirmed', spotify: { id: null, status: 'needs_review', reviewCandidates: [{ id: 'candidate', images: [{ url: 'https://images.example/candidate.jpg', width: 640, height: 640 }] }] } } });
  assert.equal(gau3.visibleArtistImageUrl(band), null);
});

test('manual photo always outranks Spotify artwork', () => {
  const band = spotifyBand({ photoUrl: 'https://user.example/manual.jpg' });
  assert.equal(gau3.visibleArtistImageUrl(band), 'https://user.example/manual.jpg');
  gau3.decorateBand(band);
  assert.equal(band.photoUrl, 'https://user.example/manual.jpg');
});

test('existing official-site provider artwork is preserved and remains a safe fallback', () => {
  const band = spotifyBand({
    musicbrainz: { status: 'confirmed', spotify: { id: 'spotify-artist-1', status: 'confirmed', images: [] } },
    officialUrl: 'https://band.example',
    artistArtwork: { officialSite: { url: 'https://band.example/og.jpg', sourceUrl: 'https://band.example', source: 'official_site_og_image' } },
  });
  assert.equal(gau3.visibleArtistImageUrl(band), 'https://band.example/og.jpg');
  assert.equal(gau3.mergeOfficialArtwork(band, 'https://band.example/new.jpg', band.officialUrl, '2026-08-13T00:00:00.000Z'), false);
  assert.equal(band.artistArtwork.officialSite.url, 'https://band.example/og.jpg');
});

test('official artwork from a previous official URL is refreshable and replaceable', () => {
  const band = spotifyBand({
    musicbrainz: { status: 'confirmed', spotify: { id: 'spotify-artist-1', status: 'confirmed', images: [] } },
    officialUrl: 'https://new.example',
    artistArtwork: { officialSite: { url: 'https://old.example/og.jpg', sourceUrl: 'https://old.example', source: 'official_site_og_image', futureField: 'keep' } },
  });
  assert.equal(gau3.officialArtworkUrl(band), null);
  assert.equal(gau3.officialArtworkNeedsRefresh(band), true);
  assert.equal(gau3.enrichmentRetryDue(band, new Date('2026-08-14T00:00:00.000Z')), true);
  assert.equal(gau3.mergeOfficialArtwork(band, 'https://new.example/new-og.jpg', band.officialUrl, '2026-08-14T00:00:00.000Z'), true);
  assert.equal(band.artistArtwork.officialSite.url, 'https://new.example/new-og.jpg');
  assert.equal(band.artistArtwork.officialSite.sourceUrl, 'https://new.example/');
  assert.equal(band.artistArtwork.officialSite.futureField, 'keep');
  assert.equal(gau3.officialArtworkNeedsRefresh(band), false);
});

test('unprovenanced official artwork is hidden and can be repaired without losing unknown fields', () => {
  const band = spotifyBand({
    musicbrainz: { status: 'confirmed', spotify: { id: 'spotify-artist-1', status: 'confirmed', images: [] } },
    officialUrl: 'https://band.example',
    artistArtwork: { officialSite: { url: 'https://band.example/old.jpg', futureField: 'keep' } },
  });
  assert.equal(gau3.officialArtworkUrl(band), null);
  assert.equal(gau3.officialArtworkNeedsRefresh(band), true);
  assert.equal(gau3.mergeOfficialArtwork(band, 'https://band.example/new.jpg', band.officialUrl, '2026-08-14T00:00:00.000Z'), true);
  assert.equal(band.artistArtwork.officialSite.source, 'official_site_og_image');
  assert.equal(band.artistArtwork.officialSite.sourceUrl, 'https://band.example/');
  assert.equal(band.artistArtwork.officialSite.futureField, 'keep');
  assert.equal(gau3.officialArtworkUrl(band), 'https://band.example/new.jpg');
});

test('removing the official URL removes old official-site artwork authority without creating a retry loop', () => {
  const band = spotifyBand({
    musicbrainz: { status: 'confirmed', spotify: { id: 'spotify-artist-1', status: 'confirmed', images: [] } },
    officialUrl: null,
    artistArtwork: { officialSite: { url: 'https://old.example/og.jpg', sourceUrl: 'https://old.example', source: 'official_site_og_image' } },
    artistEnrichment: { status: 'complete', lastAttemptedAt: '2026-08-13T00:00:00.000Z' },
  });
  assert.equal(gau3.officialArtworkUrl(band), null);
  assert.equal(gau3.officialArtworkNeedsRefresh(band), false);
  assert.equal(gau3.enrichmentRetryDue(band, new Date('2026-08-14T00:00:00.000Z')), false);
});

test('generated bio remains separate and visible when no user bio exists', () => {
  const band = spotifyBand();
  gau3.decorateBand(band);
  gau3.applyGeneratedEnrichment(band, { bio: 'Generated biography.' }, '2026-08-13T00:00:00.000Z');
  assert.equal(band.generatedBio, 'Generated biography.');
  assert.equal(band.bio, 'Generated biography.');
  assert.equal(Object.prototype.propertyIsEnumerable.call(band, 'bio'), false);
});

test('user-written bio is never overwritten by generated enrichment', () => {
  const band = spotifyBand({ bio: 'My own description.' });
  gau3.decorateBand(band);
  gau3.applyGeneratedEnrichment(band, { bio: 'Generated replacement.' }, '2026-08-13T00:00:00.000Z');
  assert.equal(band.bio, 'My own description.');
  assert.equal(band.generatedBio, undefined);
});

test('successful provider no-evidence result does not invent enrichment fields', () => {
  const band = spotifyBand({ genre: null, origin: null, formedYear: null });
  gau3.decorateBand(band);
  assert.equal(gau3.applyGeneratedEnrichment(band, { genre: null, origin: ' ', formedYear: '', bio: null }, '2026-08-14T00:00:00.000Z'), false);
  assert.equal(band.genre, null);
  assert.equal(band.origin, null);
  assert.equal(band.formedYear, null);
  assert.equal(band.generatedBio, undefined);
});

test('transient failure remains retryable instead of terminally complete', () => {
  const now = '2026-08-13T10:00:00.000Z';
  const state = gau3.nextEnrichmentState(null, { failures: ['wikipedia'], now });
  assert.equal(state.status, 'retryable');
  assert.equal(state.lastSuccessfulAt, undefined);
  assert.equal(state.errorCategory, 'wikipedia');
  assert.equal(gau3.enrichmentRetryDue({ artistEnrichment: state }, new Date('2026-08-14T10:00:01.000Z')), true);
});

test('stale official artwork still respects the bounded retry delay after a failed refresh', () => {
  const band = spotifyBand({
    officialUrl: 'https://new.example',
    artistArtwork: { officialSite: { url: 'https://old.example/og.jpg', sourceUrl: 'https://old.example', source: 'official_site_og_image' } },
    artistEnrichment: {
      status: 'retryable',
      lastAttemptedAt: '2026-08-14T00:00:00.000Z',
      nextEligibleCheckAt: '2026-08-15T00:00:00.000Z',
      errorCategory: 'official_site',
    },
  });
  assert.equal(gau3.enrichmentRetryDue(band, new Date('2026-08-14T12:00:00.000Z')), false);
  assert.equal(gau3.enrichmentRetryDue(band, new Date('2026-08-15T00:00:00.000Z')), true);
});

test('recovery chooses the oldest due artist rather than permanent array order', () => {
  const rows = [
    { id: 'recent', artistEnrichment: { status: 'retryable', nextEligibleCheckAt: '2026-08-13T12:00:00.000Z' } },
    { id: 'oldest', artistEnrichment: { status: 'retryable', nextEligibleCheckAt: '2026-08-12T12:00:00.000Z' } },
    { id: 'future', artistEnrichment: { status: 'retryable', nextEligibleCheckAt: '2026-08-16T12:00:00.000Z' } },
  ];
  assert.equal(gau3.nextRetryBand(rows, new Date('2026-08-14T12:00:00.000Z')).id, 'oldest');
});

test('unsafe or deceptive official social links are not stored', () => {
  const band = spotifyBand({ socials: {} });
  const homepage = {
    instagram: 'https://evil.example/?next=instagram.com',
    spotify: 'https://evil.example/open.spotify.com/artist/synthetic',
  };
  assert.equal(gau3.applyHomepageEnrichment(band, homepage, '2026-08-14T00:00:00.000Z'), false);
  assert.deepEqual(band.socials, {});
});

test('safe official social links are normalized and stored without overwriting existing values', () => {
  const band = spotifyBand({ socials: { instagram: 'https://instagram.com/existing' } });
  assert.equal(gau3.applyHomepageEnrichment(band, {
    instagram: 'https://instagram.com/replacement',
    spotify: 'https://open.spotify.com/artist/synthetic',
  }, '2026-08-14T00:00:00.000Z'), true);
  assert.equal(band.socials.instagram, 'https://instagram.com/existing');
  assert.equal(band.socials.spotify, 'https://open.spotify.com/artist/synthetic');
});

test('manual add receives a durable retry checkpoint before its first persisted snapshot', () => {
  const startedAt = '2026-08-13T10:00:00.000Z';
  const band = { id: 'new-band', name: 'New Band', _enriching: true };
  security.preparePendingArtistEnrichment(band, startedAt);
  assert.equal(band.artistEnrichment.status, 'retryable');
  assert.equal(band.artistEnrichment.errorCategory, 'pending_enrichment');
  assert.equal(gau3.enrichmentRetryDue(band, new Date('2026-08-14T09:59:59.000Z')), false);
  assert.equal(gau3.enrichmentRetryDue(band, new Date('2026-08-14T10:00:00.000Z')), true);
});

test('successful retry fills missing safe fields without changing id or user-owned data', () => {
  const band = spotifyBand({ genre: null, origin: null, formedYear: null, bio: 'User text', photoUrl: 'https://user.example/manual.jpg' });
  const before = { id: band.id, favourite: band.favourite, muted: band.muted, notes: band.notes, futureField: structuredClone(band.futureField) };
  gau3.decorateBand(band);
  gau3.applyGeneratedEnrichment(band, { genre: 'Rock', origin: 'Stockholm', formedYear: '2020', bio: 'Generated text' }, '2026-08-14T12:00:00.000Z');
  band.artistEnrichment = gau3.nextEnrichmentState({ status: 'retryable' }, { failures: [], now: '2026-08-14T12:00:00.000Z' });
  assert.equal(band.id, before.id);
  assert.equal(band.genre, 'Rock');
  assert.equal(band.origin, 'Stockholm');
  assert.equal(band.formedYear, '2020');
  assert.equal(band.bio, 'User text');
  assert.equal(band.photoUrl, 'https://user.example/manual.jpg');
  assert.equal(band.favourite, before.favourite);
  assert.equal(band.muted, before.muted);
  assert.equal(band.notes, before.notes);
  assert.deepEqual(band.futureField, before.futureField);
  assert.equal(band.artistEnrichment.status, 'complete');
});

test('unknown future fields and provider identity survive enrichment merges', () => {
  const band = spotifyBand();
  const identityBefore = structuredClone(band.musicbrainz);
  const futureBefore = structuredClone(band.futureField);
  gau3.decorateBand(band);
  gau3.applyHomepageEnrichment(band, { image: 'https://band.example/og.jpg', instagram: 'https://instagram.com/synthetic' }, '2026-08-13T00:00:00.000Z');
  assert.deepEqual(band.musicbrainz, identityBefore);
  assert.deepEqual(band.futureField, futureBefore);
  assert.equal(band.favourite, true);
  assert.equal(band.muted, false);
  assert.equal(band.notes, 'keep me');
});

test('stale or rejected Spotify identity immediately loses artwork authority', () => {
  const band = spotifyBand();
  assert.equal(gau3.visibleArtistImageUrl(band), 'https://images.example/artist-640.jpg');
  band.musicbrainz.spotify.status = 'manual_rejected';
  assert.equal(gau3.visibleArtistImageUrl(band), null);
  band.musicbrainz.spotify = { id: 'spotify-artist-2', status: 'confirmed', images: [] };
  assert.equal(gau3.visibleArtistImageUrl(band), null);
});

test('multiple or malformed Spotify image metadata fails closed', () => {
  assert.equal(gau3.selectSpotifyArtistImage({ images: [{ url: 'http://images.example/insecure.jpg', width: 640, height: 640 }] }), null);
  assert.equal(gau3.selectSpotifyArtistImage({ images: [{ url: 'https://images.example/good.jpg', width: 640, height: 640 }, { url: 'not a url', width: 320, height: 320 }] }), null);
  assert.equal(gau3.selectSpotifyArtistImage({ images: 'https://images.example/not-an-array.jpg' }), null);
});

test('decorated provider artwork is visible while raw null user fields remain serialized unchanged', () => {
  const band = spotifyBand();
  band._enriching = true;
  gau3.decorateBand(band);
  assert.equal(band.photoUrl, 'https://images.example/artist-640.jpg');
  assert.equal(Object.prototype.propertyIsEnumerable.call(band, 'photoUrl'), false);
  const persisted = JSON.parse(JSON.stringify(band));
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'photoUrl'), true);
  assert.equal(persisted.photoUrl, null);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'bio'), true);
  assert.equal(persisted.bio, null);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, '_enriching'), false);
  assert.equal(persisted.musicbrainz.spotify.images[0].url, 'https://images.example/artist-640.jpg');
});

test('compatibility serialization preserves absence of raw user fields when they never existed', () => {
  const band = spotifyBand();
  delete band.photoUrl;
  delete band.bio;
  gau3.decorateBand(band);
  const persisted = gau3.persistentBandSnapshot(band);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'photoUrl'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'bio'), false);
  assert.deepEqual(persisted.futureField, { keep: true });
});
