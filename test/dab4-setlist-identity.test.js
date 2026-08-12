'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SETLISTFM_API_KEY = 'synthetic-setlist-key';

const setlistfm = require('../scripts/lib/setlistfm');

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
