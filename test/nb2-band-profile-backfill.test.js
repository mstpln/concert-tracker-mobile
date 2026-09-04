'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { audit, applyBackfill, visibleArtistImageUrl, validFormedYear } = require('../scripts/nb2-band-profile-backfill');

function baseBand(overrides = {}) {
  return {
    id: 'synthetic-band',
    name: 'Synthetic Band',
    officialUrl: null,
    photoUrl: null,
    genre: null,
    origin: null,
    formedYear: null,
    notes: 'keep',
    futureField: { keep: true },
    musicbrainz: {
      mbid: 'synthetic-mbid',
      status: 'confirmed',
      spotify: { id: 'spotify-1', status: 'confirmed', images: [] },
    },
    ...overrides,
  };
}

test('NB2 fills only approved blank profile fields and preserves stable/user/unknown data', () => {
  const input = [baseBand()];
  const { bands, changes } = applyBackfill(input, [{
    bandId: 'synthetic-band',
    officialUrl: 'https://band.example',
    genre: 'Rock',
    origin: 'Stockholm, Sweden',
    formedYear: '2020',
  }]);
  assert.equal(bands[0].id, 'synthetic-band');
  assert.equal(bands[0].officialUrl, 'https://band.example/');
  assert.equal(bands[0].genre, 'Rock');
  assert.equal(bands[0].origin, 'Stockholm, Sweden');
  assert.equal(bands[0].formedYear, '2020');
  assert.equal(bands[0].notes, 'keep');
  assert.deepEqual(bands[0].futureField, { keep: true });
  assert.deepEqual(bands[0].musicbrainz, input[0].musicbrainz);
  assert.equal(input[0].officialUrl, null);
  assert.equal(changes.length, 1);
});

test('NB2 never overwrites populated user/profile fields', () => {
  const input = [baseBand({
    officialUrl: 'https://existing.example/',
    genre: 'Existing genre',
    origin: 'Existing origin',
    formedYear: '1999',
  })];
  const { bands, changes } = applyBackfill(input, [{
    bandId: 'synthetic-band',
    officialUrl: 'https://replacement.example',
    genre: 'Replacement',
    origin: 'Replacement',
    formedYear: '2024',
  }]);
  assert.equal(bands[0].officialUrl, 'https://existing.example/');
  assert.equal(bands[0].genre, 'Existing genre');
  assert.equal(bands[0].origin, 'Existing origin');
  assert.equal(bands[0].formedYear, '1999');
  assert.deepEqual(changes, []);
});

test('trusted Spotify artwork counts as an existing visible image and is not replaced', () => {
  const band = baseBand({
    officialUrl: 'https://band.example/',
    musicbrainz: {
      mbid: 'synthetic-mbid',
      status: 'confirmed',
      spotify: {
        id: 'spotify-1',
        status: 'confirmed',
        images: [{ url: 'https://images.example/640.jpg', width: 640, height: 640 }],
      },
    },
  });
  assert.equal(visibleArtistImageUrl(band), 'https://images.example/640.jpg');
  const { bands, changes } = applyBackfill([band], [{
    bandId: 'synthetic-band',
    officialArtwork: { url: 'https://band.example/og.jpg' },
  }]);
  assert.equal(bands[0].artistArtwork, undefined);
  assert.deepEqual(changes, []);
});

test('official artwork uses GAU3 provenance and does not write provider art into photoUrl', () => {
  const band = baseBand({ officialUrl: 'https://band.example/' });
  const { bands } = applyBackfill([band], [{
    bandId: 'synthetic-band',
    officialArtwork: { url: 'https://cdn.band.example/artist.jpg', sourceUrl: 'https://band.example/' },
  }]);
  assert.equal(bands[0].photoUrl, null);
  assert.deepEqual(bands[0].artistArtwork.officialSite, {
    url: 'https://cdn.band.example/artist.jpg',
    sourceUrl: 'https://band.example/',
    source: 'official_site_og_image',
  });
  assert.equal(visibleArtistImageUrl(bands[0]), 'https://cdn.band.example/artist.jpg');
});

test('exact trusted Spotify oEmbed artwork is accepted without changing provider identity', () => {
  const band = baseBand();
  const { bands, changes } = applyBackfill([band], [{
    bandId: 'synthetic-band',
    spotifyOembedImage: {
      spotifyId: 'spotify-1',
      url: 'https://image-cdn-fa.spotifycdn.com/image/synthetic',
      width: 320,
      height: 320,
    },
  }]);
  assert.equal(bands[0].musicbrainz.spotify.id, 'spotify-1');
  assert.deepEqual(bands[0].musicbrainz.spotify.images, [{
    url: 'https://image-cdn-fa.spotifycdn.com/image/synthetic',
    width: 320,
    height: 320,
  }]);
  assert.equal(changes[0].fields[0], 'musicbrainz.spotify.images');
});

test('unsafe, mismatched, unknown, duplicate, and unsupported patch data fail closed', () => {
  assert.throws(() => applyBackfill([baseBand()], [{ bandId: 'missing', genre: 'Rock' }]), /unknown stable band id/);
  assert.throws(() => applyBackfill([baseBand()], [{ bandId: 'synthetic-band', photoUrl: 'https:\/\/image.example\/x.jpg' }]), /unsupported NB2 patch field/);
  assert.throws(() => applyBackfill([baseBand()], [{ bandId: 'synthetic-band', officialUrl: 'http:\/\/unsafe.example' }]), /must be HTTPS/);
  assert.throws(() => applyBackfill([baseBand()], [{ bandId: 'synthetic-band', formedYear: 'twenty' }]), /four-digit year/);
  assert.throws(() => applyBackfill([baseBand()], [{ bandId: 'synthetic-band', formedYear: '2099' }]), /four-digit year/);
  assert.throws(() => applyBackfill([baseBand()], [{ bandId: 'synthetic-band', spotifyOembedImage: { spotifyId: 'wrong', url: 'https:\/\/image-cdn-fa.spotifycdn.com\/image\/x', width: 320, height: 320 } }]), /match the trusted Spotify artist id/);
  assert.throws(() => applyBackfill([baseBand()], [{ bandId: 'synthetic-band', spotifyOembedImage: { spotifyId: 'spotify-1', url: 'https:\/\/example.com\/image.jpg', width: 320, height: 320 } }]), /Spotify CDN/);
  assert.throws(() => applyBackfill([baseBand({ officialUrl: 'https:\/\/band.example\/' })], [{ bandId: 'synthetic-band', officialArtwork: { url: 'https:\/\/cdn.example\/x.jpg', sourceUrl: 'https:\/\/other.example\/' } }]), /must exactly match officialUrl/);
  assert.throws(() => applyBackfill([baseBand(), { ...baseBand(), name: 'Duplicate' }], []), /duplicate stable band id/);
  assert.throws(() => applyBackfill([baseBand()], [{ bandId: 'synthetic-band', genre: 'Rock' }, { bandId: 'synthetic-band', origin: 'Sweden' }]), /duplicate patch entry/);
});

test('formedYear validation accepts only plausible four-digit years', () => {
  assert.equal(validFormedYear('1998'), '1998');
  assert.equal(validFormedYear('1899'), null);
  assert.equal(validFormedYear('2099'), null);
  assert.equal(validFormedYear('98'), null);
});

test('NB2 audit measures visible image gaps rather than raw photoUrl gaps', () => {
  const rows = [
    baseBand({ id: 'manual', photoUrl: 'https://user.example/manual.jpg' }),
    baseBand({ id: 'spotify', musicbrainz: { spotify: { id: 'spotify-2', status: 'manual_confirmed', images: [{ url: 'https://images.example/artist.jpg', width: 500, height: 500 }] } } }),
    baseBand({ id: 'missing' }),
  ];
  const result = audit(rows);
  assert.equal(result.totalBands, 3);
  assert.equal(result.missing.visibleImage, 1);
  assert.equal(result.missing.officialUrl, 3);
});
