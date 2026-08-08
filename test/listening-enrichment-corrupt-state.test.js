'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const inventoryLib = require('../scripts/listening-inventory');
const engine = require('../scripts/listening-enrichment-engine');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';

function fixture() {
  const bands = [{
    id: 'band-1',
    name: 'Example Band',
    musicbrainz: {
      mbid: MB_ARTIST,
      status: 'manual_confirmed',
      spotify: { id: 'SpotifyArtist123', status: 'manual_confirmed' },
    },
  }];
  const events = [{
    bandId: 'band-1',
    artistCreditName: 'Example Band',
    recordingTitle: 'Exact Song',
    spotifyTrackId: 'SpotifyTrack123',
  }];
  return { bands, events };
}

test('exact malformed identity record values block instead of becoming fresh work', () => {
  const { bands, events } = fixture();
  const base = inventoryLib.buildListeningInventory({ bands, events });
  const item = base.items[0];

  for (const malformed of [null, false, 0, 'bad-record', []]) {
    const plan = engine.planEnrichment({
      inventory: base,
      trackIdentities: { records: { [item.trackKey]: malformed } },
    });
    assert.equal(plan.steps.length, 0);
    assert.equal(plan.counts.blocked, 1);

    const rebuilt = inventoryLib.buildListeningInventory({
      bands,
      events,
      trackIdentities: { records: { [item.trackKey]: malformed } },
    });
    assert.equal(rebuilt.items[0].status, 'blocked');
    assert.equal(rebuilt.items[0].reason, 'stored_track_identity_conflict');
  }
});

test('malformed stored dates and known provider observation fields block reuse', () => {
  const { bands, events } = fixture();
  const base = inventoryLib.buildListeningInventory({ bands, events });
  const item = base.items[0];
  const records = [
    { workKey: item.trackKey, updatedAt: 'not-a-date' },
    { workKey: item.trackKey, nextEligibleCheckAt: 'not-a-date' },
    { workKey: item.trackKey, providers: { spotify: { status: 17 } } },
    { workKey: item.trackKey, providers: { spotify: { reason: 17 } } },
    { workKey: item.trackKey, providers: { spotify: { checkedAt: 'not-a-date' } } },
  ];

  for (const record of records) {
    const plan = engine.planEnrichment({
      inventory: base,
      trackIdentities: { records: { [item.trackKey]: record } },
    });
    assert.equal(plan.steps.length, 0);
    assert.equal(plan.counts.blocked, 1);

    const rebuilt = inventoryLib.buildListeningInventory({
      bands,
      events,
      trackIdentities: { records: { [item.trackKey]: record } },
    });
    assert.equal(rebuilt.items[0].status, 'blocked');
    assert.equal(rebuilt.items[0].reason, 'stored_track_identity_conflict');
  }
});
