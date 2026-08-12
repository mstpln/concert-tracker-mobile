'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SETLISTFM_API_KEY = 'synthetic-setlist-key';

const setlistfm = require('../scripts/lib/setlistfm');
const spotify = require('../scripts/lib/spotify');

function usage() {
  return {
    canCallSetlistfm: () => true,
    recordSetlistfmCall: async () => {},
    note: () => {},
  };
}

function providerSetlist({ artistName = '東京事変', venueName = '日本武道館' } = {}) {
  return {
    eventDate: '01-07-2026',
    artist: { name: artistName },
    venue: { name: venueName },
    sets: { set: [{ song: [{ name: 'Synthetic Song' }] }] },
  };
}

function concert({ bandName = '東京事変', venue = '日本武道館' } = {}) {
  return { bandName, venue, date: '2026-07-01' };
}

test('DAB4 actual-show identity preserves non-Latin artist and venue text', async () => {
  const found = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ setlist: [providerSetlist()] }) }),
  });
  assert.equal(found.kind, 'found');

  const wrongArtist = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ setlist: [providerSetlist({ artistName: '椎名林檎' })] }) }),
  });
  assert.deepEqual(wrongArtist, { kind: 'error', error: 'show_identity_conflict' });

  const wrongVenue = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ setlist: [providerSetlist({ venueName: '東京ドーム' })] }) }),
  });
  assert.deepEqual(wrongVenue, { kind: 'error', error: 'show_identity_conflict' });
});

test('DAB4 scheduled actual-show outcome requires the provider to return the event date', async () => {
  const missingDate = providerSetlist();
  delete missingDate.eventDate;
  const outcome = await setlistfm.findSetlistOutcomeForShow(concert(), usage(), {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ setlist: [missingDate] }) }),
  });
  assert.deepEqual(outcome, { kind: 'error', error: 'show_identity_conflict' });
});

test('DAB4 Spotify artist matching preserves non-Latin identity and fails closed on empty identity', () => {
  assert.equal(spotify.artistMatches([{ name: '東京事変' }], '東京事変'), true);
  assert.equal(spotify.artistMatches([{ name: '椎名林檎' }], '東京事変'), false);
  assert.equal(spotify.artistMatches([{ name: 'Anything' }], ''), false);
  assert.equal(spotify.artistMatches([{ id: 'confirmed-id', name: 'Anything' }], '', 'confirmed-id'), true);
});
